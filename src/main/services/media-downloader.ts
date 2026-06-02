/**
 * Media Downloader — powered by yt-dlp (free, open-source)
 *
 * Supports 1000+ sites: YouTube, TikTok, Instagram, Twitter/X,
 * Facebook, Vimeo, Dailymotion, SoundCloud, and more.
 *
 * yt-dlp binary is auto-downloaded on first use (Windows exe, ~10 MB).
 * ffmpeg (already bundled via ffmpeg-static) is used for post-processing.
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, renameSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Sanitize file path — trim spaces, remove Windows-invalid chars, limit length */
function sanitizeFilePath(filePath: string): string {
  const dir  = dirname(filePath);
  const ext  = extname(filePath);
  const base = basename(filePath, ext)
    .trim()                             // remove leading/trailing spaces
    .replace(/[<>:"|?*\x00-\x1f]/g, '') // remove Windows-invalid chars
    .replace(/\s+/g, ' ')              // collapse multiple spaces
    .slice(0, 200);                    // limit length
  const newPath = join(dir, base + ext);
  if (newPath !== filePath && existsSync(filePath)) {
    try { renameSync(filePath, newPath); } catch { return filePath; }
  }
  return newPath;
}
import https from 'node:https';
import fs from 'node:fs';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { createLogger } from '../logger';

const log = createLogger('media-downloader');
import { isTorActive, getTorSocksPort, rotateTorIp } from './tor-manager';
import { connectSocks5Agent } from '../net/http';
import { getSetting } from './settings';

function getCustomProxyArg(): string | null {
  const raw = (getSetting('custom_proxy') || '').trim();
  if (!raw) return null;
  return /^\w+:\/\//.test(raw) ? raw : `http://${raw}`;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getBinDir(): string {
  const dir = join(app.getPath('userData'), 'bin');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getYtDlpPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return join(getBinDir(), `yt-dlp${ext}`);
}

function getDownloadsDir(): string {
  const dir = join(app.getPath('userData'), 'downloads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getFfmpegPath(): string {
  if (ffmpegStatic) {
    return app.isPackaged
      ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
      : ffmpegStatic;
  }
  return 'ffmpeg';
}

// ─── yt-dlp auto-install ──────────────────────────────────────────────────────

const YTDLP_URLS: Record<string, string> = {
  win32:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  linux:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
};

let downloadingBinary = false;

export async function ensureYtDlp(): Promise<string> {
  const ytdlp = getYtDlpPath();
  if (existsSync(ytdlp)) return ytdlp;
  if (downloadingBinary) {
    // wait up to 60s for concurrent download to finish
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (existsSync(ytdlp)) return ytdlp;
    }
    throw new Error('yt-dlp download timed out');
  }

  downloadingBinary = true;
  const url = YTDLP_URLS[process.platform] ?? YTDLP_URLS['linux']!;
  log.info(`Downloading yt-dlp from ${url}`);

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(ytdlp);
    function follow(u: string, redirects = 5): void {
      if (redirects <= 0) { reject(new Error('Too many redirects')); return; }
      const reqOpts: https.RequestOptions = {
        headers: { 'User-Agent': 'EyesPro/1.0' }
      };
      if (isTorActive()) {
        reqOpts.agent = connectSocks5Agent('127.0.0.1', getTorSocksPort());
      }
      https.get(u, reqOpts, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!, redirects - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`yt-dlp download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    }
    follow(url);
  });

  if (process.platform !== 'win32') {
    try { chmodSync(ytdlp, 0o755); } catch { /* ignore */ }
  }

  downloadingBinary = false;
  log.info(`yt-dlp installed at: ${ytdlp}`);
  return ytdlp;
}

export function isYtDlpInstalled(): boolean {
  return existsSync(getYtDlpPath());
}

// ─── Auto-update ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastUpdateCheck = 0;

/** Run yt-dlp --update to fetch the latest version from GitHub (self-updating binary) */
export async function updateYtDlp(): Promise<{ updated: boolean; version: string }> {
  const ytdlp = getYtDlpPath();
  if (!existsSync(ytdlp)) return { updated: false, version: 'not installed' };

  try {
    log.info('Checking for yt-dlp updates…');
    const args = ['--update'];
    const customProxy = getCustomProxyArg();
    if (customProxy) {
      args.push('--proxy', customProxy);
    } else if (isTorActive()) {
      args.push('--proxy', `socks5://127.0.0.1:${getTorSocksPort()}`);
    }
    const { stdout, stderr } = await execFileAsync(ytdlp, args, { timeout: 60_000 });
    const out = (stdout + stderr).trim();
    lastUpdateCheck = Date.now();

    const updated = out.includes('Updated') || out.includes('update');
    const verM = /yt-dlp\s+([\d.]+)/i.exec(out);
    const version = verM ? verM[1] : 'unknown';
    log.info(`yt-dlp update check: ${out.slice(0, 120)}`);
    return { updated, version };
  } catch (e) {
    log.warn(`yt-dlp update failed (non-fatal): ${(e as Error).message}`);
    return { updated: false, version: 'check failed' };
  }
}

/** Get current yt-dlp version string */
export async function getYtDlpVersion(): Promise<string> {
  try {
    const ytdlp = getYtDlpPath();
    if (!existsSync(ytdlp)) return 'not installed';
    const { stdout } = await execFileAsync(ytdlp, ['--version'], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Called once at startup — updates yt-dlp in the background if 24h have passed.
 * yt-dlp's --update flag pulls the latest release directly from GitHub releases.
 * No external service needed beyond github.com.
 */
export function scheduleYtDlpAutoUpdate(): void {
  // Run immediately on startup (in background)
  void (async () => {
    if (!existsSync(getYtDlpPath())) return; // not installed yet, skip
    await updateYtDlp().catch(() => { /* non-fatal */ });
  })();

  // Then check every 24h
  setInterval(() => {
    if (Date.now() - lastUpdateCheck < UPDATE_INTERVAL_MS) return;
    void updateYtDlp().catch(() => { /* non-fatal */ });
  }, 60 * 60 * 1000); // check the interval condition every hour
}

// ─── Download types ───────────────────────────────────────────────────────────

export type DownloadQuality = 'best' | '1080p' | '720p' | '480p' | '360p' | 'audio_only';

export interface DownloadJob {
  id: string;
  url: string;
  quality: DownloadQuality;
  status: 'pending' | 'downloading' | 'done' | 'error';
  progress: number;    // 0–100
  speed: string;
  eta: string;
  outputPath: string | null;
  title: string;
  error: string | null;
  startedAt: string;
}

const jobs = new Map<string, DownloadJob>();
let onProgress: ((job: DownloadJob) => void) | null = null;

export function setProgressCallback(cb: (job: DownloadJob) => void): void {
  onProgress = cb;
}

function notify(job: DownloadJob): void {
  onProgress?.(job);
}

// ─── Format selection ─────────────────────────────────────────────────────────
// Priority: H.264 (avc1) video + AAC audio → guaranteed Chromium compatibility.
// Falls back progressively to any MP4, then any format.

const H264 = 'bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]';
const MP4  = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]';

function buildFormatArgs(quality: DownloadQuality): string[] {
  switch (quality) {
    case 'audio_only':
      return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
    case '1080p':
      return ['-f', `${H264}[height<=1080]/${MP4}[height<=1080]/best[height<=1080]/best`];
    case '720p':
      return ['-f', `${H264}[height<=720]/${MP4}[height<=720]/best[height<=720]/best`];
    case '480p':
      return ['-f', `${H264}[height<=480]/${MP4}[height<=480]/best[height<=480]/best`];
    case '360p':
      return ['-f', `${H264}[height<=360]/${MP4}[height<=360]/best[height<=360]/best`];
    case 'best':
    default:
      return ['-f', `${H264}/${MP4}/best[ext=mp4]/best`];
  }
}

// Post-process: remux to MP4 with H.264 if needed (handles MKV/WebM downloads)
async function ensureH264(inputPath: string, ffmpeg: string): Promise<string> {
  if (!existsSync(inputPath)) return inputPath;
  const ext = extname(inputPath).toLowerCase();
  // Already safe formats for Chromium
  if (ext === '.mp3' || ext === '.m4a' || ext === '.wav') return inputPath;
  if (ext === '.mp4') return inputPath; // assume already H.264 from format selection

  // MKV / WebM → remux to MP4
  const output = sanitizeFilePath(inputPath.replace(/\.[^.]+$/, '.mp4'));
  if (existsSync(output)) return output;
  try {
    await execFileAsync(ffmpeg, [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      output,
    ], { timeout: 3_600_000 });
    return output;
  } catch {
    return inputPath; // fall back to original if conversion fails
  }
}

// ─── Core downloader ──────────────────────────────────────────────────────────

export async function downloadMedia(
  url: string,
  quality: DownloadQuality = 'best',
  jobId?: string,
  retryCount = 0
): Promise<DownloadJob> {
  const customProxy = getCustomProxyArg();
  const id = jobId ?? `dl_${Date.now()}`;
  const outputDir = getDownloadsDir();
  const outputTemplate = join(outputDir, '%(title)s.%(ext)s');

  let job = jobs.get(id);
  if (!job) {
    job = {
      id,
      url,
      quality,
      status: 'pending',
      progress: 0,
      speed: '',
      eta: '',
      outputPath: null,
      title: '',
      error: null,
      startedAt: new Date().toISOString(),
    };
    jobs.set(id, job);
  } else {
    // Reset state for retry
    job.status = 'pending';
    job.progress = 0;
    job.speed = '';
    job.eta = '';
    job.error = null;
  }
  notify(job);

  try {
    const ytdlp = await ensureYtDlp();
    const ffmpeg = getFfmpegPath();

    const args = [
      ...buildFormatArgs(quality),
      '--ffmpeg-location', ffmpeg,
      '--merge-output-format', quality === 'audio_only' ? 'mp3' : 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      '--newline',
    ];

    if (customProxy) {
      args.push('--proxy', customProxy);
    } else {
      const useTorProxy = isTorActive() && retryCount < 3;
      if (useTorProxy) {
        args.push('--proxy', `socks5://127.0.0.1:${getTorSocksPort()}`);
      }
    }

    if (retryCount === 1) {
      args.push('--cookies-from-browser', 'chrome');
    } else if (retryCount === 2) {
      args.push('--cookies-from-browser', 'edge');
    }

    args.push(url);

    job.status = 'downloading';
    notify(job);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ytdlp, args, { windowsHide: true });
      let lastOutput = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        lastOutput += text;

        const pctM = /\[download\]\s+([\d.]+)%/.exec(text);
        if (pctM) job!.progress = Math.round(parseFloat(pctM[1]));

        const speedM = /at\s+([\d.]+\w+\/s)/.exec(text);
        if (speedM) job!.speed = speedM[1];

        const etaM = /ETA\s+([\d:]+)/.exec(text);
        if (etaM) job!.eta = etaM[1];

        const titleM = /\[info\] ([^:]+):/.exec(text);
        if (titleM && !job!.title) job!.title = titleM[1].trim().slice(0, 100);

        const destM = /\[download\] Destination:\s+(.+)/.exec(text) ||
                      /\[Merger\] Merging formats into "(.+)"/.exec(text) ||
                      /\[ExtractAudio\] Destination:\s+(.+)/.exec(text);
        if (destM) job!.outputPath = sanitizeFilePath(destM[1].trim());

        notify(job!);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const titleM = /\[info\] ([^:]+):/.exec(text);
        if (titleM && !job!.title) job!.title = titleM[1].trim().slice(0, 100);
      });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}\n${lastOutput.slice(-500)}`));
      });
    });

    if (job.outputPath && quality !== 'audio_only') {
      const safe = await ensureH264(job.outputPath, ffmpeg);
      if (safe !== job.outputPath) job.outputPath = safe;
    }

    job.status = 'done';
    job.progress = 100;
    notify(job);

  } catch (e) {
    const errStr = (e as Error).message || '';
    const isBotBlock = errStr.includes('confirm you') || errStr.includes('bot') || errStr.includes('403') || errStr.includes('Too Many Requests') || errStr.includes('Sign in') || errStr.includes('cookies');

    if (isBotBlock && retryCount < 3) {
      if (retryCount === 0 && !customProxy && isTorActive()) {
        log.info('Download failed due to bot block. Rotating Tor IP and retrying…');
        await rotateTorIp();
        await new Promise((r) => setTimeout(r, 4000));
      } else {
        log.info(`Download failed due to bot block. Retrying with cookies (attempt ${retryCount})…`);
      }
      return downloadMedia(url, quality, id, retryCount + 1);
    }

    job.status = 'error';
    job.error = (e as Error).message;
    notify(job);
    log.warn(`Download failed for ${url}: ${job.error}`);
  }

  jobs.set(id, job);
  return job;
}

// ─── Job management ───────────────────────────────────────────────────────────

export function listDownloads(): DownloadJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getDownload(id: string): DownloadJob | null {
  return jobs.get(id) ?? null;
}

export function clearCompletedDownloads(): void {
  for (const [id, job] of jobs) {
    if (job.status === 'done' || job.status === 'error') jobs.delete(id);
  }
}

export function getDownloadsDir_(): string {
  return getDownloadsDir();
}

// ─── Video info (metadata preview before download) ────────────────────────────

export interface VideoInfo {
  title: string;
  uploader: string;
  duration: number;        // seconds
  thumbnail: string;
  description: string;
  viewCount: number | null;
  likeCount: number | null;
  uploadDate: string;
  platform: string;
  formats: { id: string; ext: string; height: number | null; note: string }[];
  webpage_url: string;
}

export async function getVideoInfo(url: string, retryCount = 0): Promise<VideoInfo> {
  const customProxy = getCustomProxyArg();
  const ytdlp = await ensureYtDlp();
  const args = [
    '--dump-json', '--no-playlist', '--no-warnings'
  ];
  if (customProxy) {
    args.push('--proxy', customProxy);
  } else {
    const useTorProxy = isTorActive() && retryCount < 3;
    if (useTorProxy) {
      args.push('--proxy', `socks5://127.0.0.1:${getTorSocksPort()}`);
    }
  }
  if (retryCount === 1) {
    args.push('--cookies-from-browser', 'chrome');
  } else if (retryCount === 2) {
    args.push('--cookies-from-browser', 'edge');
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync(ytdlp, args, { timeout: 30_000 });
    const d = JSON.parse(stdout) as Record<string, unknown>;
    const formats = (Array.isArray(d.formats) ? d.formats : []) as Record<string, unknown>[];
    return {
      title:       String(d.title ?? ''),
      uploader:    String(d.uploader ?? d.channel ?? ''),
      duration:    Number(d.duration ?? 0),
      thumbnail:   String(d.thumbnail ?? ''),
      description: String(d.description ?? '').slice(0, 500),
      viewCount:   d.view_count != null ? Number(d.view_count) : null,
      likeCount:   d.like_count != null ? Number(d.like_count) : null,
      uploadDate:  String(d.upload_date ?? ''),
      platform:    String(d.extractor_key ?? d.extractor ?? 'unknown'),
      formats:     formats.slice(0, 20).map((f) => ({
        id:     String(f.format_id ?? ''),
        ext:    String(f.ext ?? ''),
        height: f.height != null ? Number(f.height) : null,
        note:   String(f.format_note ?? f.format ?? ''),
      })),
      webpage_url: String(d.webpage_url ?? url),
    };
  } catch (e) {
    const errStr = (e as Error).message || '';
    const isBotBlock = errStr.includes('confirm you') || errStr.includes('bot') || errStr.includes('403') || errStr.includes('Too Many Requests') || errStr.includes('Sign in') || errStr.includes('cookies');

    if (isBotBlock && retryCount < 3) {
      if (retryCount === 0 && !customProxy && isTorActive()) {
        log.info('YouTube bot detection triggered in getVideoInfo. Rotating Tor IP and retrying…');
        await rotateTorIp();
        await new Promise((r) => setTimeout(r, 4000));
      } else {
        log.info(`YouTube bot detection triggered in getVideoInfo. Retrying with browser cookies (attempt ${retryCount})…`);
      }
      return getVideoInfo(url, retryCount + 1);
    }
    throw e;
  }
}

