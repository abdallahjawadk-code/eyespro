import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { defaultFetchHeaders, getPoliteUserAgent } from './polite-http';
import { getSetting } from '../services/settings';
import { isTorActive, getTorSocksPort } from '../services/tor-manager';

// ─── SOCKS5 Tunneling for Tor ───────────────────────────────────────────────

function connectSocks5(
  socksHost: string,
  socksPort: number,
  targetHost: string,
  targetPort: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socksPort, socksHost);
    socket.setTimeout(15000);

    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    socket.once('error', onError);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SOCKS5 connection timeout'));
    });

    socket.once('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    let step = 0;
    socket.on('data', (chunk) => {
      if (step === 0) {
        if (chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          socket.destroy();
          reject(new Error(`SOCKS5 authentication failed: ${chunk.toString('hex')}`));
          return;
        }
        step = 1;
        const domainBuf = Buffer.from(targetHost);
        const requestBuf = Buffer.alloc(4 + 1 + domainBuf.length + 2);
        requestBuf[0] = 0x05;
        requestBuf[1] = 0x01;
        requestBuf[2] = 0x00;
        requestBuf[3] = 0x03;
        requestBuf[4] = domainBuf.length;
        domainBuf.copy(requestBuf, 5);
        requestBuf.writeUInt16BE(targetPort, 5 + domainBuf.length);

        socket.write(requestBuf);
      } else if (step === 1) {
        if (chunk[1] !== 0x00) {
          socket.destroy();
          reject(new Error(`SOCKS5 connection failed with status: ${chunk[1]}`));
          return;
        }
        socket.removeAllListeners('data');
        socket.removeListener('error', onError);
        resolve(socket);
      }
    });
  });
}

export function connectSocks5Agent(socksHost: string, socksPort: number): https.Agent {
  const agent = new https.Agent({ keepAlive: false });
  const createConnection = (
    options: { host?: string; port?: number; servername?: string },
    cb: (err: Error | null, sock?: net.Socket) => void
  ): void => {
    const targetHost = options.host ?? '';
    const targetPort = options.port ?? 443;
    connectSocks5(socksHost, socksPort, targetHost, targetPort)
      .then((socksSock) => {
        const tlsSock = tls.connect(
          { socket: socksSock, servername: options.servername ?? targetHost },
          () => { cb(null, tlsSock); }
        );
        tlsSock.once('error', (e) => cb(e));
      })
      .catch((err) => cb(err));
  };
  (agent as any).createConnection = createConnection;
  return agent;
}

function connectSocks5HttpAgent(socksHost: string, socksPort: number): http.Agent {
  const agent = new http.Agent({ keepAlive: false });
  const createConnection = (
    options: { host?: string; port?: number },
    cb: (err: Error | null, sock?: net.Socket) => void
  ): void => {
    const targetHost = options.host ?? '';
    const targetPort = options.port ?? 80;
    connectSocks5(socksHost, socksPort, targetHost, targetPort)
      .then((socksSock) => {
        cb(null, socksSock);
      })
      .catch((err) => cb(err));
  };
  (agent as any).createConnection = createConnection;
  return agent;
}

// ─── Custom (residential) proxy — self-contained, no external dependency ─────
interface ParsedProxy { host: string; port: number; username?: string; password?: string; }

/** Parse the user's custom proxy setting (`host:port` or `http://user:pass@host:port`). */
function parseCustomProxy(): ParsedProxy | null {
  const raw = (getSetting('custom_proxy') || '').trim();
  if (!raw) return null;
  const withScheme = /^\w+:\/\//.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    const port = parseInt(u.port, 10);
    if (!u.hostname || isNaN(port) || port <= 0 || port >= 65536) return null;
    return {
      host: u.hostname,
      port,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch { return null; }
}

function proxyAuthHeader(p: ParsedProxy): string | undefined {
  if (!p.username) return undefined;
  return 'Basic ' + Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64');
}

/**
 * Build an https.Agent that reaches the target by opening an HTTP CONNECT tunnel
 * through the proxy, then negotiating TLS over that tunnel — the standard way to
 * proxy HTTPS without any third-party library. createConnection is assigned via
 * a cast so we don't fight the base Agent's synchronous-return signature.
 */
function connectTunnelAgent(proxy: ParsedProxy): https.Agent {
  const agent = new https.Agent({ keepAlive: false });
  const auth = proxyAuthHeader(proxy);

  const createConnection = (
    options: { host?: string; port?: number; servername?: string },
    cb: (err: Error | null, sock?: net.Socket) => void
  ): void => {
    const targetHost = options.host ?? '';
    const targetPort = options.port ?? 443;
    let settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; proxySocket.destroy(); cb(e); } };

    const proxySocket = net.connect(proxy.port, proxy.host);
    proxySocket.setTimeout(20_000, () => fail(new Error('proxy CONNECT timeout')));
    proxySocket.once('error', fail);
    proxySocket.once('connect', () => {
      let head = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (auth) head += `Proxy-Authorization: ${auth}\r\n`;
      head += 'Connection: keep-alive\r\n\r\n';
      proxySocket.write(head);
    });

    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.indexOf('\r\n\r\n') === -1) return;
      proxySocket.removeListener('data', onData);
      const statusLine = buf.slice(0, buf.indexOf('\r\n')).toString('latin1');
      if (!/^HTTP\/\d\.\d 200/.test(statusLine)) { fail(new Error(`proxy CONNECT failed: ${statusLine}`)); return; }
      proxySocket.setTimeout(0);
      proxySocket.removeListener('error', fail);
      const tlsSock = tls.connect(
        { socket: proxySocket, servername: options.servername ?? targetHost },
        () => { settled = true; cb(null, tlsSock); }
      );
      tlsSock.once('error', (e) => { if (!settled) { settled = true; cb(e); } });
    };
    proxySocket.on('data', onData);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (agent as any).createConnection = createConnection;
  return agent;
}

