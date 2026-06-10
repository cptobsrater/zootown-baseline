/**
 * ZooTown service worker.
 *
 * Intentionally minimal: registering ANY service worker is what flips the
 * "installable PWA" bit in Chrome/Edge/Android. We don't need offline support,
 * so we don't cache app code (avoids stale-asset bugs on deploys).
 *
 * Strategy: take control immediately, network-first for everything, pass-through.
 */
const VERSION = "v1";

self.addEventListener("install", (event) => {
  // Activate this version as soon as it's installed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass through to the network. No caching — we want fresh app code on every
  // load so the user always sees the latest deploy. The service worker only
  // exists to satisfy the "installable PWA" requirements.
  return;
});
