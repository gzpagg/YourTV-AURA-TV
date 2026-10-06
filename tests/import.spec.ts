import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const listOrigin = 'https://lists.example.test';
const corsHeaders = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

async function openImporter(page: Page): Promise<void> {
  await page.locator('#add-button').click();
  await page.locator('#import-entry').click();
  await expect(page.locator('#add-dialog')).not.toBeVisible();
  await expect(page.locator('#import-dialog')).toBeVisible();
}

async function parseText(page: Page, text: string): Promise<void> {
  await page.locator('#import-content').fill(text);
  await page.locator('#import-parse').click();
}

test.beforeEach(async ({ page }) => {
  // Never contact a public media, list, or plugin endpoint during these tests.
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.goto('/');
  await openImporter(page);
});

test('TXT preview counts rejected and duplicate entries, and selected groups survive reload', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname.endsWith('.example.test')) externalRequests.push(request.url());
  });
  await parseText(page, [
    '科学探索,#genre#',
    '公开科学台,https://streams.example.test/science.m3u8',
    '公开科学台备份名称,https://streams.example.test/science.m3u8',
    '公开自然台,https://streams.example.test/nature.m3u8',
    '危险地址,javascript:alert(1)',
    '含凭据地址,https://user:password@streams.example.test/private.m3u8',
  ].join('\n'));
  await expect(page.locator('.import-summary')).toContainText('2 个可导入频道');
  await expect(page.locator('.import-summary')).toContainText('1 个重复 · 2 个跳过 · 0 个关联列表');
  await expect(page.locator('.import-channel-row')).toHaveCount(2);
  await expect(page.locator('.import-channel-row').first()).toContainText('科学探索');
  await page.locator('[data-import-index="1"]').uncheck();
  await expect(page.locator('#import-selected')).toContainText('已选择 1 个频道');
  await page.locator('#import-confirm').click();
  await expect(page.locator('#import-dialog')).not.toBeVisible();
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '观看 公开科学台', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索频道' }).fill('科学探索');
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.locator('.channel-card')).toContainText('公开科学台');
  await expect(page.locator('.channel-card')).toContainText('科学探索');
  expect(externalRequests).toEqual([]);
});

test('a local M3U file imports channel names and group metadata', async ({ page }) => {
  const text = '\uFEFF#EXTM3U\n#EXTINF:-1 tvg-id="public.science" group-title="本地科学",本地测试频道\nhttps://streams.example.test/local.m3u8\n';
  await page.locator('#import-file').setInputFiles({
    name: 'channels.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from(text),
  });
  // Blob.text() decodes UTF-8 and strips its optional byte order mark.
  await expect(page.locator('#import-content')).toHaveValue(text.replace(/^\uFEFF/, ''));
  await page.locator('#import-parse').click();
  await expect(page.locator('.import-summary')).toContainText('1 个可导入频道');
  await expect(page.locator('.import-channel-row')).toContainText('本地科学');
  await page.locator('#import-confirm').click();
  await expect(page.getByRole('button', { name: '观看 本地测试频道', exact: true })).toBeVisible();
});

test('an HLS media manifest is explained instead of imported as a channel list', async ({ page }) => {
  await parseText(page, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n');
  await expect(page.locator('#import-error')).toContainText('这是 HLS 播放清单，不是频道列表');
  await expect(page.locator('#import-error')).toContainText('添加频道');
  await expect(page.locator('#import-preview')).not.toBeVisible();
  await expect(page.locator('#import-confirm')).toBeDisabled();
});

test('TVBox relative live lists are fetched only on selection and plugins never load', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname.endsWith('.example.test')) requested.push(request.url());
  });
  await page.route(`${listOrigin}/config/live/channels.txt`, route => route.fulfill({
    status: 200, headers: corsHeaders, contentType: 'text/plain',
    body: '国际公开,#genre#\n关联列表频道,https://streams.example.test/public.m3u8',
  }));
  await page.locator('#import-url').fill(`${listOrigin}/config/tvbox.json`);
  await parseText(page, JSON.stringify({
    spider: `${listOrigin}/untrusted.jar`,
    sites: [{ key: 'ignored', api: `${listOrigin}/untrusted.js` }],
    lives: [{ name: '公开直播列表', type: 0, url: './live/channels.txt' }],
  }));
  await expect(page.locator('.import-summary')).toContainText('0 个可导入频道');
  await expect(page.locator('.import-summary')).toContainText('1 个关联列表');
  await expect(page.locator('.import-reference-row')).toContainText(`${listOrigin}/config/live/channels.txt`);
  await page.locator('.import-issues summary').click();
  await expect(page.locator('.import-issues')).toContainText('不执行插件');
  expect(requested).toEqual([]);
  await page.locator('[data-import-reference="0"]').click();
  await expect(page.locator('.import-channel-row')).toContainText('关联列表频道');
  expect(requested).toEqual([`${listOrigin}/config/live/channels.txt`]);
  await page.locator('#import-confirm').click();
  await expect(page.getByRole('button', { name: '观看 关联列表频道', exact: true })).toBeVisible();
  expect(requested).toEqual([`${listOrigin}/config/live/channels.txt`]);
});

