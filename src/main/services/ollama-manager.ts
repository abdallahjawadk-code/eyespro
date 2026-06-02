import { app, shell } from 'electron';
import { type ChildProcess, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getText } from '../net/http';
import { getSetting, setSetting } from './settings';
import { createLogger } from '../logger';

const log = createLogger('ollama');

let managedProcess: ChildProcess | null = null;
let weStartedProcess = false;

/** Curated models — downloaded from registry.ollama.ai when user pulls */
export const RECOMMENDED_OLLAMA_MODELS = [
  { name: 'llama3.2', label: 'Llama 3.2', sizeHint: '~2 GB', note: 'عام، سريع' },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', sizeHint: '~2 GB', note: 'أخف للأجهزة الضعيفة' },
  { name: 'qwen2.5:7b', label: 'Qwen 2.5 7B', sizeHint: '~4.7 GB', note: 'ممتاز للعربية' },
  { name: 'qwen2.5:3b', label: 'Qwen 2.5 3B', sizeHint: '~2 GB', note: 'عربي، خفيف' },
  { name: 'gemma2:9b', label: 'Gemma 2 9B', sizeHint: '~5.5 GB', note: 'جودة عالية' },
  { name: 'mistral', label: 'Mistral 7B', sizeHint: '~4.1 GB', note: 'صياغة إخبارية' },
] as const;

export type OllamaStatus = {
  enabled: boolean;
  binaryFound: boolean;
  binaryPath: string | null;
  running: boolean;
  weStarted: boolean;
  manageProcess: boolean;
  baseUrl: string;
  modelsDir: string;
  homeDir: string;
};

export function isBuiltinOllamaEnabled(): boolean {
  return getSetting('ollama_builtin_enabled') === '1';
}

export function getOllamaHomeDir(): string {
  return path.join(app.getPath('userData'), 'ollama-home');
}

