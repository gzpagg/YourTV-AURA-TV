import { parseCustomChannel } from './domain.ts';
import type { Channel } from './domain.ts';

export type PlaylistResult = {
  format: 'm3u' | 'txt' | 'tvbox';
  channels: Channel[];
  references: Array<{ name: string; url: string; kind: 'playlist' | 'config' }>;
  issues: Array<{ line?: number; message: string }>;
  duplicates: number;
  skipped: number;
};

export type PlaylistOptions = {
  sourceUrl?: string;
  existingUrls?: string[];
  requireHttps?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function needsHeaders(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => /^(ua|useragent|referer|referrer|headers?|playheaders|httpuseragent|httpreferer|httpreferrer|httpheaders)$/.test(
    key.toLowerCase().replace(/[-_]/g, ''),
  ));
}

function namedRoutes(value: string): string[] {
  return value.split(/#(?=https?:\/\/)/i).map((route) => {
    // A dollar in a signed query is data. Only remove an unambiguous route label.
    return route.trim()
      .replace(/\s+\$[^\r\n]+$/, '')
      .replace(/^([^?#]*\.(?:m3u8|mp4|webm))\$([^$?/#&=]+)$/i, '$1')
      .trim();
  });
}

function extinfParts(value: string): { metadata: string; name: string } {
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      return { metadata: value.slice(0, index), name: value.slice(index + 1).trim() };
    }
  }
  return { metadata: value, name: '' };
}

