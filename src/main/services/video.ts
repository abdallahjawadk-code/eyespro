import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createArticle } from './articles';
import { getSetting } from './settings';
import { runAi } from './ai';

const execFileAsync = promisify(execFile);

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.avi']);

/* ── Bundled FFmpeg path (ASAR-safe) ─────────────────────────────────────── */
function getBundledFfmpegPath(): string {
  if (!ffmpegStatic) return getSetting('ffmpeg_path') || 'ffmpeg';
  if (app.isPackaged) {
    return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegStatic;
}

function whisperPath(): string {
  return getSetting('whisper_path') || 'whisper';
}

function tempDir(): string {
  const base = path.join(app.getPath('temp'), 'EyesPro', `video-${randomBytes(6).toString('hex')}`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/* ── Platform transcode specs (single source of truth) ───────────────────── */
export interface PlatformSpec {
  /** Bounding box — video fits inside preserving aspect ratio */
  maxWidth: number;
  maxHeight: number;
  maxDurationSec?: number;
  videoBitrate: string;
  /** Floor bitrate when auto-shrinking for size limits (Discord, Telegram) */
  minVideoBitrate?: string;
  audioBitrate: string;
  /** معدل عينات الصوت بالهرتز — 48000 لـ YouTube، 44100 للبقية */
  audioSampleRate?: number;
  codec: string;
  container: string;
  maxSizeMB: number;
  note: string;
  /** Skip re-encode when already compatible (e.g. push notifications) */
  transcodeOptional?: boolean;
}

/**
 * سياسات الفيديو المحدّثة 2024-2025
 * المصادر:
 *  Facebook:  facebook.com/business/m/one-sheeters/video-requirements
 *  YouTube:   support.google.com/youtube/answer/1722171
 *  Twitter/X: developer.twitter.com/en/docs/twitter-api (140ث عادي، 4h Premium)
 *  LinkedIn:  linkedin.com/help/linkedin/answer/a1311816
 *  WhatsApp:  developers.facebook.com/docs/whatsapp/cloud-api (64 MB Cloud API)
 *  Discord:   10 MB مجاني، 50 MB Nitro Basic، 500 MB Nitro
 */
export const PLATFORM_SPECS: Record<string, PlatformSpec> = {

  // YouTube — H.264 High Profile، AAC-LC 48kHz، حتى 4K، 256 GB
  youtube: {
    maxWidth: 1920, maxHeight: 1080,
    maxDurationSec: 43_200,          // 12 ساعة
    videoBitrate: '8000k',           // 8 Mbps لـ 1080p@30fps (توصية Google)
    audioBitrate: '192k',            // AAC-LC 192 kbps
    audioSampleRate: 48_000,         // 48 kHz مطلوب من YouTube
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 262_144,
    note: 'H.264 High · 1080p · AAC 48kHz · MP4',
  },

  // Facebook — يدعم 16:9 و 9:16 و 4:5، حتى 4 GB، 4 ساعات
  facebook: {
    maxWidth: 1920, maxHeight: 1080,
    maxDurationSec: 14_400,          // 4 ساعات
    videoBitrate: '8000k',
    audioBitrate: '128k',
    audioSampleRate: 44_100,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 4_096,                // 4 GB عملياً (نستخدم 4 GB كحد أمان)
    note: 'H.264 · 1080p · 16:9 · حتى 4 ساعات',
  },

  // Instagram Reels — 9:16، 5–90 ث، H.264/AAC 48kHz، ≤ 1 GB
  instagram: {
    maxWidth: 1080, maxHeight: 1920,
    maxDurationSec: 90,
    videoBitrate: '6000k',
    audioBitrate: '128k',
    audioSampleRate: 48_000,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 1_024,
    note: 'H.264 · 9:16 · 90 ث · AAC 48kHz · MP4',
  },

  // Twitter/X — 512 MB، 2:20 للعاديين، H.264، AAC
  twitter: {
    maxWidth: 1280, maxHeight: 720,
    maxDurationSec: 140,             // 2:20 دقيقة للمستخدمين العاديين
    videoBitrate: '5000k',
    minVideoBitrate: '800k',
    audioBitrate: '128k',
    audioSampleRate: 44_100,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 512,
    note: 'H.264 · 1280×720 · حد 2:20 دقيقة · 512 MB',
  },

  // LinkedIn — يدعم 9:16 بشكل أفضل (2024)، حتى 5 GB، 10 دقائق
  linkedin: {
    maxWidth: 1920, maxHeight: 1080,
    maxDurationSec: 600,             // 10 دقائق
    videoBitrate: '10000k',          // ← 10 Mbps (LinkedIn تقبل حتى 30 Mbps)
    minVideoBitrate: '1000k',
    audioBitrate: '128k',
    audioSampleRate: 44_100,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 5_000,
    note: 'H.264 · 1080p · 10 دقائق · 5 GB',
  },

  // Telegram — Bot API: حتى 50 MB. المستخدم العادي: 2 GB
  telegram: {
    maxWidth: 1280, maxHeight: 1280,
    maxDurationSec: 0,
    videoBitrate: '2000k',
    minVideoBitrate: '500k',
    audioBitrate: '96k',
    audioSampleRate: 44_100,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 50,                   // حد Bot API sendVideo
    note: 'H.264 · 1280px · 50 MB (Bot API)',
  },

  // WhatsApp — Cloud API: 64 MB، يقبل MP4/H.264
  whatsapp: {
    maxWidth: 1280, maxHeight: 720,
    maxDurationSec: 0,
    videoBitrate: '2000k',
    minVideoBitrate: '600k',
    audioBitrate: '128k',
    audioSampleRate: 44_100,
    codec: 'libx264', container: 'mp4',
    maxSizeMB: 64,                   // Cloud API: 64 MB
    note: 'H.264 · 720p · 64 MB (WhatsApp Cloud API)',
  },

};

export interface TranscodeResult {
  ok: boolean;
  outputPath?: string;
  platform?: string;
  skipped?: boolean;
  error?: string;
  /** Human-readable summary for UI */
  info?: string;
}

export interface VideoProbeResult {
  ok: boolean;
  width?: number;
  height?: number;
  codec?: string;
  container?: string;
  bitrate?: number;
  duration?: number;
  sizeMB?: number;
  hasAudio?: boolean;
  error?: string;
}

/* ── Probe ───────────────────────────────────────────────────────────────── */
function parseFfmpegProbeStderr(stderr: string, inputPath: string): VideoProbeResult {
  const stat = fs.statSync(inputPath);
  const sizeMB = stat.size / 1048576;

  const dur = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  let duration: number | undefined;
  if (dur) {
    duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  }

  const videoLine = stderr.split('\n').find((l) => /Video:/i.test(l)) ?? '';
  const audioLine = stderr.split('\n').find((l) => /Audio:/i.test(l)) ?? '';
  const codec = videoLine.match(/Video:\s*(\w+)/i)?.[1]?.toLowerCase();
  const res = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})/);
  const width = res ? Number(res[1]) : undefined;
  const height = res ? Number(res[2]) : undefined;

  return {
    ok: true,
    width,
    height,
    codec,
    container: path.extname(inputPath).replace('.', '') || 'mp4',
    duration,
    sizeMB,
    hasAudio: audioLine.length > 0,
  };
}

