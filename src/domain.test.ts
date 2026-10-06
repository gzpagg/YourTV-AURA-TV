import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  filterChannels,
  parseCustomChannel,
  PREFERENCES_KEY,
  readPreferences,
  writePreferences,
} from './domain.ts';
import type { Channel } from './domain.ts';

const demo = () => parseCustomChannel({
  name: ' 示例频道 ',
  url: 'https://example.com/live/playlist.m3u8?quality=hd',
  officialUrl: 'https://example.com/about',
});

test('custom streams retain signed query parameters and receive stable IDs', () => {
  const channel = demo();
  assert.equal(channel.name, '示例频道');
  assert.equal(channel.mode, 'hls');
  assert.equal(channel.mark, '示例');
  assert.equal(channel.category, '自定义');
  assert.equal(channel.url, 'https://example.com/live/playlist.m3u8?quality=hd');
  assert.equal(channel.sourceUrl, 'https://example.com/about');
  assert.match(channel.note, /授权/);
  assert.equal(channel.id, demo().id);
  assert.equal(channel.id, parseCustomChannel({ name: '新名称', url: channel.url }).id);
  assert.notEqual(channel.id, parseCustomChannel({ name: '其他', url: 'https://example.com/other.m3u8' }).id);
});

test('accepts HLS and supported video extensions independent of query and case', () => {
  for (const [url, mode] of [
    ['https://example.com/LIVE.M3U8?token=abc#live', 'hls'],
    ['https://example.com/movie.mp4?name=.m3u8', 'video'],
    ['http://example.com/movie.webm', 'video'],
  ]) {
    const channel = parseCustomChannel({ name: '频道', url });
    assert.equal(channel.mode, mode);
    assert.equal(channel.officialUrl, url);
  }
});

test('rejects unsupported schemes, credential URLs, and misleading media URLs', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///tmp/stream.m3u8',
    'data:text/plain,.m3u8',
    'ftp://example.com/live.m3u8',
    '//example.com/live.m3u8',
    'https://user:password@example.com/live.m3u8',
    'https://user@example.com/live.m3u8',
    'https://example.com/watch?video=live.m3u8',
    'https://example.com/stream.m3u8/other',
    'not a url',
    '',
  ]) {
    assert.throws(() => parseCustomChannel({ name: '频道', url }), Error, url);
  }
  for (const officialUrl of ['javascript:alert(1)', 'https://user:pass@example.com', 'file:///tmp/index.html']) {
    assert.throws(() => parseCustomChannel({ name: '频道', url: demo().url, officialUrl }));
  }
});

test('validates name length while treating Unicode characters as complete characters', () => {
  for (const name of ['', '  ', '字'.repeat(51)]) {
    assert.throws(() => parseCustomChannel({ name, url: demo().url }));
  }
  assert.equal(parseCustomChannel({ name: '字'.repeat(50), url: demo().url }).name.length, 50);
  assert.equal(parseCustomChannel({ name: '📺🌏 News', url: demo().url }).mark, '📺🌏');
});

test('search and category/favorite filters compose without mutating the catalog', () => {
  const international: Channel = {
    ...demo(), id: 'cnn', name: 'CNN', subtitle: 'World news',
    category: '国际', country: '美国', language: 'English',
  };
  const cctv: Channel = {
    ...demo(), id: 'cctv', name: 'CCTV 新闻', subtitle: '新闻现场',
    category: '央视', country: '中国', language: '中文',
  };
  const channels = [international, cctv, demo()];
  assert.deepEqual(filterChannels(channels, { query: ' cnn ' }), [international]);
  assert.deepEqual(filterChannels(channels, { query: 'WORLD' }), [international]);
  assert.deepEqual(filterChannels(channels, { query: '中国' }), [cctv]);
  assert.deepEqual(filterChannels(channels, { query: 'english' }), [international]);
  assert.deepEqual(filterChannels(channels, {
    category: '国际', favoritesOnly: true, favoriteIds: ['cnn'], query: 'News',
  }), [international]);
  assert.deepEqual(filterChannels(channels, { category: '央视', favoritesOnly: true, favoriteIds: ['cnn'] }), []);
  assert.deepEqual(filterChannels(channels, { favoritesOnly: true }), []);
  assert.deepEqual(filterChannels(channels, { category: '全部', query: '' }), channels);
  assert.equal(channels.length, 3);
});

test('preferences round-trip through the versioned key', () => {
  const saved = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => { saved.set(key, value); },
    getItem: (key: string) => saved.get(key) ?? null,
  };
  const preferences = { favoriteIds: ['cctv', demo().id], customChannels: [demo()] };
  assert.equal(writePreferences(storage, preferences), true);
  assert.ok(saved.has(PREFERENCES_KEY));
  assert.deepEqual(readPreferences(storage), preferences);
});

test('corrupt and unavailable storage returns safe defaults', () => {
  const empty = { favoriteIds: [], customChannels: [] };
  for (const value of [null, '', '{oops', 'null', '[]', '42', '{"favoriteIds":null,"customChannels":{}}']) {
    assert.deepEqual(readPreferences({ getItem: () => value }), empty);
  }
  assert.deepEqual(readPreferences({ getItem: () => { throw new Error('blocked'); } }), empty);
  assert.equal(writePreferences({ setItem: () => { throw new Error('quota'); } }, empty), false);
});

test('restored channels are validated, deduplicated, and rebuilt instead of trusting stored HTML or modes', () => {
  const safe = demo();
  const saved = {
    favoriteIds: ['cctv', 'cctv', '', null, 42],
    customChannels: [
      { ...safe, id: 'spoofed', mode: 'official', accent: 'url(javascript:evil)', sourceUrl: 'javascript:evil' },
      safe,
      { ...safe, url: 'javascript:alert(1)' },
      { ...safe, officialUrl: 'javascript:alert(1)' },
      { ...safe, name: null },
      { ...safe, officialUrl: 42 },
      null,
    ],
  };
  assert.deepEqual(readPreferences({ getItem: () => JSON.stringify(saved) }), {
    favoriteIds: ['cctv'],
    customChannels: [safe],
  });
});

test('HTML escaping protects text and quoted attributes', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'alert(1)\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
  assert.equal(escapeHtml('央视 📺'), '央视 📺');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('groups are trimmed, searchable and preserved through preferences', () => {
  const channel = parseCustomChannel({ name: '频道', url: demo().url, group: '  国际新闻  ' });
  assert.equal(channel.group, '国际新闻');
  assert.equal(channel.subtitle, '国际新闻');
  assert.deepEqual(filterChannels([{ ...channel, subtitle: '直播' }], { query: '国际新闻' }), [{ ...channel, subtitle: '直播' }]);
  let saved = '';
  assert.equal(writePreferences({ setItem: (_key, value) => { saved = value; } }, {
    favoriteIds: [channel.id], customChannels: [channel],
  }), true);
  assert.deepEqual(readPreferences({ getItem: () => saved }).customChannels, [channel]);
  assert.equal(parseCustomChannel({ name: '频道', url: demo().url, group: ' ' }).group, undefined);
  for (const group of ['字'.repeat(61), 42]) {
    assert.throws(() => parseCustomChannel({ name: '频道', url: demo().url, group: group as string }));
    assert.deepEqual(readPreferences({ getItem: () => JSON.stringify({ customChannels: [{ ...channel, group }] }) }).customChannels, []);
  }
});
