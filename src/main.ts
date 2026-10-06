import './styles.css';
import { channels as catalog } from './catalog';
import { escapeHtml as e, filterChannels, parseCustomChannel, readPreferences, writePreferences } from './domain';
import type { Channel, View } from './domain';
import { TVPlayer } from './player';
import { createImporter } from './importer';

const paths: Record<string, string> = {
  discover: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  tv: '<rect x="3" y="5" width="18" height="13" rx="3"/><path d="M8 22h8M12 18v4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
const icon = (name: string, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.tv}</svg>`;

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
const preferences = readPreferences(storage() ?? { getItem: () => null });
let view: View = 'discover';
let category = '全部';
let query = '';
let activeChannel: Channel | null = null;
let previousFocus: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <a class="brand" href="#" aria-label="映界首页"><span class="brand-mark">${icon('tv')}</span><span><span class="brand-name">映界<span class="brand-period">.</span></span><span class="brand-subtitle">AURA TV</span></span></a>
      <div class="nav-section-label">我的电视</div>
      <nav>
        <button class="nav-button active" data-view="discover" aria-current="page"><span class="nav-icon">${icon('discover')}</span><span class="nav-label">发现</span></button>
        <button class="nav-button" data-view="channels"><span class="nav-icon">${icon('tv')}</span><span class="nav-label">所有频道</span><span class="nav-count" id="channel-count">${catalog.length}</span></button>
        <button class="nav-button" data-view="favorites"><span class="nav-icon">${icon('heart')}</span><span class="nav-label">我的收藏</span><span class="nav-count" id="favorite-count">0</span></button>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">世界很大。<br>坐下来，慢慢看。</div>
        <button class="source-badge" id="about-button">${icon('globe')}<span>公开内容 · 官方来源</span>${icon('chevron')}</button>
        <div class="sidebar-version">AURA TV <span>v0.1</span></div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumb">你的私人电视客厅<span> / </span><strong id="breadcrumb-view">发现</strong></div>
        <div class="topbar-actions">
          <label class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索频道、语言…" aria-label="搜索频道" autocomplete="off"/><kbd>/</kbd></label>
          <button class="icon-button" id="add-button" aria-label="添加频道" title="添加公开播放地址">${icon('plus')}</button>
          <button class="icon-button" id="install-button" aria-label="安装到 Windows 桌面" title="安装到桌面">${icon('download')}</button>
          <span class="desktop-badge">${icon('tv')}<span>桌面版</span></span>
        </div>
      </header>
      <main id="main-content" tabindex="-1"></main>
      <footer class="page-footer"><span>让世界，在眼前。</span><span>方向键浏览 <kbd>↵</kbd> 选择 <kbd>Esc</kbd> 返回</span></footer>
    </div>
  </div>
  <dialog id="player-dialog" class="modal player-dialog" aria-labelledby="player-title">
    <div class="modal-header"><div class="player-heading"><span class="eyebrow" id="player-kind"></span><h2 id="player-title"></h2></div><button class="icon-button close-button" data-close="player-dialog" aria-label="关闭播放器">${icon('close')}</button></div>
    <div class="player-screen" id="player-screen"><video id="player-video" controls playsinline preload="none"></video><div id="player-overlay" class="player-overlay" role="status"></div></div>
    <div id="official-panel" class="official-panel" hidden><div class="official-channel-mark" id="official-mark"></div><h3>在官方平台继续观看</h3><p id="official-description"></p><a id="official-primary" class="button primary" target="_blank" rel="noopener noreferrer">打开官方页面 ${icon('arrow')}</a></div>
    <div class="player-toolbar"><span class="player-status" id="player-status" role="status"></span><div class="player-actions"><label class="player-quality" id="quality-wrapper">画质 <select id="player-quality" aria-label="画质"><option value="-1">自动</option></select></label><button class="icon-button" id="fullscreen-button" aria-label="全屏播放">${icon('expand')}</button><button class="icon-button" id="player-favorite" aria-label="收藏当前频道">${icon('heart')}</button><button class="icon-button" id="delete-channel" aria-label="移除此自定义频道" hidden>${icon('trash')}</button></div></div>
    <div class="source-note"><p id="player-note"></p><div><a id="player-official" target="_blank" rel="noopener noreferrer">前往官网 ${icon('arrow')}</a><a id="player-source" target="_blank" rel="noopener noreferrer">查看来源 ${icon('arrow')}</a><button id="retry-button" class="text-button">重新连接</button></div></div>
  </dialog>
  <dialog id="add-dialog" class="modal add-dialog" aria-labelledby="add-title"><form id="add-form">
    <div class="modal-header"><div><span class="eyebrow">YOUR CHANNELS</span><h2 id="add-title">添加喜欢的频道</h2></div><button type="button" class="icon-button close-button" data-close="add-dialog" aria-label="关闭添加频道">${icon('close')}</button></div>
    <p class="form-hint">让好内容有个专属位置。添加你有权观看的公开 HLS 直播或视频地址。</p>
    <button type="button" class="import-entry" id="import-entry"><strong>批量导入频道</strong><span>M3U · TXT · TVBox 静态配置 →</span></button>
    <div class="form-field"><label for="channel-name">频道名称</label><input id="channel-name" name="name" required maxlength="50" placeholder="例如：我的纪录片频道"/></div>
    <div class="form-field"><label for="channel-url">播放地址</label><input id="channel-url" name="url" type="url" required placeholder="https://example.com/live.m3u8"/><span class="form-hint">支持 .m3u8、.mp4、.webm。源站需允许浏览器播放。</span></div>
    <div class="form-field"><label for="channel-official">官方网站 <span>（选填）</span></label><input id="channel-official" name="officialUrl" type="url" placeholder="https://example.com"/></div>
    <p class="form-error" id="form-error" role="alert"></p>
    <div class="modal-actions"><button type="button" class="button secondary" data-close="add-dialog">取消</button><button class="button primary" type="submit">${icon('plus')} 添加频道</button></div>
  </form></dialog>
  <dialog id="about-dialog" class="modal add-dialog" aria-labelledby="about-title"><div class="modal-header"><div><span class="eyebrow">MADE FOR YOUR SCREEN</span><h2 id="about-title">一个轻巧的电视客厅</h2></div><button class="icon-button" data-close="about-dialog" aria-label="关闭说明">${icon('close')}</button></div><div class="about-content"><p>映界把公开播放地址和官方观看入口放在一起。无账号、无广告、无后台媒体服务器，收藏只保存在这台设备。</p><h3>关于频道与高清</h3><p>央视、CNN、NASA+ 通过官方页面观看。CNN 完整直播可能需要订阅。France 24、CGTN、DW 尝试公开目录收录的直播源，可用性由源站决定。公开收录不代表内容授权。</p><p>播放支持自适应码率，并按片源实际提供的清晰度切换。不会把低清片源标成高清，也不绕过订阅或地区限制。</p><h3>装到 Windows 桌面</h3><p>用 Edge 或 Chrome 打开后，点击地址栏的安装图标；也可以在浏览器菜单中选择「应用 → 将此站点作为应用安装」。安装后拥有独立窗口，不需要 Electron。</p><p class="form-hint">直播需要联网。开发时支持 localhost，部署安装时请使用 HTTPS。</p><p class="form-hint"><a href="${import.meta.env.BASE_URL}licenses/hls.js-LICENSE.txt" target="_blank" rel="noopener noreferrer">开源组件声明</a> · <a href="${import.meta.env.BASE_URL}licenses/Apache-2.0.txt" target="_blank" rel="noopener noreferrer">Apache-2.0 许可证</a></p></div></dialog>
  <div class="toast" id="toast" role="status" hidden></div>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const main = $('#main-content');
const playerDialog = $<HTMLDialogElement>('#player-dialog');
const video = $<HTMLVideoElement>('#player-video');
const player = new TVPlayer({ video, overlay: $('#player-overlay'), status: $('#player-status'), quality: $<HTMLSelectElement>('#player-quality') });
const allChannels = () => [...catalog, ...preferences.customChannels];
const viewNames: Record<View, string> = { discover: '发现', channels: '所有频道', favorites: '我的收藏' };

function toast(message: string) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}

function persist() {
  const target = storage();
  if (!target || !writePreferences(target, preferences)) toast('此浏览器暂时无法保存，修改仅在本次打开期间保留。');
}

function card(channel: Channel): string {
  const favorite = preferences.favoriteIds.includes(channel.id);
  const theme = channel.id.startsWith('cctv') ? 'cctv' : channel.id.startsWith('custom-') ? 'custom' : channel.id;
  return `<article class="channel-card" data-theme="${e(theme)}" style="--card-accent:${e(channel.accent)}">
    <div class="channel-art">
      <span class="channel-category">${e(channel.country)} / ${e(channel.language)}</span>
      <button class="favorite-button ${favorite ? 'is-favorite' : ''}" data-favorite="${e(channel.id)}" aria-label="${favorite ? '取消收藏' : '收藏'} ${e(channel.name)}" aria-pressed="${favorite}">${icon('heart')}</button>
      <button class="channel-open" data-play="${e(channel.id)}" aria-label="观看 ${e(channel.name)}"><span class="channel-mark">${e(channel.mark).replace(/\n/g, '<br>')}</span><span class="card-art-decoration" aria-hidden="true"></span></button>
      <span class="card-live-badge">${channel.mode === 'official' ? icon('arrow') + ' 官方入口' : icon('play') + (channel.mode === 'video' ? ' 视频' : ' 直播频道')}</span>
    </div>
    <div class="channel-info"><div class="channel-title-row"><h3 class="channel-title">${e(channel.name)}</h3><button class="card-play-button" data-play="${e(channel.id)}" aria-label="打开 ${e(channel.name)}">${icon(channel.mode === 'official' ? 'arrow' : 'play')}</button></div><p class="channel-subtitle">${e(channel.subtitle)}</p><div class="channel-footer"><span class="channel-tag">${e(channel.category)}</span><span>${channel.mode === 'official' ? '官网观看' : '应用内播放'}</span></div></div>
  </article>`;
}

function render() {
  const currentFocus = document.activeElement as HTMLElement | null;
  const focusSelector = currentFocus?.dataset.favorite ? `[data-favorite="${CSS.escape(currentFocus.dataset.favorite)}"]` : currentFocus?.dataset.category ? `[data-category="${CSS.escape(currentFocus.dataset.category)}"]` : null;
  const list = filterChannels(allChannels(), { query, category, favoritesOnly: view === 'favorites', favoriteIds: preferences.favoriteIds });
  const intro = view === 'discover' ? ['现在，打开新视界。', '从熟悉的声音，到世界的另一面。好内容，都在这里。'] : view === 'channels' ? ['每个频道，都是一扇窗。', '汇聚官方频道与公开播放源，找到你感兴趣的世界。'] : ['喜欢的，留在这里。', '为常看的频道留一个位置，下次见面只需一次点击。'];
  const showHero = view === 'discover' && !query && category === '全部';
  main.innerHTML = `
    <div class="page-intro"><span class="eyebrow">${view === 'favorites' ? 'YOUR COLLECTION' : 'A WORLD WORTH WATCHING'}</span><h1>${intro[0]}</h1><p class="intro-description">${intro[1]}</p></div>
    ${showHero ? `<section class="hero" aria-label="精选频道"><div class="hero-copy"><div class="hero-kicker"><span class="live-dot"></span> 不同视角，同一个世界</div><h2>好内容，<br>正在发生<span>。</span></h2><p class="hero-description">从一则新闻出发，看见更大的世界。<br>让每一个平常的夜晚，多一点发现。</p><div class="hero-meta"><span>FRANCE 24</span><span>英语新闻</span><span>全天候视野</span></div><div class="hero-actions"><button class="button primary" data-play="france24">${icon('play')} 观看频道</button><button class="button secondary" data-action="all-channels">探索所有频道 ${icon('chevron')}</button></div></div><div class="hero-art" aria-hidden="true"><div class="planet-orbit"></div><div class="planet"></div><div class="hero-channel-brand">24<span>LIVE PERSPECTIVES</span></div><div class="hero-watermark">ON AIR / AROUND THE WORLD</div><div class="hero-caption"><span class="live-dot"></span> 世界从不停止精彩</div></div></section>` : ''}
    <section class="channels-section" aria-labelledby="channels-heading"><div class="section-heading"><div><h2 id="channels-heading">${query ? '搜索结果' : view === 'favorites' ? '我的频道' : '随心看，随时看'} <span class="section-count">${list.length}</span></h2><p class="section-description">${query ? `与「${e(query)}」相关的频道` : '一个入口，连接你的每一种好奇心。'}</p></div><button class="text-button" data-action="add-channel">${icon('plus')} 添加频道</button></div>
    <div class="filter-row" role="group" aria-label="频道分类">${['全部', '央视', '国际', '探索', '自定义'].map(item => `<button class="filter-chip ${item === category ? 'active' : ''}" data-category="${item}" aria-pressed="${item === category}">${item}</button>`).join('')}<span class="filter-note">${icon('globe')} 公开内容，安心探索</span></div>
    <div class="channel-grid" aria-live="polite">${list.length ? list.map(card).join('') : `<div class="empty-state">${icon(view === 'favorites' ? 'heart' : 'search')}<h3>${view === 'favorites' && !query && category === '全部' ? '留住喜欢的频道' : '还没有找到这个频道'}</h3><p>${view === 'favorites' && !query && category === '全部' ? '点击频道卡片上的爱心，建立你的专属片单。' : '试试其他关键词或分类，也可以添加自己的公开播放地址。'}</p><button class="button secondary" data-action="${query || category !== '全部' ? 'clear-filters' : 'all-channels'}">${query || category !== '全部' ? '清除筛选' : '去发现频道'}</button></div>`}</div></section>
    ${showHero ? `<div class="install-banner"><span class="install-banner-icon">${icon('tv')}</span><div><strong>把电视客厅，留在桌面。</strong><p>安装映界，用独立窗口享受更沉浸的观看体验。</p></div><button class="text-button" data-action="install">安装到桌面 ${icon('arrow')}</button></div>` : ''}`;
  $('#channel-count').textContent = String(allChannels().length);
  $('#favorite-count').textContent = String(allChannels().filter(c => preferences.favoriteIds.includes(c.id)).length);
  $('#breadcrumb-view').textContent = viewNames[view];
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (focusSelector) main.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
}

function setView(next: View) {
  view = next;
  category = '全部';
  query = '';
  $<HTMLInputElement>('#search').value = '';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function favorite(id: string) {
  const index = preferences.favoriteIds.indexOf(id);
  if (index >= 0) preferences.favoriteIds.splice(index, 1); else preferences.favoriteIds.push(id);
  persist();
  render();
  updatePlayerFavorite();
  toast(index >= 0 ? '已从收藏中移除' : '已加入我的收藏');
}

function updatePlayerFavorite() {
  const selected = !!activeChannel && preferences.favoriteIds.includes(activeChannel.id);
  $('#player-favorite').classList.toggle('is-favorite', selected);
  $('#player-favorite').setAttribute('aria-pressed', String(selected));
  $('#player-favorite').setAttribute('aria-label', selected ? '取消收藏当前频道' : '收藏当前频道');
}

function showDialog(id: string) {
  const dialog = $<HTMLDialogElement>(`#${id}`);
  previousFocus = document.activeElement as HTMLElement;
  dialog.showModal();
}

