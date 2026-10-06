import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylist } from './playlist.ts';

test('M3U imports names and groups without splitting commas inside quoted metadata', () => {
  const result = parsePlaylist('\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-name="News, HD" group-title="World, live",\r\nhttps://example.com/news.m3u8?auth=a,b\r\n#EXTINF:-1 group-title="文化",A, B\r\nhttps://example.com/culture.mp4');
  assert.equal(result.format, 'm3u');
  assert.deepEqual(result.channels.map(({ name, group, url }) => ({ name, group, url })), [
    { name: 'News, HD', group: 'World, live', url: 'https://example.com/news.m3u8?auth=a,b' },
    { name: 'A, B', group: '文化', url: 'https://example.com/culture.mp4' },
  ]);
  assert.deepEqual(result.issues, []);
});

test('HLS master and media playlists are rejected with the single-channel action', () => {
  for (const body of [
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttps://example.com/hd.m3u8',
    '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts',
    '#EXTM3U\n#EXTINF:-1,News\nhttps://example.com/live.m3u8\n#EXT-X-VERSION:3',
  ]) assert.throws(() => parsePlaylist(body), /HLS.*添加频道/);
});

test('TXT preserves groups, signed commas and dollar query data while expanding explicit routes', () => {
  const result = parsePlaylist([
    '新闻,#genre#',
    '台一,https://example.com/a.m3u8$高清#https://example.com/b.m3u8 $备用',
    '台二,https://example.com/c.m3u8?token=a,b$cash',
    '台三,https://example.com/d.m3u8?token=a.mp4$cash',
    '台四,https://example.com/e.m3u8#chapter',
  ].join('\n'));
  assert.equal(result.format, 'txt');
  assert.deepEqual(result.channels.map((channel) => channel.url), [
    'https://example.com/a.m3u8', 'https://example.com/b.m3u8',
    'https://example.com/c.m3u8?token=a,b$cash', 'https://example.com/d.m3u8?token=a.mp4$cash',
    'https://example.com/e.m3u8#chapter',
  ]);
  assert.ok(result.channels.every((channel) => channel.group === '新闻'));
  assert.equal(result.channels[0].name, result.channels[1].name);
  assert.notEqual(result.channels[0].id, result.channels[1].id);
});

test('preview deduplicates normalized URLs against existing channels and within the import', () => {
  const result = parsePlaylist([
    '旧台,https://EXAMPLE.com:443/existing.m3u8',
    '同名,https://example.com/one.m3u8',
    '其他名,https://EXAMPLE.com:443/one.m3u8',
    '同名,https://example.com/two.m3u8',
  ].join('\n'), { existingUrls: ['https://example.com/existing.m3u8', 'not a URL'] });
  assert.equal(result.channels.length, 2);
  assert.equal(result.duplicates, 2);
  assert.equal(result.skipped, 0);
});

test('bad TXT entries are isolated with line numbers and unsupported URL features are explicit', () => {
  const result = parsePlaylist([
    '缺逗号',
    '无地址,',
    'UDP,udp://example.com/video.m3u8',
    'Header,https://example.com/a.m3u8|User-Agent=TVBox',
    '凭据,https://user:pass@example.com/a.m3u8',
    '无扩展,https://example.com/watch?stream=live.m3u8',
    '好台,https://example.com/good.webm',
  ].join('\n'));
  assert.equal(result.channels.length, 1);
  assert.equal(result.skipped, 6);
  assert.deepEqual(result.issues.map((issue) => issue.line), [1, 2, 3, 4, 5, 6]);
  assert.match(result.issues[2].message, /协议/);
  assert.match(result.issues[3].message, /请求头/);
  assert.match(result.issues[4].message, /用户名或密码/);
  assert.ok(!JSON.stringify(result.issues).includes('user:pass'));
});

test('HTTPS contexts skip HTTP media and references while HTTP remains available elsewhere', () => {
  const plain = '新闻,http://example.com/live.m3u8';
  assert.equal(parsePlaylist(plain).channels.length, 1);
  const secure = parsePlaylist(plain, { requireHttps: true });
  assert.equal(secure.skipped, 1);
  assert.match(secure.issues[0].message, /HTTPS/);
  const refs = parsePlaylist(JSON.stringify({ lives: [{ name: 'TV', url: 'http://example.com/list.txt' }] }), { requireHttps: true });
  assert.equal(refs.references.length, 0);
  assert.equal(refs.skipped, 1);
});

test('TVBox keeps static references separate from embedded channels and never evaluates plugins', () => {
  const result = parsePlaylist(JSON.stringify({
    spider: 'https://example.com/plugin.jar',
    sites: [{ api: 'javascript:throw new Error("do not execute")' }],
    parses: [{ url: 'https://example.com/parser' }],
    lives: [
      { name: '远程直播', type: 0, url: './live.txt' },
      { name: '节目组', channels: [{ name: '新闻', urls: ['https://example.com/live.m3u8', 'https://example.com/backup.m3u8'] }] },
      { group: '纪录片', channels: [{ name: '自然', url: 'https://example.com/nature.mp4' }] },
    ],
    urls: [{ name: '子配置', url: '../next.json' }],
  }), { sourceUrl: 'https://example.com/config/main.json' });
  assert.equal(result.format, 'tvbox');
  assert.deepEqual(result.references, [
    { name: '远程直播', url: 'https://example.com/config/live.txt', kind: 'playlist' },
    { name: '子配置', url: 'https://example.com/next.json', kind: 'config' },
  ]);
  assert.deepEqual(result.channels.map((channel) => channel.group), ['节目组', '节目组', '纪录片']);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /不执行插件/);
});

