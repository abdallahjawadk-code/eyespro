/**
 * Unified fetch + extract + quality pipeline for articles and sources.
 */
import { fetchUrlGuarded } from '../net/guarded-fetch';
import { getText } from '../net/http';
import { isUrlFetchAllowedAsync } from '../security/fetch-guard';
import { pickCanonicalLink, resolveUrlChain, stripTrackingParams } from '../net/url-utils';
import { extractArticleBody, extractPageMeta } from './ingest-helpers';
import { extractLinksFromHtml, scanLink } from './link-scan';
import { getSetting } from './settings';
import { isRobotsAllowed } from './robots';
import { effectiveFetchMode, shouldForceBrowser, type FetchMode } from './domain-policy';
import { logFetchAudit } from './fetch-audit';
import { assessFetchedArticleTier, computePurityScore } from './post-fetch-quality';
import { deepCleanHtml, deepCleanText } from '../../shared/content-cleaner';
import { withRetry } from '../net/stealth-utils';
import { cleanHtmlPreservingFormatting } from '../../shared/html-cleaner';

export type FetchMethod = 'http' | 'browser' | 'skipped';

export interface ExtractedArticle {
  title: string;
  summary: string;
  content: string;
  image: string;
  author: string;
  publishedAt: string;
  canonicalUrl: string;
  lang: string;
  extractScore: number;
}

export interface FetchArticleResult {
  ok: boolean;
  originalUrl: string;
  finalUrl: string;
  redirectChain: string[];
  html?: string;
  extracted?: ExtractedArticle;
  method: FetchMethod;
  purityScore: number;
  warnings: string[];
  error?: string;
  auditId?: number;
}

function extractJsonLdBody(html: string): string {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const ld = JSON.parse(m[1]!) as Record<string, unknown>;
      const items = Array.isArray(ld['@graph']) ? (ld['@graph'] as Record<string, unknown>[]) : [ld];
      for (const item of items) {
        const type = String(item['@type'] ?? '').toLowerCase();
        if (!type.includes('article') && !type.includes('newsarticle')) continue;
        const body = item['articleBody'] ?? item['text'];
        if (typeof body === 'string' && body.trim().length > 100) {
          return cleanHtmlPreservingFormatting(deepCleanHtml(body));
        }
      }
    } catch { /* ignore */ }
  }
  return '';
}

