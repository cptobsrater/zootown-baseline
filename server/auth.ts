import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// Single-user admin auth.
// We compare a SHA-256 hash of the submitted password against ADMIN_PASSWORD_HASH
// (set as env var in production). If no env var is set, fall back to a hard-coded
// hash so the dev/preview build still works for the single owner.
//
// Tokens are stored in memory and expire 30 minutes after issue. They are NEVER
// persisted to disk, so a server restart logs everyone out.

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

interface TokenRecord {
  expiresAt: number;
}

const tokens = new Map<string, TokenRecord>();
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function purge() {
  const now = Date.now();
  for (const [t, rec] of tokens) {
    if (rec.expiresAt <= now) tokens.delete(t);
  }
}

export function verifyPassword(password: string): boolean {
  if (typeof password !== "string" || password.length === 0 || password.length > 200) return false;
  return constantTimeEqual(sha256(password), expectedHash());
}

export function issueToken(): { token: string; expiresAt: number } {
  purge();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, { expiresAt });
  return { token, expiresAt };
}

export function revokeToken(token: string): void {
  tokens.delete(token);
}

export function isTokenValid(token: string | undefined | null): boolean {
  if (!token) return false;
  purge();
  const rec = tokens.get(token);
  if (!rec) return false;
  if (rec.expiresAt <= Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const match = auth.match(/^Bearer\s+([A-Za-z0-9]+)$/);
  const token = match?.[1];
  if (!isTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
