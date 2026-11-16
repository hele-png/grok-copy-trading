// CopyBot service worker. Network-first so a new version shows on the next open;
// cache is only a fallback when offline.
const CACHE = "copybot-v6";
const SHELL = [
  "./", "./index.html", "./styles.css?v=6", "./app.js?v=6", "./manifest.json?v=6",
  "./icons/icon-192.png?v=6", "./icons/icon-512.png", "./icons/apple-touch-icon.png?v=6", "./icons/favicon-32.png?v=6",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.url.includes("/data/") }).then((hit) => hit || caches.match("./index.html")))
  );
});
