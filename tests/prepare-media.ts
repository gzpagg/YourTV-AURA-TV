import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const mediaDirectory = fileURLToPath(new URL('./.media/', import.meta.url));

/** Local synthetic media only: never download or redistribute broadcaster footage. */
export default function prepareMedia(): void {
  mkdirSync(mediaDirectory, { recursive: true });
  for (const level of [
    { name: '360p', size: '640x360', bitrate: '350k' },
    { name: '720p', size: '1280x720', bitrate: '900k' },
  ]) {
    execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-filter_threads', '1', '-filter_complex_threads', '1',
      '-f', 'lavfi', '-i', `testsrc2=size=${level.size}:rate=24`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '8',
      '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast',
      '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
      '-b:v', level.bitrate, '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
      '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', join(mediaDirectory, `${level.name}-%03d.ts`),
      join(mediaDirectory, `${level.name}.m3u8`),
    ], { stdio: 'pipe', timeout: 30_000 });
  }
  writeFileSync(join(mediaDirectory, 'master.m3u8'), [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=450000,AVERAGE-BANDWIDTH=414000,RESOLUTION=640x360,CODECS="avc1.42c01f,mp4a.40.2"',
    '/__aura_fixture__/360p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1100000,AVERAGE-BANDWIDTH=964000,RESOLUTION=1280x720,CODECS="avc1.42c01f,mp4a.40.2"',
    '/__aura_fixture__/720p.m3u8',
    '',
  ].join('\n'));
}