export function getOllamaModelsDir(): string {
  const dir = path.join(getOllamaHomeDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getManagedOllamaBaseUrl(): string {
  const custom = (getSetting('ollama_base_url') || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  const host = (getSetting('ollama_host') || '127.0.0.1').trim();
  const port = (getSetting('ollama_port') || '11434').trim();
  return `http://${host}:${port}`;
}

function ollamaHostEnv(): string {
  const url = getManagedOllamaBaseUrl().replace(/^https?:\/\//, '');
  return url.includes(':') ? url : `${url}:11434`;
}

function ollamaChildEnv(): NodeJS.ProcessEnv {
  const home = getOllamaHomeDir();
  fs.mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    OLLAMA_MODELS: getOllamaModelsDir(),
    OLLAMA_HOST: ollamaHostEnv(),
    OLLAMA_HOME: home,
  };
}

/** Locate ollama.exe / ollama binary (system install). */
export function findOllamaExecutable(): string | null {
  const custom = (getSetting('ollama_binary_path') || '').trim();
  if (custom && fs.existsSync(custom)) return custom;

  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Ollama', 'ollama.exe'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    try {
      const out = execSync('where ollama', { encoding: 'utf8', timeout: 8000 }).trim();
      const first = out.split(/\r?\n/).find((l) => l.trim().endsWith('.exe') || l.includes('ollama'));
      if (first && fs.existsSync(first.trim())) return first.trim();
    } catch { /* not on PATH */ }
  } else {
    try {
      const out = execSync('which ollama', { encoding: 'utf8', timeout: 5000 }).trim();
      if (out && fs.existsSync(out)) return out;
    } catch { /* */ }
    for (const c of ['/usr/local/bin/ollama', '/usr/bin/ollama']) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

export async function isOllamaApiReachable(): Promise<boolean> {
  try {
    const res = await getText(`${getManagedOllamaBaseUrl()}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const enabled = isBuiltinOllamaEnabled();
  const binaryPath = findOllamaExecutable();
  const running = await isOllamaApiReachable();
  return {
    enabled,
    binaryFound: Boolean(binaryPath),
    binaryPath,
    running,
    weStarted: weStartedProcess,
    manageProcess: getSetting('ollama_manage_process') !== '0',
    baseUrl: getManagedOllamaBaseUrl(),
    modelsDir: getOllamaModelsDir(),
    homeDir: getOllamaHomeDir(),
  };
}

export async function startManagedOllama(): Promise<{ ok: boolean; error?: string }> {
  if (await isOllamaApiReachable()) return { ok: true };

  const bin = findOllamaExecutable();
  if (!bin) {
    return { ok: false, error: 'OLLAMA_NOT_INSTALLED' };
  }

  if (managedProcess && !managedProcess.killed) {
    return { ok: true };
  }

  const env = ollamaChildEnv();
  log.info('Starting Ollama serve', { bin, host: env.OLLAMA_HOST });

  managedProcess = spawn(bin, ['serve'], {
    env,
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  weStartedProcess = true;

  managedProcess.on('error', (err) => {
    log.error('Ollama process error', { error: err.message });
  });
  managedProcess.on('exit', (code) => {
    log.info('Ollama process exited', { code });
    managedProcess = null;
    weStartedProcess = false;
  });

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isOllamaApiReachable()) return { ok: true };
  }
  return { ok: false, error: 'OLLAMA_START_TIMEOUT' };
}

export function stopManagedOllama(): void {
  if (managedProcess && weStartedProcess && !managedProcess.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(managedProcess.pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
      } else {
        managedProcess.kill('SIGTERM');
      }
    } catch { /* */ }
  }
  managedProcess = null;
  weStartedProcess = false;
}

export async function setBuiltinOllamaEnabled(
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  setSetting('ollama_builtin_enabled', enabled ? '1' : '0');
  setSetting('ai_allow_local_ollama', enabled ? '1' : '0');
  if (enabled) {
    setSetting('ai_provider', 'ollama');
    if (getSetting('ollama_manage_process') !== '0') {
      return startManagedOllama();
    }
    if (!(await isOllamaApiReachable())) {
      return { ok: false, error: 'OLLAMA_NOT_RUNNING' };
    }
  } else {
    stopManagedOllama();
  }
  return { ok: true };
}

export async function listLocalOllamaModels(): Promise<{ name: string; size?: number }[]> {
  if (!(await isOllamaApiReachable())) return [];
  const res = await getText(`${getManagedOllamaBaseUrl()}/api/tags`);
  if (!res.ok) return [];
  const data = JSON.parse(res.body) as { models?: { name: string; size?: number }[] };
  return data.models ?? [];
}

export async function deleteLocalModel(name: string): Promise<{ ok: boolean; error?: string }> {
  const bin = findOllamaExecutable();
  if (!bin) return { ok: false, error: 'OLLAMA_NOT_INSTALLED' };
  return new Promise((resolve) => {
    const proc = spawn(bin, ['rm', name], { env: ollamaChildEnv(), shell: process.platform === 'win32' });
    proc.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: 'DELETE_FAILED' }));
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

export type PullProgress = { model: string; line: string; done?: boolean; error?: string };

export function pullOllamaModel(
  model: string,
  onProgress?: (p: PullProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const bin = findOllamaExecutable();
    if (!bin) {
      resolve({ ok: false, error: 'OLLAMA_NOT_INSTALLED' });
      return;
    }
    const env = ollamaChildEnv();
    const proc = spawn(bin, ['pull', model], {
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const emit = (line: string) => onProgress?.({ model, line: line.trim() });
    proc.stdout?.on('data', (d) => emit(String(d)));
    proc.stderr?.on('data', (d) => emit(String(d)));
    proc.on('close', (code) => {
      if (code === 0) {
        onProgress?.({ model, line: 'done', done: true });
        resolve({ ok: true });
      } else {
        onProgress?.({ model, line: 'failed', done: true, error: 'PULL_FAILED' });
        resolve({ ok: false, error: 'PULL_FAILED' });
      }
    });
    proc.on('error', (e) => {
      onProgress?.({ model, line: e.message, done: true, error: e.message });
      resolve({ ok: false, error: e.message });
    });
  });
}

export async function openOllamaDownloadPage(): Promise<void> {
  await shell.openExternal('https://ollama.com/download');
}

export type WingetInstallProgress = {
  phase: 'starting' | 'downloading' | 'installing' | 'done' | 'error';
  message: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  done?: boolean;
  error?: string;
};

function parseByteSize(num: string, unit: string): number {
  const n = parseFloat(num.replace(/,/g, ''));
  const u = unit.toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return n * (mult[u] ?? 1);
}

function parseWingetChunk(
  chunk: string,
  state: { lastBytes: number; lastTime: number }
): WingetInstallProgress | null {
  const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let best: WingetInstallProgress | null = null;

  for (const line of lines) {
    let phase: WingetInstallProgress['phase'] = 'downloading';
    if (/successfully installed|installation successful|تم التثبيت/i.test(line)) phase = 'done';
    else if (/installing|installer|تم التنفيذ/i.test(line)) phase = 'installing';
    else if (/downloading|جاري التنزيل/i.test(line)) phase = 'downloading';
    else if (/found ollama|starting package/i.test(line)) phase = 'starting';

    let percent: number | undefined;
    let downloadedBytes: number | undefined;
    let totalBytes: number | undefined;

    const pct = line.match(/(\d{1,3})\s*%/);
    if (pct) percent = Math.min(100, parseInt(pct[1], 10));

    const bytesMatch = line.match(
      /([\d,.]+)\s*(KB|MB|GB|TB|B)\s*\/\s*([\d,.]+)\s*(KB|MB|GB|TB|B)/i
    );
    if (bytesMatch) {
      downloadedBytes = parseByteSize(bytesMatch[1], bytesMatch[2]);
      totalBytes = parseByteSize(bytesMatch[3], bytesMatch[4]);
      if (totalBytes > 0) percent = Math.round((downloadedBytes / totalBytes) * 100);
    }

    let speedBps: number | undefined;
    const now = Date.now();
    if (downloadedBytes !== undefined && state.lastBytes > 0 && now > state.lastTime + 80) {
      const dt = (now - state.lastTime) / 1000;
      if (dt > 0.05) speedBps = Math.max(0, (downloadedBytes - state.lastBytes) / dt);
    }
    if (downloadedBytes !== undefined) {
      state.lastBytes = downloadedBytes;
      state.lastTime = now;
    }

    best = {
      phase,
      message: line,
      percent,
      downloadedBytes,
      totalBytes,
      speedBps,
    };
  }
  return best;
}

/** Try silent install via winget (Windows). User may see UAC. */
export function installOllamaViaWinget(
  onProgress?: (p: WingetInstallProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'PLATFORM_UNSUPPORTED' });
  }
  return new Promise((resolve) => {
    const speedState = { lastBytes: 0, lastTime: Date.now() };
    const emit = (p: WingetInstallProgress) => onProgress?.(p);

    emit({ phase: 'starting', message: 'بدء التثبيت عبر winget…', percent: 0 });

    const proc = spawn(
      'winget',
      [
        'install',
        '-e',
        '--id',
        'Ollama.Ollama',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity',
      ],
      { shell: true, windowsHide: true }
    );

    let err = '';
    const handleData = (d: Buffer | string) => {
      const text = String(d);
      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
        err += text;
      }
      const parsed = parseWingetChunk(text, speedState);
      if (parsed) emit(parsed);
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    proc.on('close', (code) => {
      const installed = code === 0 || Boolean(findOllamaExecutable());
      if (installed) {
        emit({
          phase: 'done',
          message: 'اكتمل تثبيت Ollama',
          percent: 100,
          done: true,
        });
        resolve({ ok: true });
      } else {
        const msg = err.trim() || `winget exit ${code}`;
        emit({ phase: 'error', message: msg, done: true, error: msg });
        resolve({ ok: false, error: msg });
      }
    });
    proc.on('error', (e) => {
      emit({ phase: 'error', message: e.message, done: true, error: e.message });
      resolve({ ok: false, error: e.message });
    });
  });
}

/** Start Ollama on app launch if user enabled built-in AI. */
export async function initBuiltinOllamaOnStartup(): Promise<void> {
  if (!isBuiltinOllamaEnabled()) return;
  if (getSetting('ollama_manage_process') === '0') return;
  const r = await startManagedOllama();
  if (!r.ok) log.warn('Builtin Ollama did not start at launch', { error: r.error });
}

export function shutdownBuiltinOllama(): void {
  stopManagedOllama();
}
