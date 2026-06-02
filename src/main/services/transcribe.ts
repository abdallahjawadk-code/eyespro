/**
 * Feature 4 — Automatic Video/Audio Transcription
 *
 * Downloads audio from a video URL using ffmpeg, then transcribes via:
 *   1. OpenAI Whisper API  (if openai_api_key is set)
 *   2. Ollama Whisper      (if ollama_base_url is set and whisper model is loaded)
 *
 * The transcription is appended to the article's content and summary.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { getSetting } from './settings';
import { getArticle } from './articles';
import { getDb } from '../db/database';
import { postJson } from '../net/http';

const execFileAsync = promisify(execFile);

// ─── Audio extraction ─────────────────────────────────────────────────────────

/**
 * Download a video URL to a temp file and extract its audio as mono 16kHz WAV.
 * Returns the path to the temp WAV file. Caller must delete it after use.
 */
async function extractAudioFromUrl(videoUrl: string): Promise<string> {
  if (!ffmpegPath) throw new Error('ffmpeg-static not found');

  const tempInput  = join(tmpdir(), `eyespro-vid-${randomUUID()}.mp4`);
  const tempOutput = join(tmpdir(), `eyespro-audio-${randomUUID()}.wav`);

  try {
    // Step 1: download video (max 200 MB, 10 min)
    await execFileAsync(ffmpegPath, [
      '-y',
      '-user_agent', 'Mozilla/5.0',
      '-i', videoUrl,
      '-t', '600',                   // max 10 minutes
      '-fs', String(200 * 1024 * 1024),
      '-c', 'copy',
      tempInput,
    ], { timeout: 120_000 });

    // Step 2: extract mono 16 kHz PCM WAV (Whisper-optimal format)
    await execFileAsync(ffmpegPath, [
      '-y',
      '-i', tempInput,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      tempOutput,
    ], { timeout: 60_000 });

    return tempOutput;
  } finally {
    unlink(tempInput).catch(() => undefined);
  }
}

// ─── OpenAI Whisper ───────────────────────────────────────────────────────────

async function transcribeWithOpenAI(audioPath: string): Promise<string> {
  const apiKey = getSetting('openai_api_key');
  if (!apiKey) throw new Error('openai_api_key not configured');

  // Multipart form-data upload — Node.js fetch with FormData
  const audioBuffer = await readFile(audioPath);

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Whisper error ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.text()).trim();
}

// ─── Ollama Whisper ───────────────────────────────────────────────────────────

async function transcribeWithOllama(audioPath: string): Promise<string> {
  const baseUrl = getSetting('ollama_base_url') || 'http://localhost:11434';
  const audioBuffer = await readFile(audioPath);
  const audioBase64 = audioBuffer.toString('base64');

  const res = await postJson(`${baseUrl}/api/generate`, {
    model: 'whisper',
    prompt: '[transcribe]',
    images: [audioBase64],
    stream: false,
  });

  if (!res.ok) throw new Error(`Ollama transcription error: ${res.body.slice(0, 200)}`);
  try {
    return (JSON.parse(res.body) as { response?: string }).response?.trim() ?? '';
  } catch {
    return res.body.trim();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  provider?: 'openai' | 'ollama';
  error?: string;
}

/** Transcribe audio from a direct video/audio URL. */
export async function transcribeUrl(url: string): Promise<TranscribeResult> {
  let audioPath: string | null = null;
  try {
    audioPath = await extractAudioFromUrl(url);

    // Try OpenAI first, then Ollama
    if (getSetting('openai_api_key')) {
      const text = await transcribeWithOpenAI(audioPath);
      return { ok: true, text, provider: 'openai' };
    }
    if (getSetting('ollama_base_url')) {
      const text = await transcribeWithOllama(audioPath);
      return { ok: true, text, provider: 'ollama' };
    }
    return { ok: false, error: 'لا يوجد مزود نسخ نصي مهيأ (openai_api_key أو ollama_base_url)' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    if (audioPath) unlink(audioPath).catch(() => undefined);
  }
}

/**
 * Transcribe the video attached to an article and append the transcript
 * to the article's content field.
 */
export async function transcribeArticleVideo(articleId: number): Promise<TranscribeResult> {
  const article = getArticle(articleId);
  if (!article) return { ok: false, error: 'Article not found' };

  const videoUrl = article.video_url || article.image_url;
  if (!videoUrl) return { ok: false, error: 'المقال لا يحتوي فيديو' };

  const result = await transcribeUrl(videoUrl);
  if (!result.ok || !result.text) return result;

  // Append transcript to content
  const transcript = `<p><strong>النص المستخرج من الفيديو (${result.provider}):</strong></p><p>${result.text}</p>`;
  const newContent = (article.content || '') + '\n\n' + transcript;

  getDb()
    .prepare(
      `UPDATE articles
       SET content=?, summary=CASE WHEN summary='' OR summary IS NULL THEN ? ELSE summary END,
           updated_at=datetime('now')
       WHERE id=?`
    )
    .run(newContent.slice(0, 200000), result.text.slice(0, 2000), articleId);

  return result;
}
