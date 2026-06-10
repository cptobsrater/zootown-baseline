/**
 * Vercel serverless catch-all handler — wraps the Express app.
 *
 * Every request to /api/* (and / via vercel.json rewrites) hits this handler.
 * The Express app is built lazily once per cold-start and cached across
 * invocations of the same Lambda instance.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Express } from "express";
import { buildApp } from "../server/app.js";

let appPromise: Promise<Express> | null = null;

async function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = buildApp().then(({ app }) => app);
  }
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getApp();
  return (app as any)(req, res);
}
