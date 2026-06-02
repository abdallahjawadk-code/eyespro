const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

export function isUrlFetchAllowed(url: string): { ok: boolean; error?: string } {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { ok: false, error: 'INVALID_SCHEME' };
    }
    if (BLOCKED_HOSTS.has(u.hostname.toLowerCase())) {
      return { ok: false, error: 'PRIVATE_HOST' };
    }
    const parts = u.hostname.split('.').map(Number);
    if (parts[0] === 10) return { ok: false, error: 'PRIVATE_IP' };
    if (parts[0] === 192 && parts[1] === 168) return { ok: false, error: 'PRIVATE_IP' };
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { ok: false, error: 'PRIVATE_IP' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }
}
