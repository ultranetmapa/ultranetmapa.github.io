/* Ultranet Mapa - modo sem internet (guarda o app e os pedaços do mapa já vistos).
   Suba este arquivo no GitHub NA MESMA PASTA do index.html, com o nome sw.js. */
const VER = "ultranet-3.64";
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "apple-touch-icon.png"];
const LIBS = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/@mapbox/togeojson@0.16.2/togeojson.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"
];
const TILE_HOSTS = ["server.arcgisonline.com", "tile.openstreetmap.org"];
const TILE_MAX = 4000;                 // limite de pedaços de mapa guardados
const C_SHELL = VER + "-app", C_LIBS = VER + "-libs", C_TILES = "ultranet-tiles";   // o mapa guardado não é apagado nas atualizações

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(C_SHELL);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    const l = await caches.open(C_LIBS);
    await Promise.all(LIBS.map(async u => {
      try { const r = await fetch(u, { mode: "cors", credentials: "omit" }); if (r.ok) { await l.put(u, r); return; } } catch (_) {}
      try { const r = await fetch(u, { mode: "no-cors" }); await l.put(u, r); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = [C_SHELL, C_LIBS, C_TILES];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error("timeout")), ms); p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); no(e); }); });

async function trimTiles(c) {
  const ks = await c.keys();
  if (ks.length > TILE_MAX) for (const k of ks.slice(0, ks.length - TILE_MAX)) await c.delete(k);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) a página do app: tenta a internet (até 3 s) e, se não der, usa a cópia guardada
  if (req.mode === "navigate" || (url.origin === location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith("index.html")))) {
    e.respondWith((async () => {
      const c = await caches.open(C_SHELL);
      try { const r = await withTimeout(fetch(req), 3000); if (r && r.ok) { c.put("index.html", r.clone()); return r; } } catch (_) {}
      return (await c.match("index.html")) || (await c.match("./")) || Response.error();
    })());
    return;
  }

  // 2) outros arquivos do mesmo site (ícones, manifest)
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(C_SHELL);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // 3) peças do app que vêm de fora (Tailwind, Leaflet, Firebase): usa a guardada e atualiza por trás
  if (LIBS.includes(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(C_LIBS);
      const hit = await c.match(req.url);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req.url, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // 4) pedaços do mapa: guarda os que você já viu
  if (TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith("." + h))) {
    e.respondWith((async () => {
      const c = await caches.open(C_TILES);
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetch(req.url, { mode: "cors", credentials: "omit" });   // resposta "aberta": ocupa pouco espaço
        if (r && r.ok) { c.put(req.url, r.clone()).then(() => trimTiles(c)).catch(() => {}); return r; }
      } catch (_) {}
      try { return await fetch(req); } catch (_) { return Response.error(); }      // sem guardar; se não houver internet, o pedaço fica vazio
    })());
    return;
  }
  // todo o resto (Firebase, WhatsApp etc.) segue normal
});