function applyCleanRules(html: string, rulesJson: string | null | undefined): string {
  if (!rulesJson?.trim()) return html;
  try {
    const rules = JSON.parse(rulesJson) as { removeSelectors?: string[]; removeRegex?: string[] };
    let out = html;
    for (const sel of rules.removeSelectors ?? []) {
      if (!sel) continue;
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`<[^>]*class=["'][^"']*${esc}[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'gi'), '');
    }
    for (const rx of rules.removeRegex ?? []) {
      try { out = out.replace(new RegExp(rx, 'gi'), ''); } catch { /* skip */ }
    }
    return out;
  } catch {
    return html;
  }
}

export function extractArticleFromHtml(
  html: string,
  pageUrl: string,
  selector?: string,
  cleanRulesJson?: string | null
): ExtractedArticle {
  const cleanedHtml = applyCleanRules(html, cleanRulesJson);
  const meta = extractPageMeta(cleanedHtml, pageUrl);

  let content = '';
  let extractScore = 50;

  if (selector?.trim()) {
    const selEsc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = cleanedHtml.match(new RegExp(`<([a-z]+)[^>]*(?:id|class)=["'][^"']*${selEsc}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
    if (m?.[2] && m[2].replace(/<[^>]+>/g, '').trim().length > 80) {
      content = extractArticleBody(m[0]);
      extractScore = 85;
    }
  }

  if (!content || content.length < 120) {
    const jsonLd = extractJsonLdBody(cleanedHtml);
    if (jsonLd.length > content.length) {
      content = jsonLd;
      extractScore = 80;
    }
  }

  if (!content || content.length < 120) {
    const body = extractArticleBody(cleanedHtml);
    if (body.length > content.length) {
      content = body;
      extractScore = 70;
    }
  }

  const title = deepCleanText(meta.title || 'Untitled').slice(0, 500);
  const summary = deepCleanText(meta.description || content.replace(/<[^>]+>/g, ' ').slice(0, 400)).slice(0, 2000);

  return {
    title,
    summary,
    content,
    image: meta.image,
    author: meta.author,
    publishedAt: meta.publishedAt,
    canonicalUrl: pickCanonicalLink(pageUrl, meta.canonicalUrl),
    lang: meta.lang,
    extractScore
  };
}

async function securityScanUrl(url: string, context: 'ingest' | 'source'): Promise<boolean> {
  if (context === 'ingest' && getSetting('link_scan_before_ingest') !== '1') return true;
  if (context === 'source' && getSetting('link_scan_before_source_fetch') !== '1') return true;
  const report = scanLink(url);
  if (report.riskLevel === 'high') return false;
  return true;
}

export async function fetchPageHtml(
  url: string,
  opts?: { forceBrowser?: boolean; selector?: string; sourceId?: number; timeout?: number; skipAudit?: boolean }
): Promise<{ ok: boolean; html?: string; method: FetchMethod; status: number; error?: string; bytes: number }> {
  const started = Date.now();
  let host = '';
  try { host = new URL(url).hostname; } catch { return { ok: false, method: 'http', status: 0, error: 'Invalid URL', bytes: 0 }; }

  const forceBrowser = opts?.forceBrowser || shouldForceBrowser(host);
  const timeout = opts?.timeout ?? 20000;
  const res = await withRetry(
    () => fetchUrlGuarded(url, { forceBrowser, selector: opts?.selector, timeout }),
    { maxAttempts: 3, baseDelayMs: 1500 }
  );
  const bytes = res.body?.length ?? 0;
  const method: FetchMethod = forceBrowser ? 'browser' : 'http';

  if (!opts?.skipAudit) {
    logFetchAudit({
      sourceId: opts?.sourceId,
      url,
      finalUrl: url,
      method,
      statusCode: res.status,
      durationMs: Date.now() - started,
      bytesRead: bytes,
      ok: res.ok,
      error: res.ok ? undefined : res.body?.slice(0, 200)
    });
  }

  if (!res.ok) return { ok: false, method, status: res.status, error: res.body?.slice(0, 200), bytes };
  return { ok: true, html: res.body, method, status: res.status, bytes };
}

export async function fetchArticlePage(opts: {
  url: string;
  sourceId?: number;
  fetchMode?: FetchMode;
  selector?: string;
  cleanRulesJson?: string | null;
  skipQualityReject?: boolean;
  context?: 'ingest' | 'source';
}): Promise<FetchArticleResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const context = opts.context ?? 'ingest';

  let originalUrl = opts.url.trim();
  if (!/^https?:\/\//i.test(originalUrl)) originalUrl = `https://${originalUrl}`;

  if (!(await securityScanUrl(originalUrl, context))) {
    return { ok: false, originalUrl, finalUrl: originalUrl, redirectChain: [], method: 'skipped', purityScore: 0, warnings: ['link_blocked'], error: 'Link blocked by security scan' };
  }

  const robots = await isRobotsAllowed(originalUrl);
  if (!robots.allowed) {
    return { ok: false, originalUrl, finalUrl: originalUrl, redirectChain: [], method: 'skipped', purityScore: 0, warnings: ['robots_disallow'], error: robots.reason };
  }

  let finalUrl = originalUrl;
  let chain: string[] = [originalUrl];

  if (getSetting('fetch_expand_shorteners') !== '0') {
    const resolved = await resolveUrlChain(originalUrl);
    if (resolved.ok) {
      finalUrl = resolved.finalUrl;
      chain = resolved.chain;
    } else if (resolved.error) {
      warnings.push('resolve_partial');
    }
  } else {
    finalUrl = stripTrackingParams(originalUrl);
  }

  const mode = opts.fetchMode ?? effectiveFetchMode(new URL(finalUrl).hostname);
  if (mode === 'feed_only') {
    return { ok: false, originalUrl, finalUrl, redirectChain: chain, method: 'skipped', purityScore: 0, warnings: ['feed_only_mode'], error: 'Fetch mode is feed_only' };
  }

  const forceBrowser = mode === 'browser' || shouldForceBrowser(new URL(finalUrl).hostname);
  const page = await fetchPageHtml(finalUrl, { forceBrowser, selector: opts.selector, sourceId: opts.sourceId, skipAudit: true });

  if (!page.ok || !page.html) {
    const auditId = logFetchAudit({
      sourceId: opts.sourceId,
      url: originalUrl,
      finalUrl,
      method: page.method,
      statusCode: page.status,
      durationMs: Date.now() - started,
      bytesRead: page.bytes,
      ok: false,
      error: page.error,
      warnings
    });
    return { ok: false, originalUrl, finalUrl, redirectChain: chain, method: page.method, purityScore: 0, warnings, error: page.error, auditId };
  }

  const extracted = extractArticleFromHtml(page.html, finalUrl, opts.selector, opts.cleanRulesJson);
  for (const l of extractLinksFromHtml(page.html, 12)) {
    try {
      const r = scanLink(l);
      if (r.riskLevel === 'high') warnings.push(`suspicious_link:${new URL(l).hostname}`);
    } catch { /* ignore */ }
  }
  const purityScore = computePurityScore(extracted.content || extracted.summary);
  const quality = assessFetchedArticleTier({
    title: extracted.title,
    summary: extracted.summary,
    content: extracted.content
  });
  warnings.push(...quality.warnings);

  if (!opts.skipQualityReject && quality.tier === 'reject') {
    const auditId = logFetchAudit({
      sourceId: opts.sourceId,
      url: originalUrl,
      finalUrl: extracted.canonicalUrl || finalUrl,
      method: page.method,
      statusCode: page.status,
      durationMs: Date.now() - started,
      bytesRead: page.bytes,
      ok: false,
      error: quality.rejectReason,
      warnings
    });
    return {
      ok: false,
      originalUrl,
      finalUrl: extracted.canonicalUrl || finalUrl,
      redirectChain: chain,
      html: page.html,
      extracted,
      method: page.method,
      purityScore,
      warnings,
      error: quality.rejectReason,
      auditId
    };
  }

  const auditId = logFetchAudit({
    sourceId: opts.sourceId,
    url: originalUrl,
    finalUrl: extracted.canonicalUrl || finalUrl,
    method: page.method,
    statusCode: page.status,
    durationMs: Date.now() - started,
    bytesRead: page.bytes,
    ok: true,
    warnings
  });

  return {
    ok: true,
    originalUrl,
    finalUrl: extracted.canonicalUrl || finalUrl,
    redirectChain: chain,
    html: page.html,
    extracted,
    method: page.method,
    purityScore,
    warnings,
    auditId
  };
}

/** Allowed content types for article HTML fetch */
export function isAllowedContentType(ct: string | undefined): boolean {
  if (!ct) return true;
  const c = ct.toLowerCase();
  return (
    c.includes('text/html') ||
    c.includes('application/xhtml') ||
    c.includes('application/xml') ||
    c.includes('text/xml') ||
    c.includes('application/json')
  );
}

export async function headContentCheck(url: string): Promise<boolean> {
  try {
    const allowed = await isUrlFetchAllowedAsync(url);
    if (!allowed.ok) return false;
    const res = await getText(url, { Range: 'bytes=0-0' }, { maxBytes: 1024, redirectsLeft: 3, validateRedirect: isUrlFetchAllowedAsync });
    const ct = typeof res.headers?.['content-type'] === 'string' ? res.headers['content-type'] : '';
    return isAllowedContentType(ct);
  } catch {
    return true;
  }
}
