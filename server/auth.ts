import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { queryClient } from "./storage.js";

// Single-user admin auth.
// We compare a SHA-256 hash of the submitted password against ADMIN_PASSWORD_HASH
// (set as env var in production). If no env var is set, fall back to a hard-coded
// hash so the dev/preview build still works for the single owner.
//
// Tokens are persisted in Supabase so multiple Vercel serverless instances all
// see the same session. They expire 30 minutes after issue.

const FALLBACK_HASH = "d4e8f76db3e3a1aef37d4d719894c26bdb5bf0b94a43c344e6fe6c350be7a86d"; // sha256("MissoulaRocks")

function expectedHash(): string {
  const env = process.env.ADMIN_PASSWORD_HASH?.trim();
  return env && env.length === 64 ? env : FALLBACK_HASH;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
}

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Reuse the storage layer's connection pool to avoid hitting Supabase's connection limit.
function getSql() {
  return queryClient;
}

export function verifyPassword(password: string): boolean {
  if (typeof password !== "string" || password.length === 0 || password.length > 200) return false;
  return constantTimeEqual(sha256(password), expectedHash());
}

export async function issueToken(): Promise<{ token: string; expiresAt: number }> {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await sql`INSERT INTO admin_tokens (token, expires_at) VALUES (${token}, ${expiresAt})`;
  // Best-effort cleanup of expired tokens.
  try {
    await sql`DELETE FROM admin_tokens WHERE expires_at <= ${Date.now()}`;
  } catch {}
  return { token, expiresAt };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    const sql = getSql();
    await sql`DELETE FROM admin_tokens WHERE token = ${token}`;
  } catch {}
}

export async function isTokenValid(token: string | undefined | null): Promise<boolean> {
  if (!token) {
    console.warn("[auth] no token provided");
    return false;
  }
  try {
    const sql = getSql();
    const rows = await sql`SELECT expires_at FROM admin_tokens WHERE token = ${token} LIMIT 1`;
    if (rows.length === 0) {
      console.warn(`[auth] token not found in DB: ${token.slice(0, 8)}...`);
      return false;
    }
    const raw = rows[0].expires_at;
    const expiresAt = typeof raw === "bigint" ? Number(raw) : Number(raw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      console.warn(`[auth] token expired: exp=${expiresAt}, now=${Date.now()}`);
      try { await sql`DELETE FROM admin_tokens WHERE token = ${token}`; } catch {}
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[auth] token lookup error:", err?.message, err?.code, err?.stack?.split("\n")[0]);
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const match = auth.match(/^Bearer\s+([A-Za-z0-9]+)$/);
  const token = match?.[1];
  isTokenValid(token)
    .then((ok) => {
      if (!ok) {
        const debug = process.env.AUTH_DEBUG === "1" ? { tokenPrefix: token?.slice(0, 8), hadAuth: !!auth, matched: !!match } : undefined;
        return res.status(401).json({ error: "Unauthorized", debug });
      }
      // Attach a stable per-token identifier so downstream routes can scope
      // "personal" data to the admin who's logged in. We use the first 16
      // chars of the token so the full secret never reaches business logic
      // or analytics events. If the admin rotates their token (logout +
      // login), they effectively become a new identity — acceptable for an
      // editorial cockpit where ownership is convenience, not a security
      // boundary (the boundary IS requireAdmin itself).
      if (token) {
        (req as any).adminId = `t_${token.slice(0, 16)}`;
      }
      next();
    })
    .catch((err) => {
      console.error("[auth] requireAdmin error:", err);
      res.status(500).json({ error: "Auth check failed", message: err?.message });
    });
}
