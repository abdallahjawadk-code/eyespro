import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function resolvePreloadPath(): string {
  const candidates = ['index.mjs', 'index.js', 'index.cjs'];
  for (const name of candidates) {
    const p = join(__dirname, '../preload', name);
    if (existsSync(p)) return p;
  }
  return join(__dirname, '../preload/index.mjs');
}

export function createMainWindow(): BrowserWindow {
  const isDev = !app.isPackaged;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0a0b10',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  win.on('ready-to-show', () => win.show());

  if (isDev) {
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return;
      console.error('[EyesPro] Page failed to load:', code, desc, url);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
    isDev
      ? "connect-src 'self' http://localhost:* ws://localhost:*"
      : "connect-src 'self'",
    "media-src 'self' blob: eyesmedia:",
    "object-src 'none'",
    "frame-src 'self' data: about:",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "navigate-to 'none'"
  ];

  const cspHeader = cspDirectives.join('; ');

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // Only modify HTML responses
    const contentType = details.responseHeaders?.['content-type']?.[0] || '';
    if (contentType.includes('text/html')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [cspHeader],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'X-XSS-Protection': ['1; mode=block'],
          'Referrer-Policy': ['no-referrer'],
          'Permissions-Policy': ['camera=(), microphone=(), geolocation=(), payment=(), usb=()']
        }
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
