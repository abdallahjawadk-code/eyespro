/**
 * Voice speech-to-text for the assistant. Two engines:
 *   - cloud  : the user's own Whisper-capable provider (OpenAI whisper-1 or Groq
 *              whisper-large-v3). Audio goes to the provider the USER chose — not
 *              to us, no third party. Best Arabic accuracy.
 *   - local  : whisper.cpp (auto-downloaded + self-updating) — fully offline, the
 *              audio never leaves the device.
 *
 * `stt_engine` setting: 'auto' (local if ready, else cloud) | 'local' | 'cloud'.
 * No telemetry, no data retention beyond a temp file that is deleted immediately.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { getSetting } from './settings';
import { resolveFfmpeg } from './media-tools';
import { localWhisperReady, transcribeLocal } from './whisper-manager';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../logger';

const execFileAsync = promisify(execFile);
const log = createLogger('voice-stt');

export interface SttResult { ok: boolean; text?: string; engine?: 'local' | 'cloud'; error?: string }

function tmpDir(): string { return join(app.getPath('temp'), 'eyespro-stt'); }

/** Convert any recorded audio to 16 kHz mono WAV (what whisper.cpp expects). */
async function toWav16k(inputPath: string): Promise<string> {
  const out = `${inputPath}.16k.wav`;
  await execFileAsync(resolveFfmpeg(), ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], { timeout: 60_000 });
  return out;
}

/** Cloud Whisper via the user's OpenAI/Groq key (OpenAI-compatible multipart API). */
async function transcribeCloud(audioPath: string, mime: string, lang: string): Promise<string> {
  const openaiKey = getSetting('openai_api_key');
  const groqKey = getSetting('groq_api_key');
  const provider = openaiKey ? 'openai' : groqKey ? 'groq' : null;
  if (!provider) throw new Error('no_cloud_whisper_key');
  const url = provider === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions' : 'https://api.groq.com/openai/v1/audio/transcriptions';
  const model = provider === 'openai' ? 'whisper-1' : 'whisper-large-v3';
  const key = provider === 'openai' ? openaiKey : groqKey;

  const buf = await readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'audio.webm');
  form.append('model', model);
  form.append('response_format', 'text');
  if (lang) form.append('language', lang);

  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`cloud whisper ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.text()).trim();
}

/**
 * Transcribe a recorded audio buffer. Routes to local/cloud per the engine
 * setting, with graceful fallback (auto: local first, then cloud).
 */
export async function transcribeVoice(buffer: Buffer, mime: string, lang = 'ar'): Promise<SttResult> {
  const engine = (getSetting('stt_engine') || 'auto').toLowerCase();
  await mkdir(tmpDir(), { recursive: true });
  const ext = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
  const inPath = join(tmpDir(), `rec_${Date.now()}.${ext}`);
  await writeFile(inPath, buffer);
  const cleanup: string[] = [inPath];

  try {
    const tryLocal = async (): Promise<string> => {
      const wav = await toWav16k(inPath); cleanup.push(wav);
      return transcribeLocal(wav, lang);
    };

    if (engine === 'local') return { ok: true, text: await tryLocal(), engine: 'local' };
    if (engine === 'cloud') return { ok: true, text: await transcribeCloud(inPath, mime, lang), engine: 'cloud' };

    // auto — prefer local when ready, else cloud
    if (await localWhisperReady()) {
      try { return { ok: true, text: await tryLocal(), engine: 'local' }; }
      catch (e) { log.warn('local stt failed, trying cloud', { error: (e as Error).message }); }
    }
    return { ok: true, text: await transcribeCloud(inPath, mime, lang), engine: 'cloud' };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'no_cloud_whisper_key') return { ok: false, error: 'لا يوجد محرّك تحويل صوتي جاهز. فعّل Whisper المحلّي أو أدخل مفتاح OpenAI/Groq.' };
    return { ok: false, error: msg };
  } finally {
    for (const f of cleanup) unlink(f).catch(() => undefined);
  }
}