async function openChannel(id: string) {
  const channel = allChannels().find(item => item.id === id);
  if (!channel) return;
  activeChannel = channel;
  player.destroy();
  $('#player-title').textContent = channel.name;
  $('#player-kind').textContent = `${channel.category} / ${channel.language}`;
  $('#player-note').textContent = channel.note;
  $<HTMLAnchorElement>('#player-official').href = channel.officialUrl;
  $<HTMLAnchorElement>('#player-source').href = channel.sourceUrl;
  const external = channel.mode === 'official';
  $('#player-screen').hidden = external;
  $('#official-panel').hidden = !external;
  $('#quality-wrapper').hidden = external;
  $('#fullscreen-button').hidden = external;
  $('#retry-button').hidden = external;
  $('#delete-channel').hidden = channel.category !== '自定义';
  updatePlayerFavorite();
  if (!playerDialog.open) showDialog('player-dialog');
  if (external) {
    $('#official-mark').textContent = channel.mark;
    $('#official-description').textContent = channel.description;
    $('#player-status').textContent = '官方观看入口';
    $<HTMLAnchorElement>('#official-primary').href = channel.officialUrl;
  } else {
    await player.play(channel);
  }
}

document.addEventListener('click', (event) => {
  const element = (event.target as HTMLElement).closest<HTMLElement>('button, a.brand');
  if (!element) return;
  if (element.matches('a.brand')) { event.preventDefault(); setView('discover'); }
  if (element.dataset.view) setView(element.dataset.view as View);
  if (element.dataset.category) { category = element.dataset.category; render(); }
  if (element.dataset.play) void openChannel(element.dataset.play);
  if (element.dataset.favorite) favorite(element.dataset.favorite);
  if (element.dataset.close) $<HTMLDialogElement>(`#${element.dataset.close}`).close();
  switch (element.dataset.action) {
    case 'all-channels': setView('channels'); break;
    case 'add-channel': showDialog('add-dialog'); break;
    case 'clear-filters': query = ''; category = '全部'; $<HTMLInputElement>('#search').value = ''; render(); break;
    case 'install': void install(); break;
  }
});

