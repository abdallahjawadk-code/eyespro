import { scanLink } from './link-scan';
import { getSetting } from './settings';
import { sanitizeString } from '../security/sanitize';
import { createArticle, getArticle } from './articles';
import { getDb } from '../db/database';
import { tenantSqlClause } from './tenant';
import { fetchArticlePage } from './fetch-pipeline';
import { normalizeUrlForDedup } from '../net/url-utils';
import { assessFetchedArticleTier } from './post-fetch-quality';
import { linkFingerprint } from './link-provenance';

export { extractArticleBody, extractPageMeta } from './ingest-helpers';
export type { PageMeta } from './ingest-helpers';

export async function ingestUrl(url: string, selector?: string): Promise<{ ok: boolean; id?: number; error?: string }> {
  const u = sanitizeString(url, 2048);
  if (getSetting('link_scan_before_ingest') === '1') {
    const scan = scanLink(u);
    if (scan.riskLevel === 'high') return { ok: false, error: 'Link blocked by security scan' };
  }

  const norm = normalizeUrlForDedup(u);
  const tenant = tenantSqlClause();
  const dup = getDb()
    .prepare(`SELECT id FROM articles WHERE link=?${tenant.sql} LIMIT 1`)
    .get(norm, ...tenant.params) as { id: number } | undefined;
  if (dup) return { ok: false, error: 'DUPLICATE' };

  const fetched = await fetchArticlePage({
    url: u,
    selector,
    fetchMode: 'always',
    context: 'ingest',
    skipQualityReject: false
  });

  if (!fetched.ok || !fetched.extracted) {
    return { ok: false, error: fetched.error ?? 'Fetch failed' };
  }

  const ex = fetched.extracted;
  const tier = assessFetchedArticleTier({
    title: ex.title,
    summary: ex.summary,
    content: ex.content
  });
  if (tier.tier === 'reject') {
    return { ok: false, error: tier.rejectReason ?? 'Quality gate rejected content' };
  }

  const articleLink = ex.canonicalUrl || fetched.finalUrl;
  const id = createArticle({
    title: ex.title,
    summary: ex.summary,
    content: ex.content,
    link: articleLink,
    image_url: ex.image || null,
    source: (() => { try { return new URL(fetched.finalUrl).hostname; } catch { return null; } })(),
    status: tier.tier === 'review' ? 'pending' : 'pending',
    ingest_status: 'ingested',
    published_at: ex.publishedAt || null,
    original_url: fetched.originalUrl,
    final_url: fetched.finalUrl,
    redirect_chain_json: JSON.stringify(fetched.redirectChain),
    fetch_method: fetched.method,
    purity_score: fetched.purityScore ?? tier.purityScore,
    fetch_warnings_json: fetched.warnings.length ? JSON.stringify(fetched.warnings) : null,
    quality_tier: tier.tier,
    link_fingerprint: linkFingerprint(articleLink)
  });

  return { ok: true, id };
}

export function checkDuplicate(link: string): boolean {
  const u = normalizeUrlForDedup(sanitizeString(link, 2048));
  const tenant = tenantSqlClause();
  const row = getDb()
    .prepare(`SELECT id FROM articles WHERE link=?${tenant.sql} LIMIT 1`)
    .get(u, ...tenant.params);
  return !!row;
}

export function getArticleSummary(id: number) {
  const a = getArticle(id);
  if (!a) return null;
  return { id: a.id, title: a.title, link: a.link, status: a.status };
}
