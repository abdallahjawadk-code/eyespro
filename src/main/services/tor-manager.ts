import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { exec, spawn, ChildProcess } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import net from 'node:net';
import { createLogger } from '../logger';
import { getSetting } from './settings';

const log = createLogger('tor-manager');

let torProcess: ChildProcess | null = null;
let activeSocksPort = 9050;
let activeControlPort = 9051;
let torStatus: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped';
let lastBootstrapMsg = '';

const TOR_VERSION = '14.0.1';
const TOR_URL = `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-windows-x86_64-${TOR_VERSION}.tar.gz`;

function getBinDir(): string {
  const dir = join(app.getPath('userData'), 'bin');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTorDir(): string {
  return join(getBinDir(), 'tor');
}

/** Recursively look for tor.exe in a folder */
function findTorExecutable(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      const found = findTorExecutable(fullPath);
      if (found) return found;
    } else if (file.toLowerCase() === 'tor.exe') {
      return fullPath;
    }
  }
  return null;
}

export function getTorExePath(): string | null {
  return findTorExecutable(getTorDir());
}

/** Check if SOCKS port is active */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

/** Try to verify if the port has an active Tor controller */
function testExistingTorController(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.write('AUTHENTICATE ""\r\n');
    });
    socket.setTimeout(2000);

    socket.on('data', (data) => {
      const resp = data.toString();
      if (resp.startsWith('250')) {
        resolve(true);
      } else {
        resolve(false);
      }
      socket.destroy();
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Asynchronously download Tor Expert Bundle */
function downloadTor(): Promise<string> {
  const torDir = getTorDir();
  if (!existsSync(torDir)) mkdirSync(torDir, { recursive: true });
  const tarPath = join(getBinDir(), 'tor-expert-bundle.tar.gz');

  log.info(`Downloading Tor Expert Bundle from: ${TOR_URL}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tarPath);
    const request = https.get(TOR_URL, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(tarPath);
          });
        }).on('error', (err) => {
          fs.unlinkSync(tarPath);
          reject(err);
        });
        return;
      }

      if (response.statusCode !== 200) {
        fs.unlinkSync(tarPath);
        reject(new Error(`Failed to download Tor: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tarPath);
      });
    });

    request.on('error', (err) => {
      fs.unlinkSync(tarPath);
      reject(err);
    });
  });
}

/** Extract Tor Expert Bundle archive using native Windows tar */
function extractTor(tarPath: string): Promise<void> {
  const torDir = getTorDir();
  return new Promise((resolve, reject) => {
    const cmd = `tar -zxf "${tarPath}" -C "${torDir}"`;
    log.info(`Extracting Tor archive: ${cmd}`);
    exec(cmd, (err) => {
      if (err) {
        reject(err);
      } else {
        try {
          fs.unlinkSync(tarPath); // clean tar file
        } catch {}
        resolve();
      }
    });
  });
}

/** Initialize/install Tor Expert Bundle if missing */
export async function setupTorIfNeeded(): Promise<boolean> {
  const exe = getTorExePath();
  if (exe && existsSync(exe)) {
    log.info(`Tor executable verified at: ${exe}`);
    return true;
  }

  log.warn('Tor executable missing, starting installation…');
  torStatus = 'starting';
  lastBootstrapMsg = 'جاري تنزيل ملفات نظام Tor مجاناً لتجاوز الحجب...';

  try {
    const tarPath = await downloadTor();
    lastBootstrapMsg = 'جاري فك ضغط وتثبيت ملفات Tor...';
    await extractTor(tarPath);
    log.info('Tor installed successfully.');
    return true;
  } catch (err) {
    torStatus = 'error';
    const msg = (err as Error).message;
    log.error('Tor setup failed:', { error: msg });
    lastBootstrapMsg = `فشل تثبيت Tor تلقائياً: ${msg}. تأكد من اتصال الإنترنت أو استخدام VPN.`;
    return false;
  }
}