function decodeBody(res: http.IncomingMessage, chunks: Buffer[]): string {
  const raw = Buffer.concat(chunks);
  const enc = (res.headers['content-encoding'] ?? '').toLowerCase();
  let buf: Buffer;
  try {
    if (enc === 'gzip' || enc === 'x-gzip') buf = zlib.gunzipSync(raw);
    else if (enc === 'deflate') buf = zlib.inflateSync(raw);
    else if (enc === 'br') buf = zlib.brotliDecompressSync(raw);
    else buf = raw;
  } catch { buf = raw; }
  const ct = res.headers['content-type'] ?? '';
  const charset = ct.match(/charset=([^\s;]+)/i)?.[1]?.toLowerCase().replace('iso-8859-1', 'latin1') ?? 'utf8';
  try { return buf.toString(charset as BufferEncoding); } catch { return buf.toString('utf8'); }
}

export interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
  headers?: Record<string, string | string[]>;
  /** Set when redirectsLeft is 0 and server returned a redirect */
  redirectTo?: string;
  /** True when server responded 304 Not Modified */
  notModified?: boolean;
  finalUrl?: string;
  permanentRedirectUrl?: string;
}

export interface HttpRequestOptions {
  maxBytes?: number;
  redirectsLeft?: number;
  /** Request timeout in milliseconds. Default: 30 000 ms. For AI calls use 180 000+. */
  timeout?: number;
  validateRedirect?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Route this request through the user's custom (residential) proxy when one is
   * configured in Settings. Enable for content fetching (RSS, sites, news);
   * leave off for AI/publishing so their tokens stay on a direct connection.
   */
  useProxy?: boolean;
}

const DEFAULT_MAX_BYTES = Number(process.env.EYESPRO_MAX_FETCH_BYTES || '') || 6_291_456; // 6 MB