async function probeWithFfmpeg(inputPath: string): Promise<VideoProbeResult> {
  const ffmpeg = getBundledFfmpegPath();
  try {
    await execFileAsync(ffmpeg, ['-hide_banner', '-i', inputPath], { timeout: 30_000 });
    return parseFfmpegProbeStderr('', inputPath);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const stderr = String(err.stderr ?? err.message ?? '');
    if (/No such file|Invalid data/i.test(stderr)) {
      return { ok: false, error: 'ملف الفيديو تالف أو غير قابل للقراءة' };
    }
    return parseFfmpegProbeStderr(stderr, inputPath);
  }
}

export async function probeVideo(inputPath: string): Promise<VideoProbeResult> {
  if (!fs.existsSync(inputPath)) return { ok: false, error: 'File not found' };
  const ffmpeg = getBundledFfmpegPath();
  const ffprobePath = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  const probePath = fs.existsSync(ffprobePath) ? ffprobePath : '';

  if (probePath) {
    try {
      const { stdout } = await execFileAsync(probePath, [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', inputPath
      ], { timeout: 30_000 });

      const data = JSON.parse(stdout) as {
        streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
        format?: { size?: string; duration?: string; bit_rate?: string; format_name?: string };
      };

      const video = data.streams?.find(s => s.codec_type === 'video');
      const audio = data.streams?.find(s => s.codec_type === 'audio');
      const fmt = data.format;
      const sizeMB = fmt?.size ? Number(fmt.size) / 1048576 : fs.statSync(inputPath).size / 1048576;

      return {
        ok: true,
        width: video?.width,
        height: video?.height,
        codec: video?.codec_name,
        container: fmt?.format_name?.split(',')[0],
        bitrate: fmt?.bit_rate ? Math.round(Number(fmt.bit_rate) / 1000) : 0,
        duration: fmt?.duration ? Number(fmt.duration) : undefined,
        sizeMB,
        hasAudio: !!audio
      };
    } catch { /* fall through to ffmpeg -i */ }
  }

  return probeWithFfmpeg(inputPath);
}

