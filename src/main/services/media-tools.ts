/**
 * Media tools (ffmpeg/ffprobe) resolution with optional auto-update.
 *
 * Playback NEVER depends on a download: ffmpeg-static is a complete GPL build
 * (all decoders incl. HEVC/MPEG-2/VC-1 + libx264/aac encoders), so resolveFfmpeg()
 * falls back to it. updateMediaTools() can fetch the latest full build from
 * BtbN/FFmpeg-Builds and prefer it once present (newer codecs + security fixes).
 */
import { app } from 'electron';
import { join, basename } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import fs from 'node:fs';
import https from 'node:https';
import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { createLogger } from '../logger';

const log = createLogger('media-tools');

// Latest full Windows GPL build (contains ffmpeg.exe + ffprobe.exe under bin/).
const FFMPEG_LATEST_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const exe = process.platform === 'win32' ? '.exe' : '';

function binDir(): string {
  const dir = join(app.getPath('userData'), 'bin');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function toolsDir(): string {
  return join(binDir(), 'ffmpeg');
}

/** Bundled ffmpeg path (asar-aware), or 'ffmpeg' on PATH as last resort. */
function bundledFfmpeg(): string {
  if (!ffmpegStatic) return 'ffmpeg';
  return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
}

/** Find a named tool inside the downloaded build (it may sit under a versioned subdir). */
function downloadedTool(name: string): string | null {
  const dir = toolsDir();
  if (!existsSync(dir)) return null;
  const direct = join(dir, `${name}${exe}`);
  if (existsSync(direct)) return direct;
  // BtbN zips extract to ffmpeg-*/bin/ffmpeg.exe — search one or two levels deep.
  const stack = [dir];
  for (let depth = 0; depth < 3 && stack.length; depth++) {
    const next: string[] = [];
    for (const d of stack) {
      let entries: string[] = [];
      try { entries = fs.readdirSync(d); } catch { continue; }
      for (const e of entries) {
        const full = join(d, e);
        if (e.toLowerCase() === `${name}${exe}`) return full;
        try { if (fs.statSync(full).isDirectory()) next.push(full); } catch { /* skip */ }
      }
    }
    stack.length = 0;
    stack.push(...next);
  }
  return null;
}

/** Resolve ffmpeg: prefer the auto-updated build, else the bundled complete build. */
export function resolveFfmpeg(): string {
  return downloadedTool('ffmpeg') ?? bundledFfmpeg();
}

/** Resolve ffprobe alongside ffmpeg. */
export function resolveFfprobe(): string {
  const dl = downloadedTool('ffprobe');
  if (dl) return dl;
  const ff = bundledFfmpeg();
  const probe = ff.replace(/ffmpeg(\.exe)?$/i, `ffprobe$1`);
  return existsSync(probe) ? probe : ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe');
}

export function getMediaToolsInfo(): { source: 'updated' | 'bundled'; ffmpeg: string; updatedAvailable: boolean } {
  const updated = downloadedTool('ffmpeg');
  return {
    source: updated ? 'updated' : 'bundled',
    ffmpeg: updated ?? bundledFfmpeg(),
    updatedAvailable: !!updated,
  };
}

/** Download a URL to a file with a timeout, following redirects. */
function download(url: string, dest: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { file.close(); } catch { /* noop */ }
      try { fs.unlinkSync(dest); } catch { /* noop */ }
      reject(err);
    };
    const req = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { fail(new Error('Too many redirects')); return; }
        download(new URL(res.headers.location, url).toString(), dest, redirectsLeft - 1).then(resolve, fail);
        return;
      }
      if (status !== 200) { res.resume(); fail(new Error(`HTTP ${status}`)); return; }
      res.pipe(file);
      file.on('finish', () => { if (!settled) { settled = true; file.close(); resolve(); } });
      file.on('error', fail);
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('download timeout')));
    req.on('error', fail);
  });
}

/** Extract a .zip with the system bsdtar (System32\tar.exe handles zip), using a
 *  cwd + relative paths so a drive-letter path is never mis-parsed as a remote host. */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const cwd = join(zipPath, '..');
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', basename(zipPath), '-C', 'ffmpeg'], { cwd }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

let updating = false;

/**
 * Best-effort: download the latest full ffmpeg build and extract it so resolveFfmpeg()
 * prefers it. Never throws into callers — failures leave the bundled build in place.
 */
export async function updateMediaTools(): Promise<{ ok: boolean; source: string; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, source: 'bundled', error: 'auto-update is Windows-only' };
  if (updating) return { ok: false, source: 'bundled', error: 'update already in progress' };
  updating = true;
  const zip = join(binDir(), 'ffmpeg-latest.zip');
  try {
    if (!existsSync(toolsDir())) mkdirSync(toolsDir(), { recursive: true });
    log.info('Downloading latest ffmpeg build…');
    await download(FFMPEG_LATEST_URL, zip);
    await extractZip(zip, toolsDir());
    try { fs.unlinkSync(zip); } catch { /* noop */ }
    const found = downloadedTool('ffmpeg');
    if (!found) throw new Error('ffmpeg.exe not found after extract');
    log.info(`ffmpeg updated: ${found}`);
    return { ok: true, source: 'updated' };
  } catch (err) {
    log.warn('ffmpeg auto-update failed, keeping bundled build', { error: (err as Error).message });
    return { ok: false, source: 'bundled', error: (err as Error).message };
  } finally {
    updating = false;
  }
}
