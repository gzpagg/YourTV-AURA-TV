import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mediaDirectory } from './prepare-media';

const streamHosts = new Set([
  'english-livebkali.cgtn.com',
  'live.france24.com',
  'streams.example.test',
]);

async function routeLocalMedia(page: Page, failManifest = false): Promise<string[]> {
  const requestedMedia: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue();
      return;
    }
    if (!streamHosts.has(url.hostname)) {
      await route.abort('blockedbyclient');
      return;
    }
    requestedMedia.push(url.pathname);
    const filename = url.pathname.startsWith('/__aura_fixture__/')
      ? basename(url.pathname)
      : 'master.m3u8';
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (failManifest) {
      await route.fulfill({ status: 503, headers, contentType: 'text/plain', body: 'Fixture: source unavailable' });
      return;
    }
    const body = await readFile(join(mediaDirectory, filename));
    await route.fulfill({
      status: 200,
      headers,
      contentType: filename.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl',
      body,
    });
  });
  return requestedMedia;
}

test('discovery, search, and category filters reveal the expected channels', async ({ page }) => {
  await routeLocalMedia(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '现在，打开新视界。' })).toBeVisible();
  await expect(page.locator('.channel-card')).toHaveCount(8);
  await page.screenshot({ path: join(mediaDirectory, 'home-desktop.png'), fullPage: true });
  await page.getByRole('searchbox', { name: '搜索频道' }).fill('cCtV');
  await expect(page.locator('.channel-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '观看 CCTV-13', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '国际', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '还没有找到这个频道' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(8);
  await page.getByRole('button', { name: '央视', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(3);
});

test('favorites survive a reload and can be removed from the collection', async ({ page }) => {
  await routeLocalMedia(page);
  await page.goto('/');
  await page.getByRole('button', { name: '收藏 CCTV-13', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏 CCTV-13', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '观看 CCTV-13', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消收藏 CCTV-13', exact: true }).click();
  await expect(page.getByRole('heading', { name: '留住喜欢的频道' })).toBeVisible();
  await page.reload();
  await page.locator('[data-view="favorites"]').click();
  await expect(page.locator('.channel-card')).toHaveCount(0);
});

test('custom channels reject unsafe URLs, persist valid entries, and can be deleted', async ({ page }) => {
  await routeLocalMedia(page);
  await page.goto('/');
  await page.locator('#add-button').click();
  await page.getByRole('textbox', { name: '频道名称', exact: true }).fill('我的公开频道');
  await page.getByRole('textbox', { name: '播放地址', exact: true }).fill('javascript:alert(1)');
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#form-error')).toContainText('只支持 HTTP 或 HTTPS');
  await expect(page.locator('#add-dialog')).toBeVisible();
  await page.getByRole('textbox', { name: '播放地址', exact: true }).fill('https://streams.example.test/live.m3u8?quality=hd');
  await page.getByRole('textbox', { name: '官方网站', exact: false }).fill('https://example.test/about');
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#add-dialog')).not.toBeVisible();
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '观看 我的公开频道', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await page.getByRole('button', { name: '观看 我的公开频道', exact: true }).click();
  await expect(page.locator('#player-official')).toHaveAttribute('href', 'https://example.test/about');
  await page.getByRole('button', { name: '移除此自定义频道', exact: true }).click();
  await expect(page.locator('#player-dialog')).not.toBeVisible();
  await expect(page.locator('.channel-card')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await expect(page.locator('.channel-card')).toHaveCount(0);
});

test('CNN clearly opens its official page and discloses subscription restrictions', async ({ page }) => {
  const mediaRequests = await routeLocalMedia(page);
  await page.goto('/');
  await page.getByRole('button', { name: '观看 CNN', exact: true }).click();
  await expect(page.locator('#player-title')).toHaveText('CNN');
  await expect(page.getByRole('heading', { name: '在官方平台继续观看' })).toBeVisible();
  await expect(page.locator('#player-screen')).not.toBeVisible();
  await expect(page.locator('#player-note')).toContainText('不承诺免费直播');
  await expect(page.locator('#player-note')).toContainText('可能需要订阅');
  await expect(page.getByRole('link', { name: '打开官方页面' })).toHaveAttribute('href', 'https://www.cnn.com/live-tv');
  await expect(page.getByRole('link', { name: '打开官方页面' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(mediaRequests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#player-dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '观看 CNN', exact: true })).toBeFocused();
});

test('direction keys follow the channel grid and slash focuses search', async ({ page }) => {
  await routeLocalMedia(page);
  await page.goto('/');
  const cards = page.locator('.channel-open');
  await cards.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(1)).toBeFocused();
  const columns = await page.locator('.channel-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(1 + columns)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: '搜索频道' })).toBeFocused();
});

test('desktop installation metadata and icons are available and valid', async ({ page, request }) => {
  await routeLocalMedia(page);
  await page.goto('/');
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestPath).toBeTruthy();
  const response = await request.get(manifestPath!);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  const manifestUrl = new URL(manifestPath!, page.url());
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/');
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((item: { sizes: string }) => item.sizes === `${size}x${size}`);
    expect(icon).toBeTruthy();
    const dimensions = await page.evaluate(async (src: string) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, new URL(icon.src, manifestUrl).href);
    expect(dimensions).toEqual([size, size]);
  }
  const serviceWorker = await request.get('/sw.js');
  expect(serviceWorker.ok()).toBeTruthy();
  expect(serviceWorker.headers()['content-type']).toContain('javascript');
});

for (const channelName of ['CGTN', 'FRANCE 24']) {
  test(`${channelName} decodes real HLS media, switches actual resolution, and cleans up on close`, async ({ page }) => {
    const requests = await routeLocalMedia(page);
    await page.goto('/');
    await page.getByRole('button', { name: `观看 ${channelName}`, exact: true }).click();
    const video = page.locator('#player-video');
    const quality = page.locator('#player-quality');
    await expect(quality).toBeEnabled();
    await expect(quality.locator('option')).toHaveText([/自动/, '720p', '360p']);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.3);
    await quality.selectOption({ label: '360p' });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoHeight)).toBe(360);
    await expect(page.locator('#player-status')).toContainText('360p');
    const start = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(start + 0.3);
    await quality.selectOption({ label: '720p' });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoHeight)).toBe(720);
    await expect(page.locator('#player-status')).toContainText('720p');
    await expect(page.locator('#player-overlay')).not.toBeVisible();
    expect(requests.some(path => /360p-\d+\.ts$/.test(path))).toBeTruthy();
    expect(requests.some(path => /720p-\d+\.ts$/.test(path))).toBeTruthy();
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
    await expect(page.locator('#player-dialog')).not.toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
      paused: element.paused, source: element.getAttribute('src'), readyState: element.readyState,
    }))).toEqual({ paused: true, source: null, readyState: 0 });
    await expect(quality).toBeDisabled();
    await expect(quality.locator('option')).toHaveCount(1);
    // Reopening proves the destroyed HLS instance and quality listener are replaced.
    await page.getByRole('button', { name: `观看 ${channelName}`, exact: true }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
    await expect(quality).toBeEnabled();
  });
}

test('an unavailable manifest produces a useful recoverable error', async ({ page }) => {
  await routeLocalMedia(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: '观看 CGTN', exact: true }).click();
  await expect(page.locator('#player-status')).toHaveText('暂时无法播放');
  await expect(page.locator('#player-overlay')).toContainText(/片源连接失败|片源暂时无法播放/);
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '前往官网' })).toHaveAttribute('href', 'https://www.cgtn.com/tv');
  await expect(page.getByRole('combobox', { name: '画质', exact: true })).toBeDisabled();
  expect(await page.locator('#player-video').evaluate((element: HTMLVideoElement) => element.paused)).toBeTruthy();
});

test('phone layout and dialogs fit the viewport without horizontal scrolling', async ({ page }) => {
  await routeLocalMedia(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: join(mediaDirectory, 'home-mobile.png'), fullPage: true });
  await page.locator('#add-button').click();
  await expect(page.locator('#add-dialog')).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  const bounds = await page.locator('#add-dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: '关闭添加频道', exact: true }).click();
  await page.getByRole('button', { name: '观看 CNN', exact: true }).click();
  await expect(page.locator('#official-panel')).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(1);
});