// ─── Video editing via bundled ffmpeg ────────────────────────────────────────

export type PlatformRatio = 'youtube' | 'tiktok' | 'instagram_reel' | 'instagram_square' | 'twitter';

const PLATFORM_SCALE: Record<PlatformRatio, string> = {
  youtube:          'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
  tiktok:           'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
  instagram_reel:   'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
  instagram_square: 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2',
  twitter:          'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
};

function editedPath(inputPath: string, suffix: string, ext = '.mp4'): string {
  const dir  = getDownloadsDir();
  const name = basename(inputPath, extname(inputPath));
  return join(dir, `${name}_${suffix}${ext}`);
}

/** Trim video: cut from startSec to endSec */
export async function trimVideo(inputPath: string, startSec: number, endSec: number): Promise<string> {
  const ffmpeg = getFfmpegPath();
  const output = editedPath(inputPath, `trim_${Math.round(startSec)}-${Math.round(endSec)}`);
  await execFileAsync(ffmpeg, [
    '-y', '-i', inputPath,
    '-ss', String(startSec),
    '-to', String(endSec),
    '-c', 'copy',
    output,
  ], { timeout: 300_000 });
  return output;
}

/** Add text watermark to video */
export async function addWatermark(
  inputPath: string,
  text: string,
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' = 'bottom_right',
): Promise<string> {
  const ffmpeg = getFfmpegPath();
  const output = editedPath(inputPath, 'watermark');
  const posMap = {
    top_left:     'x=20:y=20',
    top_right:    'x=w-tw-20:y=20',
    bottom_left:  'x=20:y=h-th-20',
    bottom_right: 'x=w-tw-20:y=h-th-20',
    center:       'x=(w-tw)/2:y=(h-th)/2',
  };
  const safeText = text.replace(/[:'\\]/g, '');
  const drawtext = `drawtext=text='${safeText}':fontsize=36:fontcolor=white:borderw=2:bordercolor=black:${posMap[position]}`;
  await execFileAsync(ffmpeg, [
    '-y', '-i', inputPath,
    '-vf', drawtext,
    '-codec:a', 'copy',
    output,
  ], { timeout: 600_000 });
  return output;
}

/** Resize video for a specific platform ratio */
export async function resizeForPlatform(inputPath: string, platform: PlatformRatio): Promise<string> {
  const ffmpeg = getFfmpegPath();
  const output = editedPath(inputPath, platform);
  await execFileAsync(ffmpeg, [
    '-y', '-i', inputPath,
    '-vf', PLATFORM_SCALE[platform],
    '-c:a', 'copy',
    output,
  ], { timeout: 600_000 });
  return output;
}

/** Extract audio from video as MP3 */
export async function extractAudio(inputPath: string): Promise<string> {
  const ffmpeg = getFfmpegPath();
  const output = editedPath(inputPath, 'audio', '.mp3');
  await execFileAsync(ffmpeg, [
    '-y', '-i', inputPath,
    '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k',
    output,
  ], { timeout: 300_000 });
  return output;
}

/** Scan downloads folder and return all video/audio files */
export function scanDownloads(): { name: string; path: string; size: number; ext: string; mtimeMs: number }[] {
  const dir = getDownloadsDir();
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.mp3', '.m4a', '.wav', '.ogg', '.flac']);
  try {
    return readdirSync(dir)
      .map((f) => {
        const fullPath = join(dir, f);
        const ext = extname(f).toLowerCase();
        if (!VIDEO_EXTS.has(ext)) return null;
        const stat = statSync(fullPath);
        return { name: basename(f, ext), path: fullPath, size: stat.size, ext, mtimeMs: stat.mtimeMs };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.mtimeMs - a!.mtimeMs)) as { name: string; path: string; size: number; ext: string; mtimeMs: number }[];
  } catch { return []; }
}