test('relative references require a source URL and reject dangerous resolved URLs', () => {
  const body = JSON.stringify({ urls: [
    { name: '相对', url: './next.json' },
    { name: '脚本', url: 'javascript:alert(1)' },
    { name: '凭据', url: 'https://user:secret@example.com/config.json' },
    { name: '外部', url: '//cdn.example.com/config.json' },
  ] });
  const withoutBase = parsePlaylist(body);
  assert.equal(withoutBase.references.length, 0);
  assert.equal(withoutBase.skipped, 4);
  const withBase = parsePlaylist(body, { sourceUrl: 'https://example.com/main.json' });
  assert.equal(withBase.references.length, 2);
  assert.equal(withBase.skipped, 2);
  assert.equal(withBase.references[1].url, 'https://cdn.example.com/config.json');
});

test('strict JSON is required and malformed entries do not hide valid siblings', () => {
  assert.throws(() => parsePlaylist('{"lives":[],}'), /JSON 格式无效/);
  assert.throws(() => parsePlaylist('{"lives": require("evil")}'), /JSON 格式无效/);
  const result = parsePlaylist(JSON.stringify([
    null,
    { name: '坏组', channels: 'oops' },
    { name: '正常', channels: [null, { name: '无台' }, { name: '坏地址', urls: [42] }, { name: '好台', urls: ['https://example.com/a.m3u8'] }] },
  ]));
  assert.equal(result.channels.length, 1);
  assert.equal(result.skipped, 5);
});

test('TVBox request-header requirements are never silently discarded at any scope', () => {
  const rootHeaders = parsePlaylist(JSON.stringify({
    headers: { Referer: 'https://example.com/' },
    lives: [{ name: '分组', channels: [{ name: '频道', urls: ['https://example.com/a.m3u8'] }] }],
    urls: [{ name: '配置', url: 'https://example.com/other.json' }],
  }));
  assert.equal(rootHeaders.channels.length, 0);
  assert.equal(rootHeaders.references.length, 0);
  assert.equal(rootHeaders.skipped, 2);
  const nested = parsePlaylist(JSON.stringify({ lives: [
    { name: '组级', ua: 'TVBox', channels: [{ name: '频道', urls: ['https://example.com/a.m3u8'] }] },
    { name: '列表', url: 'https://example.com/live.txt', 'User-Agent': 'TVBox' },
    { name: '混合', channels: [
      { name: '头', urls: ['https://example.com/a.m3u8'], Referer: 'https://example.com/' },
      { name: '有效', urls: ['https://example.com/b.m3u8'] },
    ] },
  ] }));
  assert.equal(nested.channels.length, 1);
  assert.equal(nested.references.length, 0);
  assert.equal(nested.skipped, 3);
  assert.ok(nested.issues.every((issue) => /UA.*Referer.*headers/.test(issue.message)));
});

test('M3U player/header requirements are skipped, and the next plain channel stays usable', () => {
  const result = parsePlaylist([
    '#EXTM3U',
    '#EXTINF:-1,特定播放器',
    '#EXTVLCOPT:http-user-agent=TVBox',
    'https://example.com/a.m3u8',
    '#EXTINF:-1 http-referrer="https://example.com/",请求头',
    'https://example.com/b.m3u8',
    '#EXTINF:-1,EXTHTTP',
    '#EXTHTTP:{"User-Agent":"TVBox"}',
    'https://example.com/c.m3u8',
    '#EXTINF:-1,普通',
    'https://example.com/d.m3u8',
  ].join('\n'));
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].name, '普通');
  assert.equal(result.skipped, 3);
});

test('incomplete M3U records are reported and do not steal a later name', () => {
  const result = parsePlaylist('#EXTM3U\nhttps://example.com/orphan.m3u8\n#EXTINF:-1,无地址\n#EXTINF:-1,好台\nhttps://example.com/a.m3u8\n#EXTINF:-1,末尾');
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].name, '好台');
  assert.equal(result.skipped, 3);
});

test('input byte, channel and reference limits fail visibly instead of silently truncating', () => {
  assert.throws(() => parsePlaylist('字'.repeat(700000)), /2 MiB/);
  assert.throws(() => parsePlaylist(Array.from({ length: 1001 }, (_, i) => `频道${i},https://example.com/${i}.m3u8`).join('\n')), /1000/);
  assert.equal(parsePlaylist(Array.from({ length: 1000 }, (_, i) => `频道${i},https://example.com/${i}.m3u8`).join('\n')).channels.length, 1000);
  assert.throws(() => parsePlaylist(JSON.stringify({ urls: Array.from({ length: 101 }, (_, i) => ({ name: `${i}`, url: `https://example.com/${i}.json` })) })), /100/);
});

test('warning limit remains bounded while skip counts include the full input', () => {
  const result = parsePlaylist(Array.from({ length: 150 }, () => '坏行').join('\n'));
  assert.equal(result.issues.length, 100);
  assert.equal(result.skipped, 150);
  assert.match(result.issues.at(-1)!.message, /省略.*完整统计/);
});
