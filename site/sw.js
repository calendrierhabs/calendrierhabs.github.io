// Offline support. Everything is fetched fresh when there's a connection,
// and the last good copy is used when there isn't, so the app always opens.
const CACHE = "habs-v3";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/i18n.js", "js/teams.js", "js/reminders.js", "js/live.js", "css/reminders.css", "css/fonts.css", "manifest.webmanifest", "icons/icon-192.png",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2",
  "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  // Data files carry a cache-busting ?t=; store them under one key.
  const key = sameOrigin && url.pathname.includes("/data/") ? url.origin + url.pathname : req;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match("index.html"))),
  );
});

// ---------- Game-day reminders (sent by .github/workflows/reminders.yml) ----------
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(
    self.registration.showNotification(msg.title || "Habs", {
      body: msg.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/badge-96.png",
      tag: msg.tag || "habs",
      lang: msg.lang || "fr",
      timestamp: msg.ts || Date.now(),
      data: { url: msg.url || "./" },
    }),
  );
});

// Tapping a reminder opens the app, or brings it forward if it's already open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

// If the browser renews the subscription, take the new one right away; the app
// tells the workflow about it the next time it's opened.
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil(self.registration.pushManager.subscribe(options).catch(() => {}));
});
