import './importer.css';
import { escapeHtml as e } from './domain';
import type { Channel } from './domain';
import { parsePlaylist } from './playlist';
import type { PlaylistResult } from './playlist';

type ImportOptions = {
  existingChannels: () => Channel[];
  onImport: (channels: Channel[]) => void;
};
const MAX_BYTES = 2 * 1024 * 1024;

function listUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请填写完整的 HTTP 或 HTTPS 列表地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('列表地址只支持不含账号密码的 HTTP 或 HTTPS 链接。');
  if (location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('当前页面使用 HTTPS，请使用 HTTPS 列表，或下载文件后导入。');
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[2] !== 'blob') throw new Error('这是 GitHub 仓库页面，请使用具体文件的 Raw 原始地址。');
    url = new URL(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`);
  }
  return url;
}

async function readLimited(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('列表超过 2 MB，请拆分后导入。');
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('列表超过 2 MB，请拆分后导入。');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('列表超过 2 MB，请拆分后导入。'); }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Import data only. External scripts, parsers, JARs, and embedded HTML never run. */
export function createImporter(options: ImportOptions): () => void {
  const dialog = document.createElement('dialog');
  dialog.id = 'import-dialog';
  dialog.className = 'modal import-dialog';
  dialog.setAttribute('aria-labelledby', 'import-title');
  dialog.innerHTML = `<div class="modal-header"><div><span class="eyebrow">BRING YOUR CHANNELS</span><h2 id="import-title">导入频道列表</h2></div><button type="button" class="icon-button" id="import-close" aria-label="关闭频道导入">×</button></div>
    <div class="import-body">
      <p class="form-hint">读取 M3U、TXT 或 TVBox 静态直播列表，预览后选择添加。请确认你有权观看这些内容。</p>
      <div class="import-modes" role="group" aria-label="导入方式"><button class="filter-chip active" data-import-mode="text" aria-pressed="true">粘贴 / 文件</button><button class="filter-chip" data-import-mode="url" aria-pressed="false">链接读取</button></div>
      <form id="import-form">
        <div id="import-text-fields"><div class="form-field"><label for="import-content">列表内容</label><textarea id="import-content" rows="5" spellcheck="false" placeholder="新闻,#genre#&#10;频道名称,https://example.com/live.m3u8"></textarea></div><label class="import-file-label">或选择本地文件 <input id="import-file" type="file" accept=".m3u,.m3u8,.txt,.json,application/json,text/plain"/></label></div>
        <div class="form-field"><label id="import-url-label" for="import-url">原始列表地址（选填，用于相对路径）</label><input id="import-url" type="text" inputmode="url" placeholder="https://example.com/channels.txt" autocomplete="off"/><span class="form-hint" id="import-url-hint">TVBox 中的相对链接需要原始配置地址才能解析。</span></div>
        <div class="import-controls"><button class="button secondary" id="import-parse" type="submit">解析列表</button><span id="import-progress" role="status"></span></div>
      </form>
      <p class="form-error" id="import-error" role="alert"></p>
      <section id="import-preview" aria-label="导入预览" hidden></section>
    </div>
    <div class="modal-actions import-actions"><span class="form-hint" id="import-selected">添加前不会播放任何频道</span><button class="button primary" id="import-confirm" disabled>添加所选频道</button></div>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const content = $<HTMLTextAreaElement>('#import-content');
  const urlInput = $<HTMLInputElement>('#import-url');
  const confirm = $<HTMLButtonElement>('#import-confirm');
  const parse = $<HTMLButtonElement>('#import-parse');
  const preview = $('#import-preview');
  let mode: 'text' | 'url' = 'text';
  let result: PlaylistResult | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let restoreFocus: HTMLElement | null = null;

  function clearPreview() {
    generation += 1;
    controller?.abort(); controller = null;
    result = null;
    preview.hidden = true;
    preview.replaceChildren();
    confirm.disabled = true;
    parse.disabled = false;
    $('#import-progress').textContent = '';
    $('#import-selected').textContent = '添加前不会播放任何频道';
    $('#import-error').textContent = '';
  }

  function switchMode(next: 'text' | 'url') {
    mode = next;
    clearPreview();
    $('#import-text-fields').hidden = next === 'url';
    $('#import-url-label').textContent = next === 'url' ? '频道列表 / TVBox 配置地址' : '原始列表地址（选填，用于相对路径）';
    $('#import-url-hint').textContent = next === 'url' ? '源站需允许浏览器读取。读取失败时，可下载文件或粘贴内容导入。' : 'TVBox 中的相对链接需要原始配置地址才能解析。';
    parse.textContent = next === 'url' ? '读取并解析' : '解析列表';
    dialog.querySelectorAll<HTMLButtonElement>('[data-import-mode]').forEach(button => {
      const active = button.dataset.importMode === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  const selectedIndexes = () => Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-import-index]:checked')).map(input => Number(input.dataset.importIndex));
  function selectionChanged() {
    const count = selectedIndexes().length;
    confirm.disabled = count === 0;
    $('#import-selected').textContent = `已选择 ${count} 个频道 · 可用性由片源决定`;
  }

  function showPreview(parsed: PlaylistResult) {
    result = parsed;
    preview.hidden = false;
    preview.innerHTML = `<div class="import-summary" role="status"><strong>${parsed.channels.length} 个可导入频道</strong><span>${parsed.duplicates} 个重复 · ${parsed.skipped} 个跳过 · ${parsed.references.length} 个关联列表</span></div>
      ${parsed.channels.length ? `<div class="import-select-tools"><button type="button" class="text-button" id="import-select-all">全选</button><button type="button" class="text-button" id="import-select-none">取消全选</button></div><div class="import-channel-list">${parsed.channels.map((channel, index) => `<label class="import-channel-row"><input type="checkbox" data-import-index="${index}" checked/><span><strong>${e(channel.name)}</strong><small>${e(channel.group || '未分组')} · ${e(new URL(channel.url).hostname)}</small></span><span class="channel-tag">${channel.mode === 'hls' ? 'HLS' : '视频'}</span></label>`).join('')}</div>` : '<p class="form-hint">没有可直接添加的媒体地址。若下面列出了关联列表，可以选择继续读取。</p>'}
      ${parsed.references.length ? `<h3 class="import-section-title">配置中的关联列表</h3><p class="form-hint">这些是列表入口，选择后才会读取；不自动加载点播站点或插件。</p><div class="import-reference-list">${parsed.references.map((reference, index) => `<div class="import-reference-row"><div><strong>${e(reference.name)}</strong><small>${e(reference.url)}</small></div><button type="button" class="button secondary" data-import-reference="${index}">读取${reference.kind === 'config' ? '配置' : '列表'}</button></div>`).join('')}</div>` : ''}
      ${parsed.issues.length ? `<details class="import-issues"><summary>查看 ${parsed.issues.length} 条提示</summary><ul>${parsed.issues.map(issue => `<li>${issue.line ? `第 ${issue.line} 行：` : ''}${e(issue.message)}</li>`).join('')}</ul></details>` : ''}`;
    selectionChanged();
  }

  async function analyze() {
    clearPreview();
    const current = generation;
    const request = new AbortController();
    controller = request;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, 15_000);
    parse.disabled = true;
    $('#import-progress').textContent = mode === 'url' ? '正在读取列表…' : '正在解析…';
    try {
      let sourceUrl = urlInput.value.trim() ? listUrl(urlInput.value).href : undefined;
      let text = content.value;
      if (mode === 'url') {
        if (!sourceUrl) throw new Error('请填写列表地址。');
        let response: Response;
        try { response = await fetch(sourceUrl, { signal: request.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
        catch { throw new Error(timedOut ? '读取超时，请稍后重试或导入本地文件。' : '无法读取列表，可能受网络或跨域限制。可以下载文件后导入，或粘贴列表内容。'); }
        if (!response.ok) throw new Error(`列表返回 HTTP ${response.status}，请检查地址或导入本地文件。`);
        text = await readLimited(response);
        sourceUrl = response.url;
      }
      if (current !== generation || !dialog.open) return;
      const parsed = parsePlaylist(text, { sourceUrl, existingUrls: options.existingChannels().map(channel => channel.url), requireHttps: location.protocol === 'https:' });
      showPreview(parsed);
    } catch (error) {
      if (current === generation && dialog.open) $('#import-error').textContent = timedOut ? '读取超时，请稍后重试或导入本地文件。' : error instanceof Error ? error.message : '无法解析这个列表。';
    } finally {
      clearTimeout(timer);
      if (current === generation) { parse.disabled = false; $('#import-progress').textContent = ''; controller = null; }
    }
  }

  $('#import-form').addEventListener('submit', event => { event.preventDefault(); void analyze(); });
  for (const input of [content, urlInput]) input.addEventListener('input', clearPreview);
  $<HTMLInputElement>('#import-file').addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    switchMode('text');
    const current = generation;
    if (file.size > MAX_BYTES) { $('#import-error').textContent = '文件超过 2 MB，请拆分后导入。'; return; }
    try { const text = await file.text(); if (current === generation && dialog.open) content.value = text; }
    catch { if (current === generation) $('#import-error').textContent = '无法读取文件，请尝试粘贴内容。'; }
  });
  dialog.addEventListener('change', event => { if ((event.target as HTMLElement).matches('[data-import-index]')) selectionChanged(); });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.importMode) switchMode(button.dataset.importMode as 'text' | 'url');
    if (button.id === 'import-close') dialog.close();
    if (button.id === 'import-select-all' || button.id === 'import-select-none') {
      dialog.querySelectorAll<HTMLInputElement>('[data-import-index]').forEach(input => { input.checked = button.id === 'import-select-all'; }); selectionChanged();
    }
    if (button.dataset.importReference !== undefined && result) {
      const reference = result.references[Number(button.dataset.importReference)];
      if (!reference) return;
      urlInput.value = reference.url;
      content.value = '';
      switchMode('url');
      void analyze();
    }
  });
  confirm.addEventListener('click', () => {
    if (!result) return;
    const existing = new Set(options.existingChannels().map(channel => channel.url));
    const selected = selectedIndexes().map(index => result!.channels[index]).filter(channel => channel && !existing.has(channel.url));
    if (!selected.length) { clearPreview(); $('#import-error').textContent = '所选频道已在列表中，请重新解析。'; return; }
    options.onImport(selected);
    dialog.close();
  });
  dialog.addEventListener('close', () => { clearPreview(); if (restoreFocus?.isConnected) restoreFocus.focus(); });
  return () => { restoreFocus = document.activeElement as HTMLElement; clearPreview(); dialog.showModal(); };
}
