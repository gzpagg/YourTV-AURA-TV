import type Hls from 'hls.js';
import type { Channel } from './domain';

type PlayerOptions = {
  video: HTMLVideoElement;
  overlay: HTMLElement;
  status: HTMLElement;
  quality: HTMLSelectElement;
  onError?: (message: string) => void;
};

function loadPolicy(timeoutMs: number, retries: number) {
  const retry = { maxNumRetry: retries, retryDelayMs: 1_000, maxRetryDelayMs: 2_000 };
  return {
    default: {
      maxTimeToFirstByteMs: Math.min(timeoutMs, 10_000),
      maxLoadTimeMs: timeoutMs,
      timeoutRetry: { ...retry },
      errorRetry: { ...retry },
    },
  };
}

/** A single, reusable player. Each request owns its media events and HLS instance. */
export class TVPlayer {
  private readonly video: HTMLVideoElement;
  private readonly overlay: HTMLElement;
  private readonly status: HTMLElement;
  private readonly quality: HTMLSelectElement;
  private readonly onError?: (message: string) => void;
  private hls: Hls | null = null;
  private mediaEvents: AbortController | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private listeningForQuality = false;

  constructor(options: PlayerOptions) {
    this.video = options.video;
    this.overlay = options.overlay;
    this.status = options.status;
    this.quality = options.quality;
    this.onError = options.onError;
    this.resetQuality();
    this.bindQuality();
  }

  private readonly changeQuality = (): void => {
    if (!this.hls) return;
    const level = Number(this.quality.value);
    if (!Number.isInteger(level) || level < -1 || level >= this.hls.levels.length) return;
    this.hls.currentLevel = level;
  };

  private bindQuality(): void {
    if (this.listeningForQuality) return;
    this.quality.addEventListener('change', this.changeQuality);
    this.listeningForQuality = true;
  }

  private resetQuality(): void {
    this.quality.replaceChildren(new Option('自动', '-1'));
    this.quality.disabled = true;
  }

