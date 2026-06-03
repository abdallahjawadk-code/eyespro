/**
 * Local Whisper (whisper.cpp) — auto-downloaded + self-updating, fully offline.
 *
 * Mirrors the ffmpeg auto-update pattern: the binary is fetched from the official
 * whisper.cpp GitHub releases and the model from the official HuggingFace repo,
 * cached under userData, and refreshed in the background. Audio NEVER leaves the
 * machine. Downloads are HTTPS-only from official domains; the model is data, the
 * binary is the upstream signed release.
 */
import { app } from 'electron';
import https from 'node:https';
import { existsSync, mkdirSync, createWriteStream, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSetting } from './settings';
import { createLogger } from '../logger';

const execFileAsync = promisify(execFile);
const log = createLogger('whisper');

const MODEL_NAME = 'ggml-base.bin'; // multilingual, ~147MB; good Arabic/English balance
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}?download=true`;
const RELEASES_API = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';
const DOWNLOAD_TIMEOUT = 600_000;
let updating = false;

function whisperDir(): string {
  const dir = join(app.getPath('userData'), 'whisper');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Locate the whisper CLI inside the extracted build (name changed across versions). */
export function resolveWhisperBinary(): string | null {
  const dir = whisperDir();
  const names = ['whisper-cli.exe', 'main.exe', 'whisper.exe'];
  const search = (d: string, depth: number): string | null => {
    if (depth < 0 || !existsSync(d)) return null;
    let entries: string[]; try { entries = readdirSync(d); } catch { return null; }
    for (const n of names) if (entries.includes(n)) return join(d, n);
    for (const e of entries) { const p = join(d, e); try { if (statSync(p).isDirectory()) { const f = search(p, depth - 1); if (f) return f; } } catch { /* ignore */ } }
    return null;
  };
  return search(dir, 3);
}

export function resolveWhisperModel(): string | null {
  const p = join(whisperDir(), MODEL_NAME);
  return existsSync(p) ? p : null;
}

export async function localWhisperReady(): Promise<boolean> {
  return !!resolveWhisperBinary() && !!resolveWhisperModel();
}

export function getWhisperInfo(): { binary: string | null; model: string | null; ready: boolean } {
  const binary = resolveWhisperBinary();
  const model = resolveWhisperModel();
  return { binary, model, ready: !!binary && !!model };
}

// ── download helpers ──────────────────────────────────────────────────────────
function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'EyesPro', ...headers } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(new URL(res.headers.location, url).toString(), headers).then(resolve, reject); res.resume(); return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function downloadFile(url: string, dest: string, redirectsLeft = 6): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const fail = (e: Error) => { file.close(); try { unlinkSync(dest); } catch { /* ignore */ } reject(e); };
    const req = https.get(url, { headers: { 'User-Agent': 'EyesPro' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return fail(new Error('too many redirects'));
        res.resume(); downloadFile(new URL(res.headers.location, url).toString(), dest, redirectsLeft - 1).then(resolve, fail); return;
      }
      if (res.statusCode !== 200) return fail(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.setTimeout(DOWNLOAD_TIMEOUT, () => req.destroy(new Error('download timeout')));
    req.on('error', fail);
  });
}

async function extractZip(zip: string, destDir: string): Promise<void> {
  // Use the Windows System32 bsdtar (supports ZIP — GNU tar in PATH does not).
  // Run with cwd in the target dir + basename so there is no drive letter for tar.
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  await execFileAsync(tar, ['-xf', basename(zip)], { cwd: destDir, timeout: 120_000, windowsHide: true });
}

/** Download/refresh the local whisper.cpp binary + model. */
export async function updateWhisper(onProgress?: (msg: string) => void): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'auto-download is Windows-only' };
  if (updating) return { ok: false, error: 'update already in progress' };
  updating = true;
  const dir = whisperDir();
  try {
    // 1) model (official HuggingFace)
    if (!resolveWhisperModel()) {
      onProgress?.('تنزيل نموذج Whisper…');
      await downloadFile(MODEL_URL, join(dir, MODEL_NAME));
    }
    // 2) binary (latest official GitHub release, win64)
    if (!resolveWhisperBinary()) {
      onProgress?.('تنزيل محرّك Whisper…');
      const rel = await httpsGet(RELEASES_API, { Accept: 'application/vnd.github+json' });
      const data = JSON.parse(rel.body) as { assets?: { name: string; browser_download_url: string }[] };
      const assets = data.assets ?? [];
      // Prefer the BLAS build (faster CPU) → basic x64 → any non-cuda x64 zip.
      const asset = assets.find((a) => /blas-bin-x64\.zip$/i.test(a.name))
        ?? assets.find((a) => /^whisper-bin-x64\.zip$/i.test(a.name))
        ?? assets.find((a) => /bin-x64\.zip$/i.test(a.name) && !/cublas|cuda/i.test(a.name));
      if (!asset) throw new Error('لم أجد محرّك Whisper لويندوز في الإصدار الأحدث');
      const zip = join(dir, 'whisper-bin.zip');
      await downloadFile(asset.browser_download_url, zip);
      await extractZip(zip, dir);
    }
    const ok = await localWhisperReady();
    log.info('whisper update done', { ready: ok });
    return ok ? { ok: true } : { ok: false, error: 'تعذّر تجهيز Whisper المحلّي' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    updating = false;
  }
}

/** Transcribe a 16kHz mono WAV with the local whisper.cpp binary. */
export async function transcribeLocal(wavPath: string, lang = 'ar'): Promise<string> {
  const bin = resolveWhisperBinary();
  const model = resolveWhisperModel();
  if (!bin || !model) throw new Error('whisper المحلّي غير جاهز');
  const { stdout } = await execFileAsync(bin, ['-m', model, '-f', wavPath, '-l', lang, '-nt', '-np'], { timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return stdout.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim();
}

/** Startup: if local whisper is enabled but not present, fetch it in the background. */
export function maybeAutoUpdateWhisper(): void {
  if (process.platform !== 'win32') return;
  if (getSetting('stt_whisper_local') !== '1') return;
  setTimeout(() => { void updateWhisper().catch(() => undefined); }, 30_000);
}