function attribute(metadata: string, name: string): string | undefined {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s]+))`, 'i');
  const match = expression.exec(metadata);
  return match ? match[1] ?? match[2] ?? match[3] : undefined;
}

/** Parse static data only: this function never fetches a URL or executes TVBox plugins. */
export function parsePlaylist(text: string, options: PlaylistOptions = {}): PlaylistResult {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请粘贴或选择非空的频道列表。');
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
    throw new Error('列表超过 2 MiB，请拆分后再导入。');
  }
  const input = text.replace(/^\uFEFF/, '').trim();
  const isJson = /^(?:\{|\[)/.test(input);
  if (!isJson && /^\s*#EXT-X-/im.test(input)) {
    throw new Error('这是 HLS 播放清单，不是频道列表。请使用「添加频道」填写原始 .m3u8 地址。');
  }
  const result: PlaylistResult = {
    format: isJson ? 'tvbox' : /^\s*#EXT(?:M3U|INF)\b/im.test(input) ? 'm3u' : 'txt',
    channels: [], references: [], issues: [], duplicates: 0, skipped: 0,
  };
  const seen = new Set<string>();
  const referenceSeen = new Set<string>();
  for (const existing of options.existingUrls ?? []) {
    try { seen.add(new URL(existing).href); } catch { /* Ignore stale caller data. */ }
  }
  function issue(message: string, line?: number): void {
    if (result.issues.length < 99) {
      result.issues.push({ ...(line === undefined ? {} : { line }), message });
    } else if (result.issues.length === 99) {
      result.issues.push({ message: '提示超过 99 条；后续详细提示已省略，跳过与重复数量仍完整统计。' });
    }
  }
  function skip(message: string, line?: number): void {
    result.skipped++;
    issue(message, line);
  }
  function resolve(raw: string): string {
    if (raw.includes('|')) throw new Error('带有 | 请求头后缀的地址需要专用播放器，已跳过。');
    let url: URL;
    try {
      const trimmed = raw.trim();
      // Relative references require an explicit source; never resolve against the app origin.
      url = options.sourceUrl ? new URL(trimmed, options.sourceUrl) : new URL(trimmed);
    } catch {
      throw new Error('地址不完整或无效；相对地址需要有效的列表来源 URL。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error('仅支持 HTTP / HTTPS 地址；插件、代理和其他协议不会执行。');
    }
    if (url.username || url.password) throw new Error('地址含用户名或密码，已跳过。');
    if (options.requireHttps && url.protocol !== 'https:') {
      throw new Error('当前页面使用 HTTPS，HTTP 地址会被浏览器阻止，已跳过。');
    }
    return url.href;
  }
  function addMedia(name: unknown, raw: unknown, group?: unknown, line?: number): void {
    if (typeof name !== 'string' || typeof raw !== 'string' || !raw.trim()) {
      skip('频道需要文字名称和非空播放地址。', line);
      return;
    }
    for (const route of namedRoutes(raw)) {
      let channel: Channel;
      try {
        channel = parseCustomChannel({ name, url: resolve(route), group: group as string | undefined });
      } catch (error) {
        skip(error instanceof Error ? error.message : '频道数据无效。', line);
        continue;
      }
      if (seen.has(channel.url)) {
        result.duplicates++;
        continue;
      }
      if (result.channels.length === 1000) throw new Error('列表超过 1000 个可导入频道，请拆分后重试。');
      seen.add(channel.url);
      result.channels.push(channel);
    }
  }
  function addReference(name: unknown, raw: unknown, kind: 'playlist' | 'config', blocked = false): void {
    if (blocked) { skip('外部引用包含 UA / Referer / headers 要求，当前播放器不支持，已跳过。'); return; }
    if (typeof raw !== 'string' || !raw.trim()) { skip('外部引用缺少有效 URL。'); return; }
    let url: string;
    try { url = resolve(raw); } catch (error) { skip((error as Error).message); return; }
    if (referenceSeen.has(`${kind}:${url}`)) { result.duplicates++; return; }
    if (result.references.length === 100) throw new Error('列表超过 100 个外部引用，请拆分后重试。');
    referenceSeen.add(`${kind}:${url}`);
    result.references.push({ name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : '外部列表', url, kind });
  }
  if (result.format === 'tvbox') {
    let data: unknown;
    try { data = JSON.parse(input); } catch { throw new Error('JSON 格式无效；仅支持严格 JSON，不支持 JavaScript、注释或插件。'); }
    if (!record(data) && !Array.isArray(data)) throw new Error('TVBox 配置需要 JSON 对象或直播分组数组。');
    let pluginWarning = false;
    const inspect = (value: Record<string, unknown>): void => {
      if (!pluginWarning && Object.keys(value).some((key) => /^(spider|sites|parses|jar)$/i.test(key))) {
        issue('已忽略 spider / sites / parses / JAR：仅提取静态直播数据，不执行插件、爬虫或解析接口。');
        pluginWarning = true;
      }
    };
    function channels(container: Record<string, unknown>, inheritedHeaders: boolean): void {
      inspect(container);
      if (!Array.isArray(container.channels)) { skip('直播分组 channels 必须是数组。'); return; }
      const group = container.group ?? container.name;
      const blocked = inheritedHeaders || needsHeaders(container);
      for (const channel of container.channels) {
        if (!record(channel)) { skip('直播分组中的频道条目必须是对象。'); continue; }
        inspect(channel);
        if (blocked || needsHeaders(channel)) {
          skip('频道包含 UA / Referer / headers 要求，当前播放器不支持，已跳过。');
          continue;
        }
        const urls = Array.isArray(channel.urls) ? channel.urls : channel.url !== undefined ? [channel.url] : [];
        if (!urls.length) { skip('频道没有可用的静态播放地址。'); continue; }
        for (const url of urls) addMedia(channel.name, url, channel.group ?? group);
      }
    }
    function live(value: unknown, inheritedHeaders: boolean): void {
      if (!record(value)) { skip('直播条目必须是静态 JSON 对象。'); return; }
      inspect(value);
      if ('channels' in value) channels(value, inheritedHeaders);
      else if ('url' in value) addReference(value.name, value.url, 'playlist', inheritedHeaders || needsHeaders(value));
      else skip('直播条目没有 channels 或外部列表 URL。');
    }
    if (Array.isArray(data)) {
      for (const entry of data) live(entry, false);
    } else {
      const root = data as Record<string, unknown>;
      inspect(root);
      const blocked = needsHeaders(root);
      if ('channels' in root) channels(root, false);
      if ('lives' in root) {
        if (Array.isArray(root.lives)) for (const entry of root.lives) live(entry, blocked);
        else skip('lives 必须是静态直播条目数组。');
      }
      if ('urls' in root) {
        if (Array.isArray(root.urls)) {
          for (const reference of root.urls) {
            if (record(reference)) {
              inspect(reference);
              addReference(reference.name, reference.url, 'config', blocked || needsHeaders(reference));
            } else skip('配置引用必须包含 name 和 url。');
          }
        } else skip('urls 必须是配置引用数组。');
      }
      if (!('channels' in root) && !('lives' in root) && !('urls' in root)) {
        issue('此 JSON 未提供可读取的静态 lives、channels 或 urls 列表。');
      }
    }
    return result;
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (result.format === 'txt') {
    let group: string | undefined;
    lines.forEach((raw, index) => {
      const value = raw.trim();
      if (!value || value.startsWith('#') || value.startsWith('//')) return;
      const comma = value.indexOf(',');
      if (comma < 0) { skip('TXT 每行需要「频道名,播放地址」或「分组名,#genre#」。', index + 1); return; }
      const name = value.slice(0, comma).trim();
      const url = value.slice(comma + 1).trim();
      if (url.toLowerCase() === '#genre#') { group = name || undefined; return; }
      addMedia(name, url, group, index + 1);
    });
    return result;
  }

  let pending: { name: string; group?: string; blocked: boolean; line: number } | undefined;
  let unscopedHeaders = false;
  lines.forEach((raw, index) => {
    const value = raw.trim();
    if (!value) return;
    if (/^#EXTINF:/i.test(value)) {
      if (pending) skip('上一条 EXTINF 缺少播放地址。', pending.line);
      const { metadata, name } = extinfParts(value.slice(value.indexOf(':') + 1));
      pending = {
        name: name || attribute(metadata, 'tvg-name') || '',
        group: attribute(metadata, 'group-title'),
        blocked: unscopedHeaders || /(?:^|\s)(?:http-)?(?:user-agent|referer|referrer|headers?)\s*=/i.test(metadata),
        line: index + 1,
      };
    } else if (/^#(?:EXTVLCOPT|KODIPROP|EXTHTTP):/i.test(value)) {
      if (pending) pending.blocked = true;
      else unscopedHeaders = true;
    } else if (/^#EXTGRP:/i.test(value)) {
      if (pending) pending.group = value.slice(value.indexOf(':') + 1).trim();
    } else if (value.startsWith('#')) {
      if (/^#EXTM3U\b/i.test(value) && /(?:user-agent|referer|referrer|headers?)\s*=/i.test(value)) unscopedHeaders = true;
    } else {
      if (!pending) skip('M3U 播放地址前缺少 EXTINF 频道名称。', index + 1);
      else if (pending.blocked) skip('频道附带播放器属性或请求头要求，当前播放器不支持，已跳过。', index + 1);
      else addMedia(pending.name, value, pending.group, index + 1);
      pending = undefined;
    }
  });
  if (pending) skip('最后一条 EXTINF 缺少播放地址。', pending.line);
  return result;
}