  private clearTimer(): void {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private stopSession(): void {
    this.clearTimer();
    this.mediaEvents?.abort();
    this.mediaEvents = null;
    this.hls?.destroy();
    this.hls = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }

  private showOverlay(message: string): void {
    this.overlay.textContent = message;
    this.overlay.hidden = false;
  }

  private armTimer(generation: number): void {
    this.clearTimer();
    this.loadTimer = setTimeout(() => {
      this.fail(generation, '连接片源超时。请稍后重试，或前往官方网站观看。');
    }, 30_000);
  }

  private fail(generation: number, message: string): void {
    if (generation !== this.generation) return;
    // Invalidate promise continuations before destroying the media pipeline.
    this.generation += 1;
    this.stopSession();
    this.resetQuality();
    this.status.textContent = '暂时无法播放';
    this.showOverlay(message);
    this.onError?.(message);
  }

  private updateResolution(): void {
    const height = this.video.videoHeight;
    const automatic = this.quality.querySelector<HTMLOptionElement>('option[value="-1"]');
    if (automatic) {
      automatic.textContent = height > 0 ? `自动 · ${height}p` : '自动';
    }
    if (!this.video.paused && !this.video.ended) {
      this.status.textContent = height > 0 ? `播放中 · ${height}p` : '播放中';
    }
  }

  private populateQuality(hls: Hls): void {
    const resolutions = new Map<number, { index: number; bitrate: number }>();
    hls.levels.forEach((level, index) => {
      if (!Number.isFinite(level.height) || level.height <= 0) return;
      const previous = resolutions.get(level.height);
      if (!previous || previous.bitrate < level.bitrate) {
        resolutions.set(level.height, { index, bitrate: level.bitrate });
      }
    });
    const selected = this.quality.value;
    this.quality.replaceChildren(
      new Option('自动', '-1'),
      ...[...resolutions.entries()]
        .sort(([left], [right]) => right - left)
        .map(([height, level]) => new Option(`${height}p`, String(level.index))),
    );
    this.quality.value = [...this.quality.options].some((option) => option.value === selected)
      ? selected
      : '-1';
    this.quality.disabled = resolutions.size === 0;
    this.updateResolution();
  }

  private async attemptPlayback(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      await this.video.play();
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.clearTimer();
        this.status.textContent = '等待播放';
        this.showOverlay('点击下方播放按钮，开始观看。');
      } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.fail(generation, '浏览器未能播放此片源。请重试，或前往官方网站观看。');
      }
    }
  }

  async play(channel: Channel): Promise<void> {
    const generation = ++this.generation;
    this.stopSession();
    this.bindQuality();
    this.resetQuality();
    this.status.textContent = '正在连接…';
    this.showOverlay('正在连接公开片源…');

    if (channel.mode === 'official') {
      this.status.textContent = '官方网站观看';
      this.showOverlay('此频道请前往官方网站观看。');
      return;
    }

    this.mediaEvents = new AbortController();
    const { signal } = this.mediaEvents;
    let hasPlayed = false;
    const listen = (event: string, callback: () => void): void => {
      this.video.addEventListener(event, () => {
        if (generation === this.generation) callback();
      }, { signal });
    };
    listen('playing', () => {
      if (this.video.paused || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      hasPlayed = true;
      this.clearTimer();
      this.overlay.hidden = true;
      this.updateResolution();
    });
    listen('loadeddata', () => {
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) this.clearTimer();
    });
    listen('resize', () => this.updateResolution());
    listen('pause', () => {
      // A pause task queued by the previous source can arrive after a switch.
      if (!hasPlayed || !this.video.paused) return;
      this.clearTimer();
      if (!this.video.ended) this.status.textContent = '已暂停';
    });
    listen('waiting', () => {
      if (this.video.paused) return;
      this.status.textContent = '缓冲中…';
      this.armTimer(generation);
    });
    listen('ended', () => {
      if (!this.video.ended) return;
      this.clearTimer();
      this.status.textContent = '播放结束';
      this.showOverlay('播放已结束，可使用下方控件重新播放。');
    });
    listen('error', () => {
      if (!this.video.error) return;
      const message = this.video.error?.code === MediaError.MEDIA_ERR_DECODE
        ? '浏览器无法解码此片源。请尝试其他频道，或前往官方网站观看。'
        : '片源暂时无法播放，可能受网络或地区限制。请重试，或前往官方网站观看。';
      this.fail(generation, message);
    });
    this.armTimer(generation);

    if (channel.mode === 'video') {
      this.video.src = channel.url;
      this.video.load();
      void this.attemptPlayback(generation);
      return;
    }

    try {
      // Keep the initial application bundle small; load HLS only when it is needed.
      const { default: Hls } = await import('hls.js');
      if (generation !== this.generation) return;
      if (!Hls.isSupported()) {
        if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
          this.video.src = channel.url;
          this.video.load();
          void this.attemptPlayback(generation);
          return;
        }
        this.fail(generation, '此浏览器不支持该直播格式。请使用最新版浏览器，或前往官方网站观看。');
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        manifestLoadPolicy: loadPolicy(12_000, 1),
        playlistLoadPolicy: loadPolicy(12_000, 2),
        fragLoadPolicy: loadPolicy(20_000, 2),
      });
      this.hls = hls;
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (generation === this.generation) hls.loadSource(channel.url);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (generation !== this.generation) return;
        this.populateQuality(hls);
        void this.attemptPlayback(generation);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        if (generation === this.generation) this.updateResolution();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (generation !== this.generation) return;
        if (!data.fatal) return;
        const message = data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? '片源连接失败，可能受网络或地区限制。请重试，或前往官方网站观看。'
          : '此片源暂时无法在浏览器中播放。请尝试其他频道，或前往官方网站观看。';
        this.fail(generation, message);
      });
      hls.attachMedia(this.video);
    } catch {
      this.fail(generation, '播放器加载失败。请刷新页面后重试。');
    }
  }

  async fullscreen(): Promise<void> {
    const generation = this.generation;
    const screen = this.video.closest<HTMLElement>('.player-screen') ?? this.video;
    try {
      if (document.fullscreenElement === screen) {
        await document.exitFullscreen();
      } else if (screen.requestFullscreen) {
        await screen.requestFullscreen();
      } else {
        throw new Error('Fullscreen unavailable');
      }
    } catch {
      if (generation !== this.generation) return;
      this.status.textContent = '当前浏览器无法进入全屏，可使用视频控件重试。';
    }
  }

  destroy(): void {
    this.generation += 1;
    this.stopSession();
    this.quality.removeEventListener('change', this.changeQuality);
    this.listeningForQuality = false;
    this.resetQuality();
    this.overlay.textContent = '';
    this.overlay.hidden = true;
    this.status.textContent = '';
  }
}
