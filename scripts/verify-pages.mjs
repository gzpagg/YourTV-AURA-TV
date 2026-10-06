import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Validate an existing production build; no build or package installation occurs here.
const dist = resolve(process.env.APP_DIST_DIR || fileURLToPath(new URL('../dist/', import.meta.url)));
const basePath = process.env.APP_BASE_PATH || '/';
assert(basePath.startsWith('/') && basePath.endsWith('/') && !/[?#\\]/.test(basePath), 'APP_BASE_PATH must be an absolute path ending in /');
assert(existsSync(resolve(dist, 'index.html')), `Build missing at ${dist}; run npm run build first`);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};
const probes = [
  `${basePath}assets/__aura_probe__.m3u8`,
  `${basePath}assets/__aura_probe__.ts`,
  `${basePath}__aura_probe__.m3u8`,
  '/__aura_other__/assets/__aura_probe__.js',
];
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__aura_setup__') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Cache isolation setup</title>');
      return;
    }
    if (probes.includes(pathname)) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('Uncached media or out-of-scope fixture');
      return;
    }
    if (!pathname.startsWith(basePath)) throw new Error('Outside application base');
    const relativePath = pathname.slice(basePath.length) || 'index.html';
    const file = resolve(dist, relativePath);
    if (!file.startsWith(`${dist}${sep}`)) throw new Error('Outside build directory');
    const body = await readFile(file);
    // Vite preview sends this header; exercise header-independent shell fallback too.
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] || 'application/octet-stream', vary: 'Origin' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}${basePath}`;
  const prefix = `aura-tv-shell:${encodeURIComponent(base)}:`;
  const otherCache = `aura-tv-shell:${encodeURIComponent(`${origin}/__aura_other__/`)}:v1`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/__aura_setup__`);
  await page.evaluate(async ({ otherCache, oldCache }) => {
    await caches.open(otherCache);
    await caches.open(oldCache);
  }, { otherCache, oldCache: `${prefix}v1` });
  await page.goto(base);
  await page.getByRole('heading', { name: '现在，打开新视界。' }).waitFor();
  assert.equal(await page.locator('.channel-card').count(), 8);
  const metadata = await page.evaluate(async () => {
    const manifestUrl = document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await fetch(manifestUrl)).json();
    const icons = await Promise.all(manifest.icons.map(async icon => {
      const url = new URL(icon.src, manifestUrl).href;
      const image = new Image();
      image.src = url;
      await image.decode();
      return { url, size: icon.sizes, width: image.naturalWidth, height: image.naturalHeight };
    }));
    return {
      manifestUrl, icons,
      start: new URL(manifest.start_url, manifestUrl).href,
      scope: new URL(manifest.scope, manifestUrl).href,
      id: new URL(manifest.id, manifestUrl).href,
    };
  });
  // Wait with a deadline so a failed installation cannot hang a CI job indefinitely.
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, url: registration.active.scriptURL, cacheNames: await caches.keys() };
  });
  for (const key of ['start', 'scope', 'id']) assert.equal(metadata[key], base);
  assert.equal(worker.scope, base);
  assert.equal(worker.url, `${base}sw.js`);
  assert.equal(metadata.manifestUrl, `${base}manifest.webmanifest`);
  for (const size of [192, 512]) {
    const icon = metadata.icons.find(icon => icon.size === `${size}x${size}`);
    assert.equal(icon.url, `${base}icon-${size}.png`);
    assert.deepEqual([icon.width, icon.height], [size, size]);
  }
  assert(worker.cacheNames.includes(otherCache), 'Activation removed another app scope cache');
  assert(!worker.cacheNames.includes(`${prefix}v1`), 'Activation retained obsolete cache for this scope');
  assert(worker.cacheNames.includes(`${prefix}v2`));
  for (const filename of ['hls.js-LICENSE.txt', 'Apache-2.0.txt']) {
    const response = await context.request.get(`${base}licenses/${filename}`);
    assert.equal(response.status(), 200, `License missing: ${filename}`);
    assert((await response.text()).length > 100, `License empty: ${filename}`);
  }
  console.log(`PASS ${basePath}: production page, manifest, icons, licenses, worker scope, and cache isolation`);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: '现在，打开新视界。' }).waitFor();
  await page.getByRole('searchbox', { name: '搜索频道' }).fill('CCTV');
  assert.equal(await page.locator('.channel-card').count(), 3);
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${base}sw.js`);
  console.log(`PASS ${basePath}: first reload after installation works offline and channel search is functional`);

  await context.setOffline(false);
  const network = await page.evaluate(async ({ base, cacheName, probes }) => {
    const cache = await caches.open(cacheName);
    await cache.put(`${base}icon.svg`, new Response('stale-icon'));
    const icon = await (await fetch(`${base}icon.svg`)).text();
    await Promise.all(probes.map(path => fetch(new URL(path, base))));
    return { icon, keys: (await cache.keys()).map(request => request.url) };
  }, { base, cacheName: `${prefix}v2`, probes });
  assert(network.icon.includes('<svg'), 'Network response did not replace stale shell data');
  assert(network.keys.every(url => url.startsWith(base)), 'Out-of-scope URL was cached');
  assert(!network.keys.some(url => url.includes('__aura_probe__')), 'Media or unrelated resource was cached');
  assert(network.keys.some(url => /\/assets\/index-.*\.js$/.test(url)));
  assert(network.keys.some(url => /\/assets\/index-.*\.css$/.test(url)));
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log(`PASS ${basePath}: network-first updates; no cached playlists, media segments, or unrelated resources; no JavaScript errors`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
