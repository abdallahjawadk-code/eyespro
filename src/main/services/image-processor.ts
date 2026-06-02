/**
 * Feature 7 — Automatic Image Processing
 *
 * Uses the bundled ffmpeg-static binary to:
 *   - Resize images to a max width/height (preserving aspect ratio)
 *   - Convert to JPEG or WebP
 *   - Compress (quality setting)
 *   - Add a text watermark (bottom-right corner by default)
 *
 * Works on local file paths or remote URLs (downloads first to a temp file).
 * Returns the path to the processed output file.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join, extname } from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { getSetting } from './settings';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImageFormat = 'jpeg' | 'webp' | 'png';

export interface WatermarkOptions {
  text: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  fontColor?: string;   // e.g. 'white', '#ffffff'
  fontSize?: number;    // px, default 24
  opacity?: number;     // 0–1, default 0.7
}

export interface ImageProcessOptions {
  maxWidth?: number;               // default 1200
  maxHeight?: number;              // default 1200
  quality?: number;                // 1–100, default 82
  format?: ImageFormat;            // default: keep original or jpeg
  watermark?: WatermarkOptions;
  outputDir?: string;              // default: OS temp dir
}

export interface ImageProcessResult {
  ok: boolean;
  outputPath?: string;
  width?: number;
  height?: number;
  format?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function positionToFilter(pos: WatermarkOptions['position'] = 'bottom-right', padding = 20): string {
  switch (pos) {
    case 'bottom-right': return `x=W-tw-${padding}:y=H-th-${padding}`;
    case 'bottom-left':  return `x=${padding}:y=H-th-${padding}`;
    case 'top-right':    return `x=W-tw-${padding}:y=${padding}`;
    case 'top-left':     return `x=${padding}:y=${padding}`;
    case 'center':       return `x=(W-tw)/2:y=(H-th)/2`;
    default:             return `x=W-tw-${padding}:y=H-th-${padding}`;
  }
}

function buildVideoFilter(opts: ImageProcessOptions): string {
  const filters: string[] = [];

  // Scale with aspect ratio preserved
  const maxW = opts.maxWidth ?? 1200;
  const maxH = opts.maxHeight ?? 1200;
  filters.push(`scale='if(gt(iw,${maxW}),${maxW},iw)':'if(gt(ih,${maxH}),${maxH},ih)':flags=lanczos`);

  // Watermark
  if (opts.watermark) {
    const wm = opts.watermark;
    const color = wm.fontColor ?? 'white';
    const size  = wm.fontSize  ?? 24;
    const alpha = wm.opacity   ?? 0.7;
    const pos   = positionToFilter(wm.position);
    // Escape special characters in the watermark text
    const text  = wm.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(
      `drawtext=text='${text}':fontsize=${size}:fontcolor=${color}@${alpha}:${pos}`
    );
  }

  return filters.join(',');
}

function outputExtension(format?: ImageFormat, inputExt?: string): string {
  if (format === 'webp') return '.webp';
  if (format === 'png')  return '.png';
  if (format === 'jpeg') return '.jpg';
  // Keep original extension if it's a known image type
  if (inputExt && ['.jpg', '.jpeg', '.png', '.webp'].includes(inputExt.toLowerCase())) return inputExt;
  return '.jpg';
}

// ─── Core processor ───────────────────────────────────────────────────────────

/**
 * Process an image already on the local filesystem.
 * Returns the path to the newly created output file.
 */
export async function processLocalImage(
  inputPath: string,
  opts: ImageProcessOptions = {}
): Promise<ImageProcessResult> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg-static not available' };

  const ext = outputExtension(opts.format, extname(inputPath));
  const outDir = opts.outputDir ?? tmpdir();
  const outputPath = join(outDir, `eyespro-img-${randomUUID()}${ext}`);

  try {
    await mkdir(outDir, { recursive: true });

    const vf = buildVideoFilter(opts);
    const quality = opts.quality ?? 82;

    const args: string[] = ['-y', '-i', inputPath, '-vf', vf];

    if (ext === '.webp') {
      args.push('-c:v', 'libwebp', '-quality', String(quality));
    } else if (ext === '.png') {
      // PNG compression level (0=no compression, 9=max)
      const compLevel = Math.round((100 - quality) / 12);
      args.push('-compression_level', String(compLevel));
    } else {
      // JPEG
      args.push('-q:v', String(Math.round((100 - quality) / 3.6 + 1)));
    }

    args.push(outputPath);
    await execFileAsync(ffmpegPath, args, { timeout: 30_000 });

    return { ok: true, outputPath, format: ext.slice(1) };
  } catch (e) {
    unlink(outputPath).catch(() => undefined);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Download an image from a URL into a temp file, process it, and return the
 * processed file path. Caller is responsible for deleting the output file.
 */
export async function processImageFromUrl(
  url: string,
  opts: ImageProcessOptions = {}
): Promise<ImageProcessResult> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg-static not available' };

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EyesPro)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} fetching image` };

  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  const ext = contentType.includes('webp') ? '.webp'
    : contentType.includes('png')  ? '.png'
    : '.jpg';

  const tempInput = join(tmpdir(), `eyespro-dl-${randomUUID()}${ext}`);
  try {
    await writeFile(tempInput, buffer);
    return await processLocalImage(tempInput, opts);
  } finally {
    unlink(tempInput).catch(() => undefined);
  }
}

// ─── Convenience: apply site watermark from settings ─────────────────────────

/**
 * Process an image URL using the watermark text configured in settings
 * (`watermark_text`). Falls back to processing without watermark if not set.
 */
export async function processWithSiteWatermark(
  imageUrl: string,
  extraOpts: Omit<ImageProcessOptions, 'watermark'> = {}
): Promise<ImageProcessResult> {
  const watermarkText = getSetting('watermark_text');
  return processImageFromUrl(imageUrl, {
    ...extraOpts,
    maxWidth: 1200,
    quality: 85,
    format: 'jpeg',
    watermark: watermarkText
      ? { text: watermarkText, position: 'bottom-right', fontColor: 'white', fontSize: 22, opacity: 0.75 }
      : undefined,
  });
}