/** Start the Tor background process */
export async function startTor(): Promise<boolean> {
  if (getSetting('tor_enabled') !== 'true') {
    log.info('Tor routing is disabled in settings. Skipping launch.');
    return false;
  }

  if (torProcess) {
    log.info('Tor process is already running.');
    return true;
  }

  torStatus = 'starting';
  lastBootstrapMsg = 'جاري فحص توافر منافذ الشبكة لـ Tor...';

  // Check port availability for SOCKS5
  let socksPort = 9050;
  let controlPort = 9051;
  let portSearchCount = 0;

  while (portSearchCount < 5) {
    const socksInUse = await isPortInUse(socksPort);
    const ctrlInUse = await isPortInUse(controlPort);

    if (!socksInUse && !ctrlInUse) {
      break; // ports are free
    }

    if (socksInUse || ctrlInUse) {
      log.info(`Ports ${socksPort}/${controlPort} occupied. Testing if existing Tor controller is running.`);
      const isTorController = await testExistingTorController(controlPort);
      if (isTorController) {
        log.info(`Existing Tor controller detected on port ${controlPort}. Reusing existing Tor proxy.`);
        activeSocksPort = socksPort;
        activeControlPort = controlPort;
        torStatus = 'ready';
        lastBootstrapMsg = 'متصل بمحرك Tor نشط بالفعل على النظام';
        return true;
      }
    }

    socksPort += 10;
    controlPort += 10;
    portSearchCount++;
  }

  activeSocksPort = socksPort;
  activeControlPort = controlPort;

  // Install if needed
  const isInstalled = await setupTorIfNeeded();
  if (!isInstalled) return false;

  const exe = getTorExePath();
  if (!exe) {
    torStatus = 'error';
    lastBootstrapMsg = 'فشل العثور على ملف tor.exe بعد التثبيت';
    return false;
  }

  const dataDir = join(getTorDir(), 'data_dir');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const args = [
    '--SocksPort', `127.0.0.1:${socksPort}`,
    '--ControlPort', `127.0.0.1:${controlPort}`,
    '--CookieAuthentication', '0',
    '--DataDirectory', dataDir,
  ];

  log.info(`Launching Tor daemon: ${exe} ${args.join(' ')}`);

  return new Promise((resolve) => {
    let resolved = false;

    torProcess = spawn(exe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    torProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      log.debug(`[Tor Output] ${text.trim()}`);
      if (text.includes('Bootstrapped 100%')) {
        log.info('Tor bootstrapped successfully!');
        torStatus = 'ready';
        lastBootstrapMsg = 'جاهز ومتصل بالشبكة بنسبة 100%';
        if (!resolved) {
          resolved = true;
          resolve(true);
        }
      } else {
        const match = /Bootstrapped\s+(\d+)%/.exec(text);
        if (match) {
          lastBootstrapMsg = `جاري الاتصال الآمن بالشبكة: ${match[1]}%`;
        }
      }
    });

    torProcess.stderr?.on('data', (data) => {
      log.warn(`[Tor Error Output] ${data.toString().trim()}`);
    });

    torProcess.on('error', (err) => {
      log.error('Tor spawn error:', { error: err.message });
      torStatus = 'error';
      lastBootstrapMsg = `خطأ في تشغيل خادم تور: ${err.message}`;
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    torProcess.on('exit', (code) => {
      log.info(`Tor process exited with code ${code}`);
      torProcess = null;
      torStatus = 'stopped';
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    // Safety timeout: resolve false if it takes more than 40 seconds to bootstrap
    setTimeout(() => {
      if (!resolved) {
        log.warn('Tor bootstrapping timed out (40s)');
        if (torStatus !== 'ready') torStatus = 'error';
        resolved = true;
        resolve(torStatus === 'ready');
      }
    }, 40000);
  });
}

/** Stop the Tor daemon process */
export function stopTor(): void {
  if (torProcess) {
    log.info('Terminating Tor process…');
    torProcess.kill();
    torProcess = null;
    torStatus = 'stopped';
  }
}

/** Command Tor to rotate its IP identity */
export function rotateTorIp(): Promise<boolean> {
  return new Promise((resolve) => {
    if (torStatus !== 'ready') {
      log.warn('Tor is not ready. Skipping IP rotation.');
      resolve(false);
      return;
    }

    log.info(`Requesting Tor IP rotation (NEWNYM) on Control Port ${activeControlPort}…`);
    const socket = net.connect({ port: activeControlPort, host: '127.0.0.1' }, () => {
      socket.write('AUTHENTICATE ""\r\n');
    });

    let step = 0;
    socket.on('data', (data) => {
      const resp = data.toString();
      if (step === 0) {
        if (resp.startsWith('250')) {
          step = 1;
          socket.write('SIGNAL NEWNYM\r\n');
        } else {
          socket.destroy();
          resolve(false);
        }
      } else if (step === 1) {
        if (resp.startsWith('250')) {
          log.info('Tor IP rotation command successfully acknowledged.');
          resolve(true);
        } else {
          resolve(false);
        }
        socket.destroy();
      }
    });

    socket.on('error', (err) => {
      log.error('Tor IP rotation socket error:', { error: err.message });
      resolve(false);
    });
  });
}

/** Check current Tor status and details */
export function getTorStatus() {
  return {
    status: torStatus,
    bootstrap: lastBootstrapMsg,
    socksPort: activeSocksPort,
    controlPort: activeControlPort,
    enabled: getSetting('tor_enabled') === 'true'
  };
}

export function getTorSocksPort(): number {
  return activeSocksPort;
}

export function isTorActive(): boolean {
  return torStatus === 'ready';
}