function request(
  url: string,
  method: 'GET' | 'HEAD' | 'POST' | 'DELETE',
  body?: string,
  headers: Record<string, string> = {},
  opts: HttpRequestOptions = {}
): Promise<HttpResult> {
  const redirectsLeft = opts.redirectsLeft ?? 5;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const isHead = method === 'HEAD';

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;

    // Route through the user's custom proxy when requested. HTTPS tunnels via a
    // CONNECT agent; plain HTTP rewrites the request to the proxy with an
    // absolute-URI path. AI/publishing calls leave useProxy unset → direct.
    const proxy = opts.useProxy ? parseCustomProxy() : null;
    let reqHostname = u.hostname;
    let reqPort: string | number = u.port || (isHttps ? 443 : 80);
    let reqPath = u.pathname + u.search;
    const reqHeaders: Record<string, string | number> = { ...headers };
    let agent: https.Agent | http.Agent | undefined;

    const isLocalhost = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    const useTor = opts.useProxy && isTorActive() && !isLocalhost && !proxy;

    if (useTor) {
      const torPort = getTorSocksPort();
      agent = isHttps 
        ? connectSocks5Agent('127.0.0.1', torPort) 
        : connectSocks5HttpAgent('127.0.0.1', torPort);
    } else if (proxy) {
      if (isHttps) {
        agent = connectTunnelAgent(proxy);
      } else {
        reqHostname = proxy.host;
        reqPort = proxy.port;
        reqPath = url; // absolute URI for an HTTP proxy GET
        reqHeaders['Host'] = u.host;
        const auth = proxyAuthHeader(proxy);
        if (auth) reqHeaders['Proxy-Authorization'] = auth;
      }
    }

    const req = lib.request(
      {
        hostname: reqHostname,
        port: reqPort,
        path: reqPath,
        method,
        timeout: opts.timeout ?? 30_000,
        ...(agent ? { agent } : {}),
        headers: body
          ? {
              'Content-Length': Buffer.byteLength(body),
              ...reqHeaders
            }
          : reqHeaders
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status === 304) {
          res.resume();
          resolve({
            ok: true,
            status: 304,
            body: '',
            notModified: true,
            headers: res.headers as Record<string, string | string[]>,
            finalUrl: url
          });
          return;
        }
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          const redirectUrl = new URL(res.headers.location, url).toString();
          const isPermanent = status === 301 || status === 308;
          if (redirectsLeft <= 0) {
            resolve({
              ok: false,
              status,
              body: '',
              redirectTo: redirectUrl,
              headers: res.headers as Record<string, string | string[]>,
              permanentRedirectUrl: isPermanent ? redirectUrl : undefined,
              finalUrl: url
            });
            return;
          }
          void (async () => {
            if (opts.validateRedirect) {
              const v = await opts.validateRedirect(redirectUrl);
              if (!v.ok) {
                resolve({ ok: false, status, body: v.error ?? 'Redirect blocked' });
                return;
              }
            }
            const redirectMethod = status === 303 ? 'GET' : method;
            const redirectBody = status === 303 ? undefined : body;
            request(redirectUrl, redirectMethod as 'GET' | 'HEAD' | 'POST' | 'DELETE', redirectBody, headers, {
              ...opts,
              redirectsLeft: redirectsLeft - 1
            })
              .then((innerRes) => {
                if (isPermanent && !innerRes.permanentRedirectUrl) {
                  innerRes.permanentRedirectUrl = redirectUrl;
                }
                resolve(innerRes);
              })
              .catch(reject);
          })();
          return;
        }
        if (isHead) {
          res.resume();
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: '',
            headers: res.headers as Record<string, string | string[]>,
            finalUrl: url
          });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer | string) => {
          const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
          total += buf.length;
          if (total > maxBytes) {
            req.destroy(new Error(`Response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(buf);
        });
        res.on('end', () => {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: decodeBody(res, chunks),
            headers: res.headers as Record<string, string | string[]>,
            finalUrl: url
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

export function getText(
  url: string,
  headers: Record<string, string> = {},
  opts: HttpRequestOptions = {}
): Promise<HttpResult> {
  return request(url, 'GET', undefined, defaultFetchHeaders(headers), opts);
}

export function headRequest(
  url: string,
  headers: Record<string, string> = {},
  opts: HttpRequestOptions = {}
): Promise<HttpResult> {
  return request(url, 'HEAD', undefined, defaultFetchHeaders(headers), opts);
}

export function postJson(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
  opts: HttpRequestOptions = {}
): Promise<HttpResult> {
  const data = JSON.stringify(payload);
  return request(url, 'POST', data, {
    'Content-Type': 'application/json',
    'User-Agent': getPoliteUserAgent(),
    ...headers
  }, opts);
}

export function deleteRequest(
  url: string,
  headers: Record<string, string> = {},
  opts: HttpRequestOptions = {}
): Promise<HttpResult> {
  return request(url, 'DELETE', undefined, {
    'User-Agent': getPoliteUserAgent(),
    ...headers
  }, opts);
}

export function postForm(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<HttpResult> {
  const data = new URLSearchParams(form).toString();
  return request(url, 'POST', data, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': getPoliteUserAgent(),
    ...headers
  }, {});
}

const BINARY_RESPONSE_MAX = 2 * 1024 * 1024; // 2 MB — API responses are small JSON

function binaryRequest(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH',
  buf: Buffer,
  headers: Record<string, string>,
  timeoutMs = 60_000
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        timeout: timeoutMs,
        headers: { 'Content-Length': buf.length, 'User-Agent': getPoliteUserAgent(), ...headers }
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer | string) => {
          const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
          total += b.length;
          if (total > BINARY_RESPONSE_MAX) {
            req.destroy(new Error(`Binary response exceeds ${BINARY_RESPONSE_MAX} bytes`));
            return;
          }
          chunks.push(b);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Binary request timed out')); });
    req.write(buf);
    req.end();
  });
}

/** POST raw binary (no Content-Type — Meta rupload expects bare bytes) */
export function postRawBody(
  url: string,
  buf: Buffer,
  headers: Record<string, string> = {},
  timeoutMs = 60_000,
): Promise<HttpResult> {
  return binaryRequest(url, 'POST', buf, headers, timeoutMs);
}

/** POST raw binary buffer (for media/video uploads) */
export function postBuffer(
  url: string,
  buf: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
  timeoutMs = 60_000,
): Promise<HttpResult> {
  return binaryRequest(url, 'POST', buf, { 'Content-Type': contentType, ...headers }, timeoutMs);
}

/** PUT raw binary buffer (for resumable upload sessions) */
export function putBuffer(url: string, buf: Buffer, contentType: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return binaryRequest(url, 'PUT', buf, { 'Content-Type': contentType, ...headers });
}

/** Stream a readable (e.g. fs.createReadStream) to a URL via PUT */
export function putStream(
  url: string,
  stream: Readable,
  contentLength: number,
  contentType: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength,
          'User-Agent': getPoliteUserAgent(),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: data });
        });
      }
    );
    req.on('error', reject);
    stream.pipe(req);
  });
}
