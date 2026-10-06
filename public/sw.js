// Cache only this app's shell. Broadcasts and external pages are never cached.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `aura-tv-shell:${encodeURIComponent(SCOPE.href)}:`;
const CACHE = `${CACHE_PREFIX}v2`;
const SHELL = ['', 'index.html', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']
  .map((path) => new URL(path, SCOPE).href);
const isAppAsset = (url) => url.origin === SCOPE.origin
  && url.pathname.startsWith(SCOPE.pathname)
  && /^assets\/[^/]+\.(?:js|css)$/.test(url.pathname.slice(SCOPE.pathname.length));
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Preload the entry bundles so the first reload can already work offline.
    const html = await (await cache.match(SCOPE.href)).text();
    const assets = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => new URL(match[1], SCOPE))
      .filter(isAppAsset).map((url) => url.href);
    await cache.addAll(assets);
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== SCOPE.origin || (!SHELL.includes(`${url.origin}${url.pathname}`) && !isAppAsset(url))) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  // Shell files are public and identical across request headers, including Vary: Origin.
  }).catch(async () => (await (await caches.open(CACHE)).match(event.request, { ignoreSearch: true, ignoreVary: true })) || new Response('暂时无法连接，请联网后重试。', { status: 503 })));
});