function dimensionsEven(width?: number, height?: number): boolean {
  if (!width || !height) return true;
  return width % 2 === 0 && height % 2 === 0;
}

function fitsInBox(width: number, height: number, spec: PlatformSpec): boolean {
  return width <= spec.maxWidth && height <= spec.maxHeight;
}

/** Fit inside W×H box, preserve aspect, force even dims for libx264 */
function buildVideoFilter(spec: PlatformSpec, platform?: string): string {
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  if (platform === 'instagram') {
    // Reels: cover-crop to 9:16 portrait
    return `scale=${spec.maxWidth}:${spec.maxHeight}:force_original_aspect_ratio=increase,crop=${spec.maxWidth}:${spec.maxHeight},${even}`;
  }
  const scale = `scale=${spec.maxWidth}:${spec.maxHeight}:force_original_aspect_ratio=decrease`;
  return [scale, even].join(',');
}

function parseBitrateKbps(v: string): number {
  const n = parseInt(v.replace(/k$/i, ''), 10);
  return Number.isFinite(n) ? n : 2000;
}

/** Auto bitrate from file-size budget (for Telegram, Discord, etc.) */
function computeVideoBitrate(spec: PlatformSpec, probe: VideoProbeResult): string {
  const cap = parseBitrateKbps(spec.videoBitrate);
  const floor = parseBitrateKbps(spec.minVideoBitrate ?? '400k');
  const dur = probe.duration ?? 0;
  if (!dur || dur <= 0) return spec.videoBitrate;
  const audioKbps = parseBitrateKbps(spec.audioBitrate);
  const budgetKbps = Math.floor((spec.maxSizeMB * 0.8 * 8192) / dur) - audioKbps;
  return `${Math.max(floor, Math.min(cap, budgetKbps))}k`;
}

function friendlyFfmpegError(raw: string): string {
  const m = raw.match(/width not divisible by 2 \((\d+)x(\d+)\)/i)
    ?? raw.match(/height not divisible by 2 \((\d+)x(\d+)\)/i);
  if (m) return `أبعاد غير صالحة للتشفير (${m[1]}×${m[2]}) — أعد المحاولة بعد التحديث`;
  if (/Conversion failed/i.test(raw)) {
    const line = raw.split('\n').find(l => /Error|error|invalid/i.test(l) && !l.includes('Command failed'));
    return line ? `فشل التحويل: ${line.trim().slice(0, 220)}` : 'فشل تحويل الفيديو';
  }
  if (raw.includes('Command failed:')) {
    return `فشل FFmpeg: ${raw.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 280)}`;
  }
  return raw.slice(0, 320);
}

function isCompatible(probe: VideoProbeResult, spec: PlatformSpec): boolean {
  if (!probe.ok) return false;
  const goodCodec = probe.codec === 'h264' || probe.codec === 'avc1';
  const goodContainer = (probe.container ?? '').includes('mp4') || (probe.container ?? '').includes('mov');
  if (!goodCodec || !goodContainer) return false;
  if (probe.width && probe.height && !fitsInBox(probe.width, probe.height, spec)) return false;
  if (!dimensionsEven(probe.width, probe.height)) return false;
  if (spec.maxDurationSec && probe.duration && probe.duration > spec.maxDurationSec + 0.5) return false;
  if (probe.sizeMB && probe.sizeMB > spec.maxSizeMB) return false;
  return true;
}

