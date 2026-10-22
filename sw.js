// To do projets : fonctionnement hors connexion de l'application installée.
// Les données en ligne (Supabase) ne passent jamais par ce cache.
const CACHE = "todo-projets-v84";
const CORE = ["./", "./index.html", "./css/app.css", "./css/v2.css", "./js/config.js", "./js/xlsx.js", "./js/app.js", "./manifest.webmanifest", "./icons/icon-192-v4.png", "./icons/icon-512-v4.png", "./vendor/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return; // Supabase : réseau direct
  // Bibliothèque de transcription (22 Mo) : réseau et cache HTTP du navigateur, hors cache de l'appli
  if (url.pathname.includes("/vendor/transformers/")) return;
  // Page de l'application : toujours la version la plus récente, la copie locale seulement hors connexion
  if (req.mode === "navigate") {
    e.respondWith(fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // Code de l'application (styles et scripts) : toujours la version en ligne, la copie locale seulement hors connexion.
  // (clé de cache sans le paramètre ?v= pour retrouver la copie hors connexion)
  if (sameOrigin && /\.(js|css)$/.test(url.pathname) && !url.pathname.endsWith("/sw.js") && !url.pathname.includes("/vendor/")) {
    const key = url.origin + url.pathname;
    e.respondWith(fetch(req, { cache: "no-store" }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); } return r; })
      .catch(() => caches.match(key)));
    return;
  }
  // Fichiers fixes (icônes, polices, librairie Supabase) : copie locale, mise à jour en arrière-plan
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