$('#search').addEventListener('input', (event) => { query = (event.target as HTMLInputElement).value; render(); });
$('#add-button').addEventListener('click', () => showDialog('add-dialog'));
$('#about-button').addEventListener('click', () => showDialog('about-dialog'));
$('#install-button').addEventListener('click', () => void install());
$('#fullscreen-button').addEventListener('click', () => void player.fullscreen());
$('#player-favorite').addEventListener('click', () => { if (activeChannel) favorite(activeChannel.id); });
$('#retry-button').addEventListener('click', () => { if (activeChannel) void player.play(activeChannel); });
$('#delete-channel').addEventListener('click', () => {
  if (!activeChannel || activeChannel.category !== '自定义') return;
  preferences.customChannels = preferences.customChannels.filter(channel => channel.id !== activeChannel!.id);
  preferences.favoriteIds = preferences.favoriteIds.filter(id => id !== activeChannel!.id);
  persist(); playerDialog.close(); render(); toast('已移除自定义频道');
});

document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => {
    if (dialog === playerDialog) { player.destroy(); activeChannel = null; }
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
});

$('#add-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  try {
    const channel = parseCustomChannel({ name: String(data.get('name') ?? ''), url: String(data.get('url') ?? ''), officialUrl: String(data.get('officialUrl') ?? '').trim() });
    if (location.protocol === 'https:' && new URL(channel.url).protocol === 'http:') throw new Error('当前页面使用 HTTPS，请添加 HTTPS 播放地址，避免浏览器阻止不安全内容。');
    if (allChannels().some(existing => existing.url === channel.url)) throw new Error('这个播放地址已经在频道列表里了。');
    preferences.customChannels.push(channel);
    persist(); form.reset(); $('#form-error').textContent = '';
    $<HTMLDialogElement>('#add-dialog').close();
    setView('channels'); category = '自定义'; render(); toast('频道已添加，可以开始观看');
  } catch (error) { $('#form-error').textContent = error instanceof Error ? error.message : '请检查频道信息。'; }
});

