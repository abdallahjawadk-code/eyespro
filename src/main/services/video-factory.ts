/**
 * Feature: Video Factory (صانع الفيديو)
 * Generates short news videos from articles using AI scripts + Windows SAPI TTS + FFmpeg.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { getDb } from '../db/database';
import { runAiChain } from './ai';
import { getArticle } from './articles';
import { getSetting } from './settings';
import { createLogger } from '../logger';

const log = createLogger('video-factory');
const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoJob {
  id: number;
  article_id: number | null;
  status: string;
  script: string | null;
  audio_path: string | null;
  output_path: string | null;
  template: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFfmpegPath(): string {
  if (!ffmpegStatic) return getSetting('ffmpeg_path') || 'ffmpeg';
  if (app.isPackaged) return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  return ffmpegStatic;
}

function tempVideoDir(): string {
  const dir = path.join(app.getPath('userData'), 'video-factory', randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outputVideoDir(): string {
  const dir = path.join(app.getPath('userData'), 'video-factory', 'output');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── AI Script Generation ─────────────────────────────────────────────────────

export async function generateVideoScript(articleId: number): Promise<{ script: string }> {
  const article = getArticle(articleId);
  if (!article) throw new Error('Article not found');

  const content = (article.content || '').slice(0, 500);
  const prompt = `اكتب نصاً إخبارياً لفيديو قصير (30-60 ثانية) للمقال التالي:\nالعنوان: ${article.title}\nالمحتوى: ${content}\n\nالمطلوب: 5 جمل قصيرة ومؤثرة، كل جملة في سطر منفصل، مناسبة للنطق بالصوت.`;

  let script: string;
  try {
    script = await runAiChain(prompt, '');
  } catch (e) {
    throw new Error(`AI script generation failed: ${(e as Error).message}`);
  }

  return { script: script.trim() };
}

// ─── TTS via Windows SAPI ─────────────────────────────────────────────────────

export async function generateTTS(text: string, outputWavPath: string): Promise<{ ok: boolean; error?: string }> {
  // Escape single quotes in text for PowerShell
  const escaped = text.replace(/'/g, "''").replace(/"/g, '`"');

  const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
# Try to find Arabic voice
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$arabic = $voices | Where-Object { $_.Culture.Name -like 'ar-*' -or $_.Name -like '*Arabic*' -or $_.Name -like '*Arab*' } | Select-Object -First 1
if ($arabic) { $synth.SelectVoice($arabic.Name) }
$synth.Rate = -1
$synth.SetOutputToWaveFile('${outputWavPath.replace(/\\/g, '\\\\')}')
$synth.Speak('${escaped}')
$synth.Dispose()
`;

  try {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      psScript
    ], { timeout: 60000 });
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    log.warn(`TTS generation failed (will use silent audio): ${msg}`);
    return { ok: false, error: msg };
  }
}

// ─── SRT subtitle generation ─────────────────────────────────────────────────

function buildSrtFromLines(lines: string[]): string {
  const secondsPerLine = 6;
  return lines
    .filter((l) => l.trim())
    .map((line, i) => {
      const start = i * secondsPerLine;
      const end = start + secondsPerLine - 0.5;
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600).toString().padStart(2, '0');
        const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
        const sec = Math.floor(s % 60).toString().padStart(2, '0');
        const ms = Math.round((s % 1) * 1000).toString().padStart(3, '0');
        return `${h}:${m}:${sec},${ms}`;
      };
      return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${line.trim()}\n`;
    })
    .join('\n');
}

// ─── Video Assembly ───────────────────────────────────────────────────────────

async function assembleVideo(
  _workDir: string,
  audioPath: string | null,
  srtPath: string,
  scriptLines: string[],
  outputPath: string
): Promise<void> {
  const ffmpeg = getFfmpegPath();
  const totalSeconds = Math.max(scriptLines.filter((l) => l.trim()).length * 6, 10);

  // Build FFmpeg args
  const args: string[] = [];

  if (audioPath && fs.existsSync(audioPath)) {
    // Use real audio
    args.push('-f', 'lavfi', '-i', `color=color=#1a1a2e:size=1280x720:rate=25:duration=${totalSeconds}`);
    args.push('-i', audioPath);
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
    args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-shortest');
  } else {
    // Silent fallback
    args.push('-f', 'lavfi', '-i', `color=color=#1a1a2e:size=1280x720:rate=25:duration=${totalSeconds}`);
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
    args.push('-c:a', 'aac', '-b:a', '64k');
    args.push('-t', String(totalSeconds));
  }

  // Subtitles filter — escape path for FFmpeg on Windows
  const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  args.push(
    '-vf',
    `subtitles='${srtEscaped}':force_style='FontName=Arial,FontSize=28,PrimaryColour=&Hffffff,Alignment=2'`
  );
  args.push('-y', outputPath);

  await execFileAsync(ffmpeg, args, { timeout: 120000 });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export function createVideoJob(articleId: number, template = 'news'): { id: number } {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO video_jobs (article_id, status, template, created_at, updated_at)
     VALUES (?, 'pending', ?, datetime('now'), datetime('now'))`
  ).run(articleId, template);
  return { id: result.lastInsertRowid as number };
}

export function listVideoJobs(): VideoJob[] {
  return getDb().prepare(
    `SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT 200`
  ).all() as VideoJob[];
}

export function getVideoJob(id: number): VideoJob | null {
  return (getDb().prepare(`SELECT * FROM video_jobs WHERE id = ?`).get(id) as VideoJob) ?? null;
}

function updateJob(id: number, data: Partial<VideoJob>): void {
  const fields = Object.keys(data)
    .map((k) => `${k} = ?`)
    .join(', ');
  const values = Object.values(data);
  getDb()
    .prepare(`UPDATE video_jobs SET ${fields}, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, id);
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function generateVideo(jobId: number): Promise<{ outputPath: string }> {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM video_jobs WHERE id = ?`).get(jobId) as VideoJob | undefined;
  if (!job) throw new Error(`Video job ${jobId} not found`);

  updateJob(jobId, { status: 'running', error: null });

  const workDir = tempVideoDir();
  const outDir = outputVideoDir();

  try {
    // 1. Get/generate script
    let script = job.script;
    if (!script && job.article_id) {
      const res = await generateVideoScript(job.article_id);
      script = res.script;
      updateJob(jobId, { script });
    }
    if (!script) throw new Error('No script available and no article linked');

    const scriptLines = script.split('\n').filter((l) => l.trim()).slice(0, 5);

    // 2. Generate TTS
    const wavPath = path.join(workDir, 'audio.wav');
    const ttsResult = await generateTTS(scriptLines.join('. '), wavPath);
    const audioPath = ttsResult.ok ? wavPath : null;
    if (audioPath) updateJob(jobId, { audio_path: audioPath });

    // 3. Write SRT file
    const srtContent = buildSrtFromLines(scriptLines);
    const srtPath = path.join(workDir, 'subtitles.srt');
    fs.writeFileSync(srtPath, srtContent, 'utf8');

    // 4. Assemble video
    const outputPath = path.join(outDir, `job-${jobId}-${Date.now()}.mp4`);
    await assembleVideo(workDir, audioPath, srtPath, scriptLines, outputPath);

    updateJob(jobId, { status: 'done', output_path: outputPath });
    log.info(`Video job ${jobId} completed: ${outputPath}`);
    return { outputPath };
  } catch (e) {
    const errMsg = (e as Error).message.slice(0, 500);
    updateJob(jobId, { status: 'failed', error: errMsg });
    throw e;
  } finally {
    // Clean up temp dir
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
