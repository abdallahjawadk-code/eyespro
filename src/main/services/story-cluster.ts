/**
 * Feature 2 — Cross-source Story Clustering
 *
 * Groups articles covering the same story from different sources into clusters.
 * Uses a combination of SimHash similarity + shared tags + publication time window.
 *
 * Useful for: comparing coverage, spotting redundancy, building "all angles" views.
 */

import { getDb } from '../db/database';
import { hammingDistance } from './dedup';
import { tenantSqlClause } from './tenant';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClusterArticle {
  id:          number;
  title:       string;
  source:      string | null;
  publishedAt: string | null;
  link:        string | null;
  tags:        string[];
  simhash:     number | null;
}

export interface StoryCluster {
  id:           string;      // synthetic: "cluster-<leadId>"
  headline:     string;      // title of the lead (earliest/most complete) article
  articleCount: number;
  sources:      string[];
  articles:     ClusterArticle[];
  dateRange:    { from: string | null; to: string | null };
  commonTags:   string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function tagOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  return b.filter((t) => setA.has(t)).length;
}

function areSameStory(a: ClusterArticle, b: ClusterArticle, hashThreshold = 6, tagThreshold = 2): boolean {
  // SimHash similarity
  if (a.simhash != null && b.simhash != null) {
    if (hammingDistance(a.simhash >>> 0, b.simhash >>> 0) <= hashThreshold) return true;
  }
  // Tag overlap
  if (tagOverlap(a.tags, b.tags) >= tagThreshold) return true;
  return false;
}

// ─── Clustering algorithm (union-find) ───────────────────────────────────────

function buildClusters(articles: ClusterArticle[]): ClusterArticle[][] {
  const parent = articles.map((_, i) => i);

  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  }
  function union(i: number, j: number): void {
    parent[find(i)] = find(j);
  }

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      if (areSameStory(articles[i]!, articles[j]!)) union(i, j);
    }
  }

  const groups = new Map<number, ClusterArticle[]>();
  for (let i = 0; i < articles.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(articles[i]!);
  }

  return [...groups.values()].filter((g) => g.length >= 2); // only multi-source clusters
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find story clusters among articles published within `days` days.
 * Only returns clusters that have articles from at least 2 different sources.
 *
 * @param days       Look-back window (default 7)
 * @param minSources Minimum distinct sources per cluster (default 2)
 */
export function clusterArticles(days = 7, minSources = 2): StoryCluster[] {
  const tenant = tenantSqlClause();
  type Row = {
    id: number; title: string; source: string | null;
    published_at: string | null; link: string | null;
    tags: string | null; simhash: number | null;
  };

  const rows = getDb()
    .prepare(
      `SELECT id, title, source, published_at, link, tags, simhash
       FROM articles
       WHERE created_at >= datetime('now', ?)${tenant.sql}
       ORDER BY published_at ASC`
    )
    .all(`-${days} days`, ...tenant.params) as Row[];

  const articles: ClusterArticle[] = rows.map((r) => ({
    id:          r.id,
    title:       r.title,
    source:      r.source,
    publishedAt: r.published_at,
    link:        r.link,
    tags:        parseTags(r.tags),
    simhash:     r.simhash,
  }));

  const groups = buildClusters(articles);

  return groups
    .map((group, idx): StoryCluster => {
      const sources = [...new Set(group.map((a) => a.source).filter(Boolean) as string[])];
      if (sources.length < minSources) return null as unknown as StoryCluster;

      const dates = group.map((a) => a.publishedAt).filter(Boolean) as string[];
      dates.sort();

      // Common tags across all articles in the cluster
      const tagCounts = new Map<string, number>();
      for (const a of group) {
        for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
      const commonTags = [...tagCounts.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t]) => t);

      const lead = group[0]!;
      return {
        id:           `cluster-${lead.id}-${idx}`,
        headline:     lead.title,
        articleCount: group.length,
        sources,
        articles:     group,
        dateRange:    { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
        commonTags,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.articleCount - a.articleCount);
}

/** Get a single cluster by its lead article ID. */
export function getClusterByArticleId(articleId: number, days = 7): StoryCluster | null {
  const clusters = clusterArticles(days, 1);
  return clusters.find((c) => c.articles.some((a) => a.id === articleId)) ?? null;
}
