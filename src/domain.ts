export type Channel = {
  id: string;
  name: string;
  group?: string;
  subtitle: string;
  description: string;
  category: '央视' | '国际' | '探索' | '自定义';
  language: string;
  country: string;
  accent: string;
  mark: string;
  mode: 'hls' | 'official' | 'video';
  url: string;
  officialUrl: string;
  sourceName: string;
  sourceUrl: string;
  note: string;
};

export type View = 'discover' | 'channels' | 'favorites';

export type Preferences = {
  favoriteIds: string[];
  customChannels: Channel[];
};

export const PREFERENCES_KEY = 'aura-tv:v1';

function publicUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`请填写${label}。`);
  }
  let result: URL;
  try {
    result = new URL(value.trim());
  } catch {
    throw new Error(`${label}必须是完整的 HTTP 或 HTTPS 地址。`);
  }
  if (!['https:', 'http:'].includes(result.protocol) || !result.hostname) {
    throw new Error(`${label}只支持 HTTP 或 HTTPS。`);
  }
  if (result.username || result.password) {
    throw new Error(`${label}不能包含用户名或密码。`);
  }
  return result;
}

function channelId(url: string): string {
  // Two independent hashes keep IDs short and stable without persisting secrets.
  let first = 2166136261;
  let second = 5381;
  for (const character of url) {
    const point = character.codePointAt(0)!;
    first = Math.imul(first ^ point, 16777619);
    second = Math.imul(second, 33) ^ point;
  }
  return `custom-${(first >>> 0).toString(16)}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseCustomChannel(input: {
  name: string;
  url: string;
  officialUrl?: string;
  group?: string;
}): Channel {
  if (!input || typeof input.name !== 'string') {
    throw new Error('请填写频道名称。');
  }
  const name = input.name.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 50) {
    throw new Error('频道名称需要 1–50 个字。');
  }
  if (input.group !== undefined && typeof input.group !== 'string') {
    throw new Error('频道分组必须是文字。');
  }
  const group = input.group?.trim() || undefined;
  if (group && Array.from(group).length > 60) {
    throw new Error('频道分组最多 60 个字。');
  }
  const mediaUrl = publicUrl(input.url, '播放地址');
  const path = mediaUrl.pathname.toLowerCase();
  const mode = path.endsWith('.m3u8')
    ? 'hls'
    : /\.(mp4|webm)$/.test(path)
      ? 'video'
      : null;
  if (!mode) {
    throw new Error('请使用以 .m3u8、.mp4 或 .webm 结尾的公开播放地址，可包含查询参数。');
  }
  const officialUrl = input.officialUrl === undefined || input.officialUrl === ''
    ? mediaUrl.href
    : publicUrl(input.officialUrl, '官方网站地址').href;
  return {
    id: channelId(mediaUrl.href),
    name,
    ...(group ? { group } : {}),
    subtitle: group || '自定义频道',
    description: '由你添加的公开内容，播放质量取决于原始片源。',
    category: '自定义',
    language: '未知',
    country: '自定义',
    accent: '#78e6bf',
    mark: Array.from(name).slice(0, 2).join(''),
    mode,
    url: mediaUrl.href,
    officialUrl,
    sourceName: '用户添加',
    sourceUrl: officialUrl,
    note: '请自行确认此播放地址公开可用且具有合法授权。',
  };
}

export function filterChannels(
  channels: Channel[],
  options: {
    query?: string;
    category?: string;
    favoritesOnly?: boolean;
    favoriteIds?: string[];
  } = {},
): Channel[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const favoriteIds = new Set(options.favoriteIds ?? []);
  return channels.filter((channel) => {
    if (options.category && options.category !== '全部' && channel.category !== options.category) {
      return false;
    }
    if (options.favoritesOnly && !favoriteIds.has(channel.id)) return false;
    if (!query) return true;
    return [channel.name, channel.subtitle, channel.country, channel.language, channel.group ?? '']
      .some((field) => field.toLocaleLowerCase().includes(query));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPreferences(value: unknown): Preferences {
  const result: Preferences = { favoriteIds: [], customChannels: [] };
  if (!isRecord(value)) return result;
  if (Array.isArray(value.favoriteIds)) {
    result.favoriteIds = [...new Set(value.favoriteIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200,
    ))];
  }
  if (Array.isArray(value.customChannels)) {
    const seen = new Set<string>();
    for (const entry of value.customChannels) {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.url !== 'string') continue;
      if (entry.officialUrl !== undefined && typeof entry.officialUrl !== 'string') continue;
      if (entry.group !== undefined && typeof entry.group !== 'string') continue;
      try {
        const channel = parseCustomChannel({
          name: entry.name,
          url: entry.url,
          officialUrl: entry.officialUrl as string | undefined,
          group: entry.group as string | undefined,
        });
        if (!seen.has(channel.id)) {
          result.customChannels.push(channel);
          seen.add(channel.id);
        }
      } catch {
        // One stale or unsafe entry should not erase the other saved channels.
      }
    }
  }
  return result;
}

export function readPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  try {
    const saved = storage.getItem(PREFERENCES_KEY);
    return saved ? validPreferences(JSON.parse(saved)) : validPreferences(null);
  } catch {
    // Private browsing, blocked storage, and corrupt JSON all use safe defaults.
    return validPreferences(null);
  }
}

export function writePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: Preferences,
): boolean {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(validPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

export function escapeHtml(input: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return input.replace(/[&<>"']/g, (character) => entities[character]);
}