test('GitHub blob links read the raw file without requesting the repository page', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => {
    const hostname = new URL(request.url()).hostname;
    if (hostname === 'github.com' || hostname === 'raw.githubusercontent.com') requested.push(request.url());
  });
  const rawUrl = 'https://raw.githubusercontent.com/example/channels/main/public.txt';
  await page.route(rawUrl, route => route.fulfill({
    status: 200, headers: corsHeaders, contentType: 'text/plain',
    body: 'Raw 列表频道,https://streams.example.test/raw.m3u8',
  }));
  await page.locator('[data-import-mode="url"]').click();
  await page.locator('#import-url').fill('https://github.com/example/channels/blob/main/public.txt');
  await page.locator('#import-parse').click();
  await expect(page.locator('.import-channel-row')).toContainText('Raw 列表频道');
  expect(requested).toEqual([rawUrl]);
});

for (const failure of ['network', '503'] as const) {
  test(`remote ${failure} failures explain the local import alternative`, async ({ page }) => {
    await page.route(`${listOrigin}/unavailable.txt`, async route => {
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ status: 503, headers: corsHeaders, contentType: 'text/plain', body: 'Unavailable fixture' });
    });
    await page.locator('[data-import-mode="url"]').click();
    await page.locator('#import-url').fill(`${listOrigin}/unavailable.txt`);
    await page.locator('#import-parse').click();
    await expect(page.locator('#import-error')).toContainText(failure === 'network' ? '网络或跨域限制' : 'HTTP 503');
    await expect(page.locator('#import-error')).toContainText(failure === 'network' ? '下载文件后导入' : '导入本地文件');
    await expect(page.locator('#import-confirm')).toBeDisabled();
    await expect(page.locator('#import-parse')).toBeEnabled();
  });
}

test('editing either source input invalidates an earlier selection', async ({ page }) => {
  await parseText(page, '旧频道,https://streams.example.test/old.m3u8');
  await expect(page.locator('#import-confirm')).toBeEnabled();
  await page.locator('#import-content').fill('新频道,https://streams.example.test/new.m3u8');
  await expect(page.locator('#import-confirm')).toBeDisabled();
  await expect(page.locator('#import-preview')).not.toBeVisible();
  await page.locator('#import-parse').click();
  await expect(page.locator('.import-channel-row')).toContainText('新频道');
  await expect(page.locator('#import-confirm')).toBeEnabled();
  await page.locator('#import-url').fill(`${listOrigin}/another.txt`);
  await expect(page.locator('#import-confirm')).toBeDisabled();
  await expect(page.locator('#import-preview')).not.toBeVisible();
});

test('closing an in-flight list request cancels it and cannot replace a new preview', async ({ page }) => {
  let releaseResponse!: () => void;
  let signalRequest!: () => void;
  let signalHandled!: () => void;
  const gate = new Promise<void>(resolve => { releaseResponse = resolve; });
  const received = new Promise<void>(resolve => { signalRequest = resolve; });
  const handled = new Promise<void>(resolve => { signalHandled = resolve; });
  await page.route(`${listOrigin}/slow.txt`, async route => {
    signalRequest();
    await gate;
    try {
      await route.fulfill({
        status: 200, headers: corsHeaders, contentType: 'text/plain',
        body: '已关闭请求的旧频道,https://streams.example.test/stale.m3u8',
      });
    } catch { /* The browser may already have disposed of the aborted request. */ }
    finally { signalHandled(); }
  });
  await page.locator('[data-import-mode="url"]').click();
  await page.locator('#import-url').fill(`${listOrigin}/slow.txt`);
  await page.locator('#import-parse').click();
  await received;
  const failed = page.waitForEvent('requestfailed', request => request.url() === `${listOrigin}/slow.txt`);
  await page.locator('#import-close').click();
  await expect(page.locator('#import-dialog')).not.toBeVisible();
  await openImporter(page);
  await page.locator('[data-import-mode="text"]').click();
  await parseText(page, '新预览频道,https://streams.example.test/fresh.m3u8');
  await expect(page.locator('.import-channel-row')).toContainText('新预览频道');
  releaseResponse();
  await handled;
  await failed;
  await expect(page.locator('.import-channel-row')).toHaveCount(1);
  await expect(page.locator('.import-channel-row')).toContainText('新预览频道');
  await expect(page.locator('#import-error')).toBeEmpty();
  await expect(page.locator('#import-confirm')).toBeEnabled();
});

test('the importer fits a 390px viewport with long names and linked URLs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await parseText(page, JSON.stringify({
    lives: [
      { group: '很长的分组标题用于检查窄屏显示', channels: [{ name: '这是一个很长的公开频道名称用于测试窄屏时正确换行', urls: ['https://streams.example.test/long-name.m3u8'] }] },
      { name: '公开关联列表', url: `${listOrigin}/${'nested/'.repeat(20)}channels.txt` },
    ],
  }));
  await expect(page.locator('.import-channel-row')).toHaveCount(1);
  await expect(page.locator('.import-reference-row')).toHaveCount(1);
  const bounds = await page.locator('#import-dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  const overflow = await page.locator('#import-dialog').evaluate(dialog => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    dialog: dialog.scrollWidth - dialog.clientWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.dialog).toBeLessThanOrEqual(1);
  await expect(page.locator('#import-confirm')).toBeInViewport();
});
