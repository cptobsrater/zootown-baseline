/**
 * Express app factory — shared between the local dev server (`server/index.ts`)
 * and the Vercel serverless handler (`api/[...path].ts`).
 *
 * In serverless mode we do NOT start background schedulers; Vercel Cron Jobs
 * (configured in vercel.json) call dedicated `/api/cron/*` endpoints instead.
 */
import express, { type Express, type Response, type NextFunction } from "express";
import type { Request } from "express";
import { createServer, type Server } from "node:http";
import { registerRoutes } from "./routes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function buildApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  // Request log (only /api/* lines)
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let captured: Record<string, any> | undefined;
    const originalJson = res.json;
    res.json = function (bodyJson, ...args) {
      captured = bodyJson;
      return originalJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let line = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (captured) line += ` :: ${JSON.stringify(captured).slice(0, 500)}`;
        log(line);
      }
    });
    next();
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  return { app, httpServer };
}
