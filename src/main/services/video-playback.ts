/**
 * In-app universal video playback. Probes a local media file, then either reports it
 * as directly playable or converts it (fast remux / full transcode via ffmpeg) into a
 * browser-friendly MP4 cached under userData/media so the built-in player can stream
 * it — no external player needed, for any format/extension.
 */
import { app } from 'electron';
import { join } from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createLogger } from '../logger';
import { resolveFfmpeg, resolveFfprobe } from './media-tools';
import { decidePlayback, type PlaybackMode, type PlaybackProbe } from './video-playback-decide';
import { toLocalVideoUrl } from './video';

const execFileAsync = promisify(execFile);
const log = createLogger('video-playback');

export interface PreparedPlayback {
  ok: boolean;
  url?: string;
  mode?: PlaybackMode;
  error?: string;
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'media', '_playback');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isUnderMediaRoot(p: string): boolean {
  const roots = ['media', 'uploads', 'downloads'].map((d) => join(app.getPath('userData'), d));
  const np = process.platform === 'win32' ? p.toLowerCase() : p;
  return roots.some((r) => {
    const nr = process.platform === 'win32' ? r.toLowerCase() : r;
    return np.startsWith(nr);
  });
}

interface FullProbe extends PlaybackProbe {
  durationSec: number;
}

async function probe(filePath: string): Promise<FullProbe> {
  // Preferred: ffprobe JSON (only when a probe binary is actually present).
  const ffprobe = resolveFfprobe();
  if (fs.existsSync(ffprobe)) {
    try {
      const { stdout } = await execFileAsync(
        ffprobe,
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath],
        { timeout: 30_000 },
      );
      const data = JSON.parse(stdout) as {
        streams?: { codec_type?: string; codec_name?: string }[];
        format?: { duration?: string };
      };
      const v = data.streams?.find((s) => s.codec_type === 'video');
      const a = data.streams?.find((s) => s.codec_type === 'audio');
      return {
        hasVideo: !!v,
        videoCodec: v?.codec_name,
        audioCodec: a?.codec_name,
        durationSec: data.format?.duration ? Number(data.format.duration) : 0,
      };
    } catch { /* fall through to ffmpeg -i */ }
  }

  // Fallback: parse `ffmpeg -i` stderr (ffmpeg-static ships no ffprobe). ffmpeg exits
  // non-zero with no output specified but still prints stream info to stderr.
  try {
    let stderr = '';
    try {
      await execFileAsync(resolveFfmpeg(), ['-hide_banner', '-i', filePath], { timeout: 30_000 });
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? '';
    }
    const vM = /Stream #\d+:\d+[^\n]*: Video: (\w+)/.exec(stderr);
    const aM = /Stream #\d+:\d+[^\n]*: Audio: (\w+)/.exec(stderr);
    const dM = /Duration: (\d{1,3}):(\d{2}):(\d{2})/.exec(stderr);
    return {
      hasVideo: !!vM,
      videoCodec: vM?.[1],
      audioCodec: aM?.[1],
      durationSec: dM ? Number(dM[1]) * 3600 + Number(dM[2]) * 60 + Number(dM[3]) : 0,
    };
  } catch {
    return { hasVideo: true, durationSec: 0 }; // last resort → universal transcode
  }
}

/** Stable cache key from path + mtime + size so edits/replacements re-convert. */
function cacheKey(filePath: string, outExt: string): string {
  let stamp = '';
  try { const s = fs.statSync(filePath); stamp = `${s.size}:${s.mtimeMs}`; } catch { /* ignore */ }
  const h = crypto.createHash('sha1').update(`${filePath}|${stamp}`).digest('hex').slice(0, 16);
  return `pb_${h}.${outExt}`;
}

// Bounded, no optional group → ReDoS-safe. Integer seconds is enough for a progress bar.
const HMS = /time=(\d{1,3}):(\d{2}):(\d{2})/;

function runFfmpeg(
  input: string,
  args: string[],
  output: string,
  durationSec: number,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), ['-y', '-i', input, ...args, output], { windowsHide: true });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      if (durationSec > 0 && onProgress) {
        const m = HMS.exec(s);
        if (m) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          onProgress(Math.max(1, Math.min(99, Math.round((t / durationSec) * 100))));
        }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200) || `ffmpeg exit ${code}`));
    });
  });
}

/**
 * Make `filePath` playable in the built-in player. Returns an eyesmedia:// URL the
 * renderer can load. Native files are served as-is; everything else is remuxed or
 * transcoded into a cached MP4. `onProgress(pct)` fires during conversion.
 */
export async function prepareForPlayback(
  filePath: string,
  onProgress?: (pct: number, mode: PlaybackMode) => void,
): Promise<PreparedPlayback> {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'الملف غير موجود' };

  const p = await probe(filePath);
  const plan = decidePlayback(filePath, p);

  if (plan.mode === 'native' && isUnderMediaRoot(filePath)) {
    return { ok: true, url: toLocalVideoUrl(filePath), mode: 'native' };
  }

  // Non-native (or native-but-outside-servable-root) → produce a cached, servable file.
  const effective = plan.mode === 'native'
    ? { mode: 'remux' as PlaybackMode, outExt: 'mp4', ffmpegArgs: ['-c', 'copy', '-movflags', '+faststart'] }
    : plan;

  const outFile = join(cacheDir(), cacheKey(filePath, effective.outExt));
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    return { ok: true, url: toLocalVideoUrl(outFile), mode: effective.mode };
  }

  try {
    log.info(`Preparing playback (${effective.mode}) for ${filePath}`);
    await runFfmpeg(filePath, effective.ffmpegArgs, outFile, p.durationSec, (pct) => onProgress?.(pct, effective.mode));
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) throw new Error('produced empty output');
    return { ok: true, url: toLocalVideoUrl(outFile), mode: effective.mode };
  } catch (err) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch { /* ignore */ }
    log.warn('playback preparation failed', { error: (err as Error).message });
    return { ok: false, error: `تعذّر تجهيز الفيديو للتشغيل: ${(err as Error).message}` };
  }
}
