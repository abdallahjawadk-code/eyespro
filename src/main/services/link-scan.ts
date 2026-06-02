import { createHash } from 'node:crypto';
import { getDb } from '../db/database';
import { isUrlFetchAllowed } from '../security/fetch-guard';
import { sanitizeString } from '../security/sanitize';

const SUSPICIOUS_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top']);
const SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly']);

export interface LinkScanReport {
  ok: boolean;
  originalUrl: string;
  sanitizedUrl: string;
  urlHash: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  flags: string[];
  fromCache?: boolean;
}

function urlHash(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export function sanitizeLinkUrl(raw: string): { ok: boolean; sanitized: string; error?: string } {
  if (!raw?.trim()) return { ok: false, sanitized: '', error: 'Empty' };
  let u = raw.trim();
  if (/^(javascript|data|file):/i.test(u)) return { ok: false, sanitized: '', error: 'Blocked scheme' };
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  const guard = isUrlFetchAllowed(u);
  if (!guard.ok) return { ok: false, sanitized: '', error: guard.error };
  return { ok: true, sanitized: u };
}

export function scanLink(url: string): LinkScanReport {
  const clean = sanitizeLinkUrl(url);
  if (!clean.ok) {
    return {
      ok: false,
      originalUrl: url,
      sanitizedUrl: '',
      urlHash: urlHash(url),
      riskLevel: 'high',
      riskScore: 100,
      flags: ['invalid']
    };
  }
  const flags: string[] = [];
  let score = 0;
  try {
    const parsed = new URL(clean.sanitized);
    const tld = parsed.hostname.split('.').pop()?.toLowerCase() ?? '';
    if (SUSPICIOUS_TLDS.has(tld)) {
      flags.push('suspicious_tld');
      score += 40;
    }
    if (SHORTENERS.has(parsed.hostname.toLowerCase())) {
      flags.push('shortener');
      score += 25;
    }
    if (parsed.hostname.length > 60) {
      flags.push('long_host');
      score += 15;
    }
    const octets = parsed.hostname.split('.');
    const isIpv4 = octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o));
    if (isIpv4 || parsed.hostname.includes(':')) {
      flags.push('ip_host');
      score += 20;
    }
    if (parsed.hostname.startsWith('xn--') || /[^\x00-\x7F]/.test(parsed.hostname)) {
      flags.push('punycode_or_idn');
      score += 15;
    }
  } catch {
    score = 80;
    flags.push('parse_error');
  }
  const riskLevel = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  const hash = urlHash(clean.sanitized);
  const report: LinkScanReport = {
    ok: true,
    originalUrl: url,
    sanitizedUrl: clean.sanitized,
    urlHash: hash,
    riskLevel,
    riskScore: score,
    flags
  };
  persistScan(report);
  return report;
}

function persistScan(report: LinkScanReport): void {
  const json = JSON.stringify(report);
  const existing = getDb()
    .prepare(`SELECT id FROM link_scans WHERE url_hash=?`)
    .get(report.urlHash) as { id: number } | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE link_scans SET url=?, risk_level=?, risk_score=?, sanitized_url=?, report_json=?, scanned_at=datetime('now') WHERE id=?`
      )
      .run(report.sanitizedUrl, report.riskLevel, report.riskScore, report.sanitizedUrl, json, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO link_scans (url, url_hash, risk_level, risk_score, sanitized_url, report_json) VALUES (?,?,?,?,?,?)`
      )
      .run(
        sanitizeString(report.sanitizedUrl, 2048),
        report.urlHash,
        report.riskLevel,
        report.riskScore,
        report.sanitizedUrl,
        json
      );
  }
}

export function scanBatch(urls: string[]): LinkScanReport[] {
  return urls.slice(0, 30).map((u) => scanLink(u));
}

export function extractLinksFromHtml(html: string, limit = 30): string[] {
  const found = new Set<string>();
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    if (m[1].startsWith('http')) found.add(m[1]);
  }
  while ((m = urlRe.exec(html)) !== null) {
    found.add(m[0].replace(/[.,;:!?)]+$/, ''));
  }
  return [...found].slice(0, limit);
}

export function listScanHistory(limit = 50) {
  return getDb().prepare(`SELECT * FROM link_scans ORDER BY scanned_at DESC LIMIT ?`).all(limit);
}
