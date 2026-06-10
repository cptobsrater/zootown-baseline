/**
 * Local development entry point.
 *
 * In production on Vercel, `api/[...path].ts` is used instead and this file
 * is never loaded. Background schedulers (ingest, history rotation, daily
 * writer) only run in local dev — on Vercel they are replaced by Cron Jobs
 * declared in `vercel.json`.
 */
import "dotenv/config";
import { buildApp, log } from "./app.js";
import { serveStatic } from "./static.js";
import { startScheduler } from "./ingest/ingester.js";
import { seedHistoryIfEmpty, startLongFormScheduler } from "./history.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});

(async () => {
  console.log(`[boot] node=${process.version} cwd=${process.cwd()} NODE_ENV=${process.env.NODE_ENV}`);
  const { app, httpServer } = await buildApp();
  console.log("[boot] routes registered");

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite.js");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      try {
        startScheduler();
        log("ingestion scheduler started", "ingest");
      } catch (err) {
        console.error("[boot] scheduler failed (non-fatal):", err);
      }
      try {
        await seedHistoryIfEmpty();
        startLongFormScheduler();
        log("history pool initialized", "history");
      } catch (err) {
        console.error("[boot] history init failed (non-fatal):", err);
      }
    },
  );
})().catch((err) => {
  console.error("[boot] fatal startup error:", err);
  process.exit(1);
});
