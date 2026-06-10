/**
 * Build script — Vercel-aware.
 *
 * - In all cases: build the Vite client to `dist/public` (served as static assets).
 * - In a Vercel build (VERCEL=1): stop there. Vercel auto-compiles each `api/*.ts`
 *   into its own serverless function — we don't need to produce `dist/index.cjs`.
 * - Locally (or in a non-Vercel host): also bundle the Express server entrypoint
 *   to `dist/index.cjs` so `npm start` works for a long-running Node process.
 */
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "node:fs/promises";

// Server deps to bundle to reduce openat(2) syscalls at cold start.
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "postgres",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  if (process.env.VERCEL) {
    console.log("VERCEL build detected — skipping server bundle (api/*.ts are compiled by Vercel)");
    return;
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
