/* Service worker: Web Push, the app-icon badge, and a small offline shell.
 * Mail data is cached by the app itself (IndexedDB), so this only keeps the page and its static
 * assets around. Plain JS on purpose: served as-is from /sw.js with scope "/". */

const SHELL = "kolbaba-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network first, fall back to the cached app shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && url.pathname === "/") caches.open(SHELL).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
  }
});

async function broadcast(message) {
  for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage(message);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "New mail", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      await broadcast({ type: "mail-changed" });
      if (typeof data.badge === "number" && self.navigator.setAppBadge) {
        await (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {});
      }
      await self.registration.showNotification(data.title || "New mail", {
        body: data.body || "",
        tag: data.tag,
        renotify: !!data.tag,
        icon: "/pwa-icon/192",
        badge: "/pwa-icon/192",
        data: { url: data.url || "/" },
      });
    })(),
  );
});

// The browser renewed the subscription (it may, now and then): the server hears the new address, or mail
// stops notifying. Browsers that don't say so (Safari) get it renewed by the app (src/lib/push-client.ts).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const sub = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!sub) return;
      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), replaces: old ? old.endpoint : undefined }),
      });
    })().catch(() => {}),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: "open-url", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