document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  const editing = target.matches('input, textarea, select') || target.isContentEditable;
  if (!editing && event.key === '/' && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
  if (playerDialog.open) {
    if (!editing && (event.key === 'f' || event.key === 'F') && activeChannel?.mode !== 'official') { event.preventDefault(); void player.fullscreen(); }
    return;
  }
  if (editing || document.querySelector('dialog[open]') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.channel-open'));
  const index = cards.indexOf(target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const grid = $('.channel-grid');
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : -columns;
  cards[Math.max(0, Math.min(cards.length - 1, index + delta))]?.focus();
});

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallEvent; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('映界已安装到桌面'); });
async function install() {
  if (window.matchMedia('(display-mode: standalone)').matches) { toast('你已在映界的独立窗口中'); return; }
  if (!installPrompt) { showDialog('about-dialog'); return; }
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  if (choice.outcome === 'accepted') toast('安装已交给浏览器处理');
}

const openImporter = createImporter({
  existingChannels: allChannels,
  onImport: channels => {
    preferences.customChannels.push(...channels);
    persist();
    setView('channels'); category = '自定义'; render();
    toast(`已添加 ${channels.length} 个频道`);
  },
});
$('#import-entry').addEventListener('click', () => {
  const addDialog = $<HTMLDialogElement>('#add-dialog');
  addDialog.addEventListener('close', openImporter, { once: true });
  addDialog.close();
});

render();
// Vite's production output only; development keeps HMR free of service-worker caches.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* Browser installation remains optional. */ }); });
}