function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  spec: PlatformSpec,
  videoBitrate: string,
  trimSec: number | undefined,
  platform: string,
  hasAudio: boolean,
): string[] {
  const sampleRate = String(spec.audioSampleRate ?? 44_100);
  const args = ['-y'];

  args.push('-i', inputPath);

  if (!hasAudio) {
    args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}`);
  }

  if (trimSec && trimSec > 0) args.push('-t', String(Math.floor(trimSec)));

  // Video codec + bitrate
  args.push(
    '-c:v', spec.codec,
    '-b:v', videoBitrate,
    '-maxrate', `${Math.round(parseBitrateKbps(videoBitrate) * 1.5)}k`,
    '-bufsize', `${Math.max(parseBitrateKbps(videoBitrate) * 2, 800)}k`,
    '-vf', buildVideoFilter(spec, platform),
    '-map', '0:v:0',
  );

  // Audio
  if (hasAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', spec.audioBitrate, '-ar', sampleRate, '-ac', '2');
  } else {
    args.push('-map', '1:a', '-c:a', 'aac', '-b:a', spec.audioBitrate, '-ar', sampleRate, '-ac', '2', '-shortest');
  }

  // خيارات خاصة لكل منصة
  if (platform === 'youtube') {
    // YouTube: High Profile، CABAC، 2 B-frames — توصية Google
    args.push(
      '-profile:v', 'high', '-level:v', '4.2',
      '-bf', '2', '-coder', 'ac',
    );
  } else if (platform === 'twitter') {
    // Twitter: baseline/main، لا يقبل High Profile في بعض الحالات
    args.push('-profile:v', 'main', '-level:v', '4.0');
  }

  args.push(
    '-map_metadata', '-1',
    '-movflags', '+faststart',   // moov atom أولاً للـ streaming
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',       // مطلوب لـ H.264 على جميع المنصات
    outputPath,
  );
  return args;
}

async function runEncode(ffmpeg: string, args: string[]): Promise<void> {
  await execFileAsync(ffmpeg, args, { timeout: 3_600_000 });
}

/* ── Transcode ───────────────────────────────────────────────────────────── */
export async function transcodeForPlatform(
  inputPath: string,
  platform: string,
  onProgress?: (pct: number, msg: string) => void
): Promise<TranscodeResult> {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return { ok: false, error: `منصة غير معروفة: ${platform}` };
  if (!fs.existsSync(inputPath)) return { ok: false, error: 'ملف الإدخال غير موجود' };

  onProgress?.(0, 'فحص خصائص الفيديو…');
  const probe = await probeVideo(inputPath);

  if (spec.transcodeOptional) {
    onProgress?.(100, 'تخطي التشفير — غير مطلوب لهذه المنصة');
    return { ok: true, outputPath: inputPath, platform, skipped: true, info: spec.note };
  }

  // LinkedIn: 3 ثوانٍ على الأقل
  if (platform === 'linkedin' && probe.duration !== undefined && probe.duration < 3) {
    return { ok: false, error: 'LinkedIn: مدة الفيديو يجب أن تكون 3 ثوانٍ على الأقل' };
  }

  // Instagram Reels: 5–90 ثانية (Meta policy)
  if (platform === 'instagram' && probe.duration !== undefined && probe.duration < 5) {
    return { ok: false, error: 'Instagram Reels: مدة الفيديو يجب أن تكون 5 ثوانٍ على الأقل' };
  }

  if (isCompatible(probe, spec)) {
    onProgress?.(100, 'الفيديو متوافق — لا حاجة لإعادة التشفير');
    return { ok: true, outputPath: inputPath, platform, skipped: true, info: 'متوافق مسبقاً' };
  }

  const hasAudio = probe.hasAudio === true;

  const workDir = tempDir();
  const outputPath = path.join(workDir, `${platform}-output.${spec.container}`);
  const ffmpeg = getBundledFfmpegPath();

  const needsTrim = !!(spec.maxDurationSec && probe.duration && probe.duration > spec.maxDurationSec);
  const trimSec = needsTrim ? spec.maxDurationSec : undefined;
  let videoBitrate = computeVideoBitrate(spec, probe);

  const srcNote = probe.codec === 'hevc' || probe.codec === 'h265' ? ' · تحويل HEVC' : '';
  const label = `${spec.maxWidth}×${spec.maxHeight}${needsTrim ? ` · أول ${trimSec}s` : ''}${srcNote}`;
  onProgress?.(5, `تشفير لـ ${platform} (${label})…`);

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const args = buildFfmpegArgs(inputPath, outputPath, spec, videoBitrate, trimSec, platform, hasAudio);
      await runEncode(ffmpeg, args);
      const outMB = fs.statSync(outputPath).size / 1048576;

      if (outMB <= spec.maxSizeMB) {
        onProgress?.(100, 'اكتمل التشفير');
        return {
          ok: true,
          outputPath,
          platform,
          info: `${outMB.toFixed(1)} MB · ${videoBitrate} · ${label}`
        };
      }

      if (attempt === 0) {
        const lower = Math.floor(parseBitrateKbps(videoBitrate) * 0.65);
        const floor = parseBitrateKbps(spec.minVideoBitrate ?? '400k');
        videoBitrate = `${Math.max(floor, lower)}k`;
        onProgress?.(40, `الملف كبير (${outMB.toFixed(0)} MB) — إعادة بتردد أقل…`);
        continue;
      }

      fs.rmSync(workDir, { recursive: true, force: true });
      return {
        ok: false,
        error: `بعد التشفير ${outMB.toFixed(0)} MB يتجاوز حد ${spec.maxSizeMB} MB — قصّر المدة أو اخفض الدقة`
      };
    }

    return { ok: false, error: 'فشل التشفير' };
  } catch (e) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: false, error: friendlyFfmpegError((e as Error).message) };
  }
}

/** Resolve a local filesystem path from an article video_url (http URLs return null). */
export function localVideoPathForArticle(article: { video_url?: string | null }): string | null {
  const v = (article.video_url ?? '').trim();
  if (!v || v.startsWith('http://') || v.startsWith('https://')) return null;
  if (v.startsWith('eyesmedia://local/')) {
    const p = decodeURIComponent(v.replace('eyesmedia://local/', ''));
    return fs.existsSync(p) ? p : null;
  }
  return fs.existsSync(v) ? v : null;
}

export function toLocalVideoUrl(filePath: string): string {
  return `eyesmedia://local/${encodeURIComponent(filePath)}`;
}

