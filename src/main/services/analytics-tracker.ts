/**
 * Feature 13 — External Analytics Integration
 *
 * Sends article view / publish events to:
 *   1. Google Analytics 4 via Measurement Protocol
 *   2. Meta (Facebook) Pixel via Conversions API
 *
 * Also pulls back article-level data from GA4 Data API when configured.
 *
 * Settings keys used:
 *   ga4_measurement_id    — G-XXXXXXXXXX
 *   ga4_api_secret        — MP API secret from GA4 admin
 *   ga4_property_id       — numeric property ID (for Data API)
 *   ga4_credentials_json  — service account JSON for Data API
 *   meta_pixel_id         — Facebook Pixel ID
 *   meta_access_token     — Meta Conversions API token
 */

import { getSetting } from './settings';
import { postJson } from '../net/http';
import { recordMetric } from './analytics';
import { getDb } from '../db/database';
import { randomUUID } from 'crypto';

// ─── GA4 Measurement Protocol ─────────────────────────────────────────────────

interface GA4Event {
  name:   string;
  params: Record<string, string | number | boolean>;
}

async function sendGA4Event(events: GA4Event[]): Promise<boolean> {
  const measurementId = getSetting('ga4_measurement_id');
  const apiSecret     = getSetting('ga4_api_secret');
  if (!measurementId || !apiSecret) return false;

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;
  const payload = {
    client_id: 'eyespro-server',
    events,
  };

  const res = await postJson(url, payload);
  return res.ok || res.status === 204;
}

/** Track that an article was published to a platform. */
export async function trackPublishEvent(
  articleId: number,
  platform:  string,
  postUrl?:  string | null,
): Promise<void> {
  const row = getDb()
    .prepare(`SELECT title, source, word_count FROM articles WHERE id=?`)
    .get(articleId) as { title: string; source: string | null; word_count: number | null } | undefined;
  if (!row) return;

  const events: GA4Event[] = [{
    name: 'article_publish',
    params: {
      article_id:  String(articleId),
      article_title: row.title.slice(0, 100),
      platform,
      source:      row.source ?? 'unknown',
      word_count:  row.word_count ?? 0,
      post_url:    postUrl ?? '',
    },
  }];

  await Promise.allSettled([
    sendGA4Event(events),
    sendMetaEvent('Publish', { article_id: articleId, platform }),
  ]);
}

/** Track article page view (useful when articles are also on a website). */
export async function trackPageView(articleId: number, pageUrl: string): Promise<void> {
  const row = getDb()
    .prepare(`SELECT title FROM articles WHERE id=?`)
    .get(articleId) as { title: string } | undefined;
  if (!row) return;

  await sendGA4Event([{
    name: 'page_view',
    params: { page_location: pageUrl, page_title: row.title.slice(0, 100) },
  }]);
}

// ─── GA4 Data API (pull metrics back) ────────────────────────────────────────

export interface ArticleGA4Metrics {
  pageViews:       number;
  uniqueUsers:     number;
  avgSessionSec:   number;
  bounceRate:      number;
}

export async function fetchGA4Metrics(pageUrl: string): Promise<ArticleGA4Metrics | null> {
  const propertyId  = getSetting('ga4_property_id');
  const credentials = getSetting('ga4_credentials_json');
  if (!propertyId || !credentials) return null;

  // Use GA4 Data API v1beta (requires service account OAuth2)
  // This is a simplified version — full OAuth2 flow omitted for brevity;
  // credentials should be a pre-obtained access token for this integration.
  const accessToken = credentials; // treat as Bearer token if pre-obtained

  const body = {
    dateRanges:  [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions:  [{ name: 'pagePath' }],
    metrics:     [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
    ],
    dimensionFilter: {
      filter: {
        fieldName:    'pagePath',
        stringFilter: { matchType: 'CONTAINS', value: pageUrl },
      },
    },
    limit: 1,
  };

  try {
    const res = await postJson(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      body,
      { Authorization: `Bearer ${accessToken}` }
    );
    if (!res.ok) return null;
    const data = JSON.parse(res.body) as { rows?: { metricValues: { value: string }[] }[] };
    const row = data.rows?.[0];
    if (!row) return null;
    return {
      pageViews:     parseInt(row.metricValues[0]?.value ?? '0', 10),
      uniqueUsers:   parseInt(row.metricValues[1]?.value ?? '0', 10),
      avgSessionSec: parseFloat(row.metricValues[2]?.value ?? '0'),
      bounceRate:    parseFloat(row.metricValues[3]?.value ?? '0'),
    };
  } catch {
    return null;
  }
}

// ─── Meta Conversions API ─────────────────────────────────────────────────────

async function sendMetaEvent(eventName: string, data: Record<string, unknown>): Promise<void> {
  const pixelId     = getSetting('meta_pixel_id');
  const accessToken = getSetting('meta_access_token');
  if (!pixelId || !accessToken) return;

  await postJson(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
    {
      data: [{
        event_name:  eventName,
        event_time:  Math.floor(Date.now() / 1000),
        event_id:    randomUUID(),
        action_source: 'website',
        custom_data:   data,
      }],
    }
  ).catch(() => undefined);
}

// ─── Sync helper — pull GA4 metrics for recently published articles ───────────

export async function syncRecentArticleMetrics(limit = 10): Promise<number> {
  type Row = { id: number; link: string | null };
  const rows = getDb()
    .prepare(
      `SELECT id, link FROM articles
       WHERE status='published' AND link IS NOT NULL
       ORDER BY published_at DESC LIMIT ?`
    )
    .all(limit) as Row[];

  let synced = 0;
  for (const row of rows) {
    if (!row.link) continue;
    try {
      const metrics = await fetchGA4Metrics(row.link);
      if (metrics) {
        recordMetric(row.id, 'ga4', 'page_views',  metrics.pageViews);
        recordMetric(row.id, 'ga4', 'unique_users', metrics.uniqueUsers);
        recordMetric(row.id, 'ga4', 'avg_session',  Math.round(metrics.avgSessionSec));
        synced++;
      }
    } catch { /* non-fatal */ }
  }
  return synced;
}