/** Download remote video to a temp file (for http(s) article URLs). */
export async function downloadVideoToTemp(
  url: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(180_000),
      headers: { 'User-Agent': 'EyesPro/1.0' },
    });
    if (!res.ok) return { ok: false, error: `تعذّر تحميل الفيديو: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const maxBytes = 680 * 1024 * 1024;
    if (buf.length > maxBytes) return { ok: false, error: 'الملف أكبر من 650 MB' };
    if (buf.length < 1024) return { ok: false, error: 'ملف الفيديو فارغ أو تالف' };
    const workDir = tempDir();
    const out = path.join(workDir, 'source-download.mp4');
    fs.writeFileSync(out, buf);
    return { ok: true, path: out };
  } catch (e) {
    return { ok: false, error: `تعذّر تحميل الفيديو: ${(e as Error).message.slice(0, 120)}` };
  }
}

/** Local path or download http(s) URL before transcode/publish. */
export async function resolveVideoSourcePath(
  article: { video_url?: string | null },
): Promise<{ ok: true; path: string } | { ok: false; error: string } | null> {
  const local = localVideoPathForArticle(article);
  if (local) return { ok: true, path: local };
  const v = (article.video_url ?? '').trim();
  if (v.startsWith('http://') || v.startsWith('https://')) {
    return downloadVideoToTemp(v);
  }
  return null;
}

export type TranscodeProgressCb = (platform: string, pct: number, msg: string) => void;

/** Transcode one source file per target platform before publish. */
export async function prepareVideosForPublish(
  sourcePath: string,
  platforms: string[],
  onProgress?: TranscodeProgressCb,
): Promise<{ ok: true; paths: Record<string, string> } | { ok: false; platform: string; error: string }> {
  const paths: Record<string, string> = {};
  const uniq = [...new Set(platforms.map((p) => p.toLowerCase()).filter((p) => PLATFORM_SPECS[p]))];

  for (const platform of uniq) {
    onProgress?.(platform, 0, `معالجة الفيديو لـ ${platform}…`);
    const result = await transcodeForPlatform(sourcePath, platform, (pct, msg) => {
      onProgress?.(platform, pct, msg);
    });
    if (!result.ok || !result.outputPath) {
      return { ok: false, platform, error: result.error ?? `فشل معالجة الفيديو لـ ${platform}` };
    }
    // تحقق من أن ملف الإخراج غير فارغ
    if (!result.skipped) {
      const outStat = fs.statSync(result.outputPath);
      if (outStat.size < 1024) {
        return { ok: false, platform, error: `فشل تشفير ${platform} — ملف الإخراج فارغ` };
      }
    }
    paths[platform] = toLocalVideoUrl(result.outputPath);
    onProgress?.(
      platform,
      100,
      result.skipped ? `✓ ${platform} (جاهز)` : `✓ ${platform} (${result.info ?? 'تم التشفير'})`,
    );
  }
  return { ok: true, paths };
}

/* ── Validate ────────────────────────────────────────────────────────────── */
export function validateVideoFile(filePath: string): { ok: boolean; error?: string } {
  const maxMb = Number(getSetting('video_max_mb') || '2048') || 2048;
  if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' };
  const st = fs.statSync(filePath);
  if (st.size > maxMb * 1024 * 1024) return { ok: false, error: `File exceeds ${maxMb} MB` };
  if (!VIDEO_EXT.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, error: 'Unsupported format' };
  }
  return { ok: true };
}

export function checkVideoTools(): { ffmpeg: boolean; whisper: boolean; ffmpegPath: string } {
  const fp = getBundledFfmpegPath();
  return { ffmpeg: fs.existsSync(fp), whisper: false, ffmpegPath: fp };
}

/* ── Legacy: import video → article via Whisper ──────────────────────────── */
async function extractWav(videoPath: string, wavPath: string): Promise<void> {
  await execFileAsync(getBundledFfmpegPath(), [
    '-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath
  ], { timeout: 600_000 });
}

async function transcribeWav(wavPath: string, workDir: string): Promise<string> {
  const outBase = path.join(workDir, 'transcript');
  await execFileAsync(whisperPath(), [
    wavPath, '--model', getSetting('whisper_model') || 'base',
    '--output_format', 'txt', '--output_dir', workDir
  ], { timeout: 600_000 }).catch(async () => {
    await execFileAsync(whisperPath(), [
      wavPath, '--model', 'base', '--output_format', 'txt', '-o', outBase
    ], { timeout: 600_000 });
  });
  const txt = fs.readdirSync(workDir).find((f) => f.endsWith('.txt'));
  if (!txt) throw new Error('Whisper produced no output');
  return fs.readFileSync(path.join(workDir, txt), 'utf8');
}

export async function importVideoToArticle(
  filePath: string,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; articleId?: number; error?: string }> {
  const check = validateVideoFile(filePath);
  if (!check.ok) return check;
  const workDir = tempDir();
  const wavPath = path.join(workDir, 'audio.wav');
  try {
    onProgress?.('Extracting audio…');
    await extractWav(filePath, wavPath);
    onProgress?.('Transcribing…');
    const transcript = await transcribeWav(wavPath, workDir);
    if (transcript.trim().length < 40) return { ok: false, error: 'Transcript too short' };
    onProgress?.('Generating article…');
    const id = createArticle({
      title: path.basename(filePath, path.extname(filePath)),
      content: transcript,
      status: 'draft',
      ingest_status: 'video_ingest'
    });
    await runAi(id, 'rewrite');
    return { ok: true, articleId: id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
