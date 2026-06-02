/**
 * Unified source search — multi-provider orchestration with staged metadata.
 */
import { getDb } from '../../db/database';
import { fetchUrlGuarded } from '../../net/guarded-fetch';
import { discoverSourceCandidates, scoreFeedCandidate } from '../source-discovery';
import type {
  FeedSearchResult,
  SearchProviderId,
  SearchStage,
  SourceSearchOptions,
  SourceSearchResponse,
} from './types';
import { regionPreset, REGION_PRESETS } from './regions';
import { getCatalog, listCatalogs } from './catalog-registry';
import { expandSearchTerms, isNewsHeavyQuery, itemMatchesTopicTerms } from './topic-expansion';
import { applySectorProviders, detectSector } from './topics';
import { discoveryCacheKey } from './discovery-cache';
import { recordProviderFail, recordProviderSuccess } from './provider-stats';
import { runRsshub } from './providers/rsshub';
import { runReddit } from './providers/reddit';
import { runOpenAlex } from './providers/openalex';
import { runPodcastIndex } from './providers/podcast-index';
import { runYoutubeCatalog } from './providers/youtube-catalog';

export { listCatalogs, getCatalog, SOURCE_CATALOGS } from './catalog-registry';
export { REGION_PRESETS } from './regions';
export { listSectors, detectSector } from './topics';
export { clearDiscoveryCache } from './discovery-cache';
export { getSimilarFeeds } from './similar-feeds';
export { suggestCatalogSource, listSuggestions } from './community-catalog';
export { listProviderStats } from './provider-stats';
export type { FeedSearchResult, SourceSearchOptions, SourceSearchResponse, SearchStage } from './types';

const DEFAULT_PROVIDERS: Record<SearchProviderId, boolean> = {
  feedly: true,
  google_news: true,
  ai: true,
  catalog: true,
  official: true,
  telegram: false,
  rsshub: true,
  reddit: true,
  podcast: true,
  openalex: true,
  youtube: true,
};

async function discoverSiteFeed(siteUrl: string, siteName: string): Promise<FeedSearchResult | null> {
  try {
    const r = await discoverSourceCandidates(siteUrl, { mode: 'fast', skipBrowser: true, skipProbes: true });
    if (!r.ok || !r.best) return null;
    const b = r.best;
    return {
      title: r.title || siteName,
      feedUrl: b.feedUrl,
      website: siteUrl,
      type: b.type,
      score: b.score,
    };
  } catch {
    return null;
  }
}

async function scoreFeedFreshness(feedUrl: string): Promise<number> {
  const scored = await scoreFeedCandidate({
    feedUrl,
    type: 'rss',
    method: 'direct',
    confidence: 75,
    score: 75,
    label: 'freshness',
  });
  return scored.score;
}

function stage(
  id: SearchStage['id'],
  label: string,
  status: SearchStage['status'],
  count: number,
  ms: number,
  error?: string
): SearchStage {
  return { id, label, status, count, ms, error };
}

async function runFeedly(
  q: string,
  add: (r: FeedSearchResult) => void,
  locale: string
): Promise<number> {
  let n = 0;
  const feedlyUrl = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(q)}&count=40&locale=${locale.startsWith('ar') ? 'ar' : 'en'}`;
  const res = await fetchUrlGuarded(feedlyUrl);
  if (!res.ok || !res.body.includes('"results"')) return 0;
  type FeedlyItem = {
    feedId?: string;
    title?: string;
    description?: string;
    subscribers?: number;
    website?: string;
  };
  const data = JSON.parse(res.body) as { results?: FeedlyItem[] };
  const scoreTasks: Promise<void>[] = [];
  for (const r of data.results ?? []) {
    if (!r.feedId?.startsWith('feed/')) continue;
    const feedUrl = r.feedId.slice(5);
    try {
      new URL(feedUrl);
    } catch {
      continue;
    }
    const item: FeedSearchResult = {
      title: r.title || new URL(feedUrl).hostname,
      feedUrl,
      website: r.website,
      description: r.description?.slice(0, 220),
      subscribers: r.subscribers,
      type: 'rss',
      provider: 'feedly',
    };
    add(item);
    n++;
    scoreTasks.push(scoreFeedFreshness(feedUrl).then((s) => {
      item.score = s;
    }));
  }
  await Promise.allSettled(scoreTasks);
  return n;
}

async function runGoogleNews(
  q: string,
  add: (r: FeedSearchResult) => void,
  region: ReturnType<typeof regionPreset>,
  knownUrls: Set<string>
): Promise<number> {
  let n = 0;
  const gnUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${region.hl}&gl=${region.gl}&ceid=${region.ceid}&num=30`;
  const gnRes = await fetchUrlGuarded(gnUrl);
  if (!gnRes.ok) return 0;
  const sourceRe = /<source\s+url=["']([^"']+)["'][^>]*>([^<]+)<\/source>/gi;
  const seenOrigins = new Set<string>();
  const tasks: Promise<FeedSearchResult | null>[] = [];
  let m: RegExpExecArray | null;
  while ((m = sourceRe.exec(gnRes.body)) !== null && tasks.length < 20) {
    const siteUrl = m[1].trim();
    const siteName = m[2].trim();
    try {
      const origin = new URL(siteUrl).origin;
      if (seenOrigins.has(origin) || knownUrls.has(origin)) continue;
      seenOrigins.add(origin);
      tasks.push(
        discoverSiteFeed(origin, siteName).then((r) =>
          r ? { ...r, provider: 'google_news' as const } : null
        )
      );
    } catch {
      /* skip */
    }
  }
  const settled = await Promise.allSettled(tasks);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) {
      add(r.value);
      n++;
    }
  }
  return n;
}

async function runAi(
  q: string,
  add: (r: FeedSearchResult) => void,
  existingNames: string
): Promise<number> {
  let n = 0;
  const { runAiPrompt } = await import('../ai');
  const prompt = `أنت خبير في اكتشاف مصادر RSS والمحتوى الرقمي.
اقترح 12 مصدراً متنوعاً (مواقع، مدونات، صحف، قنوات يوتيوب، بودكاست) ذات صلة بموضوع: "${q}".
المعايير:
- تنوع المصادر: عربية ودولية، رسمية وشعبية
- تغطية كاملة: أخبار، تحليل، فيديو، صوت، مدونات متخصصة
- يفضل المصادر التي لها RSS feed معروف
- تجنب تكرار هذه المصادر: ${existingNames || 'لا يوجد'}
أعد JSON فقط بدون أي شرح إضافي:
[{"name":"اسم المصدر","url":"https://...","type":"rss|youtube|podcast","language":"ar|en"}]`;
  const raw = await runAiPrompt(prompt);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return 0;
  const items = JSON.parse(jsonMatch[0]) as { name?: string; url?: string; type?: string; language?: string }[];
  const tasks: Promise<void>[] = [];
  for (const item of items.slice(0, 10)) {
    if (!item.url) continue;
    let siteUrl = item.url.trim();
    if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;
    try {
      new URL(siteUrl);
    } catch {
      continue;
    }
    tasks.push(
      discoverSiteFeed(siteUrl, item.name ?? siteUrl).then((discovered) => {
        if (!discovered) return;
        add({
          ...discovered,
          title: item.name ?? discovered.title,
          provider: 'ai',
          score: discovered.score ?? 55,
        });
        n++;
      })
    );
  }
  await Promise.allSettled(tasks);
  return n;
}

function runCatalog(
  q: string,
  catalogId: string | undefined,
  add: (r: FeedSearchResult) => void
): number {
  let n = 0;
  const terms = expandSearchTerms(q);
  const catalogs = catalogId ? [getCatalog(catalogId)].filter(Boolean) : listCatalogs();
  for (const cat of catalogs) {
    if (!cat) continue;
    for (const item of cat.items) {
      const hay = `${item.name} ${item.website} ${(item.tags ?? []).join(' ')} ${cat.name} ${cat.description} ${cat.id}`;
      if (terms.length > 0 && !itemMatchesTopicTerms(hay, item.tags, terms)) continue;
      if (item.feedUrl) {
        add({
          title: item.name,
          feedUrl: item.feedUrl,
          website: item.website,
          type: item.type ?? 'rss',
          score: 72,
          provider: 'catalog',
          category: cat.id,
          language: cat.language,
        });
        n++;
      } else {
        add({
          title: item.name,
          feedUrl: item.website,
          website: item.website,
          type: 'rss',
          score: 40,
          provider: 'catalog',
          category: cat.id,
          language: cat.language,
          description: 'سيتم اكتشاف الخلاصة عند الإضافة',
        });
        n++;
      }
    }
  }
  return n;
}

const OFFICIAL_SITES: Array<{ name: string; website: string; tags: string[] }> = [
  // وكالات رسمية
  { name: 'واس السعودية',      website: 'https://www.spa.gov.sa',         tags: ['official', 'saudi', 'news'] },
  { name: 'وام الإماراتية',    website: 'https://www.wam.ae',              tags: ['official', 'uae', 'news'] },
  { name: 'KUNA الكويت',        website: 'https://www.kuna.net.kw',         tags: ['official', 'kuwait', 'news'] },
  { name: 'QNA قطر',            website: 'https://www.qna.org.qa',          tags: ['official', 'qatar', 'news'] },
  { name: 'MENA مصر',           website: 'https://www.mena.org.eg',         tags: ['official', 'egypt', 'news'] },
  // قنوات إخبارية عربية
  { name: 'الجزيرة',            website: 'https://www.aljazeera.net',       tags: ['news', 'arabic'] },
  { name: 'العربية',            website: 'https://www.alarabiya.net',       tags: ['news', 'arabic'] },
  { name: 'سكاي نيوز عربية',    website: 'https://www.skynewsarabia.com',   tags: ['news', 'arabic'] },
  { name: 'روسيا اليوم عربي',   website: 'https://arabic.rt.com',           tags: ['news', 'arabic'] },
  { name: 'فرانس 24 عربي',      website: 'https://www.france24.com/ar',     tags: ['news', 'arabic'] },
  { name: 'DW عربي',             website: 'https://www.dw.com/ar',           tags: ['news', 'arabic'] },
  // دولية
  { name: 'BBC Arabic',          website: 'https://www.bbc.com/arabic',     tags: ['news', 'arabic'] },
  { name: 'Reuters',             website: 'https://www.reuters.com',         tags: ['wire', 'english'] },
  { name: 'AP News',             website: 'https://apnews.com',              tags: ['wire', 'english'] },
  { name: 'Bloomberg',           website: 'https://www.bloomberg.com',       tags: ['finance', 'english'] },
  { name: 'TechCrunch',          website: 'https://techcrunch.com',          tags: ['tech', 'english'] },
  { name: 'The Guardian',        website: 'https://www.theguardian.com',     tags: ['news', 'english'] },
];

async function runOfficial(q: string, terms: string[], add: (r: FeedSearchResult) => void): Promise<number> {
  if (!isNewsHeavyQuery(q, terms)) return 0;
  let n = 0;
  const tasks: Promise<void>[] = [];
  for (const site of OFFICIAL_SITES) {
    const hay = `${site.name} ${site.website} ${site.tags.join(' ')}`;
    if (terms.length > 0 && !itemMatchesTopicTerms(hay, site.tags, terms)) continue;
    tasks.push(
      discoverSiteFeed(site.website, site.name).then((d) => {
        if (!d) return;
        add({ ...d, provider: 'official', score: Math.max(d.score ?? 0, 65) });
        n++;
      })
    );
  }
  await Promise.allSettled(tasks);
  return n;
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Provider ${name} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function runProviderStage(
  id: SearchProviderId,
  label: string,
  enabled: boolean,
  stages: SearchStage[],
  fn: () => Promise<number>
): Promise<void> {
  if (!enabled) {
    stages.push(stage(id, label, 'skipped', 0, 0));
    return;
  }
  const t0 = Date.now();
  try {
    const count = await withTimeout(fn(), 15000, label);
    recordProviderSuccess(id, count);
    stages.push(stage(id, label, 'done', count, Date.now() - t0));
  } catch (e) {
    recordProviderFail(id, String(e));
    stages.push(stage(id, label, 'error', 0, Date.now() - t0, String(e)));
  }
}

export async function searchSourcesAdvanced(opts: SourceSearchOptions): Promise<SourceSearchResponse> {
  const q = opts.query.trim();
  if (!q && !opts.catalogId) return { ok: false, error: 'أدخل موضوعاً للبحث' };

  const sector = detectSector(q, opts.sector);
  let providers = applySectorProviders({ ...DEFAULT_PROVIDERS }, sector);
  providers = { ...providers, ...opts.providers };
  const region = regionPreset(opts.region);
  const limit = Math.min(Math.max(opts.limit ?? 40, 5), 80);
  const stages: SearchStage[] = [];
  const key = discoveryCacheKey({ ...opts, sector });

  const cached = getDb()
    .prepare(`SELECT results_json, created_at FROM source_discovery_cache WHERE query_hash=?`)
    .get(key) as { results_json: string; created_at: string } | undefined;
  if (cached) {
    const age = Date.now() - new Date(cached.created_at).getTime();
    if (age < 12 * 3600_000) {
      try {
        const results = JSON.parse(cached.results_json) as FeedSearchResult[];
        if (results.length > 0) {
          return {
            ok: true,
            results,
            cached: true,
            stages: [stage('rank', 'من الذاكرة المؤقتة', 'done', results.length, 0)],
          };
        }
      } catch {
        /* refresh */
      }
    }
  }

  const knownUrls = new Set(
    (getDb().prepare(`SELECT url FROM sources WHERE url IS NOT NULL`).all() as { url: string }[]).map(
      (r) => r.url
    )
  );
  const allResults: FeedSearchResult[] = [];
  const seenFeeds = new Set<string>();

  function addResult(r: FeedSearchResult) {
    if (!r.feedUrl) return;
    try {
      new URL(r.feedUrl);
    } catch {
      return;
    }
    if (seenFeeds.has(r.feedUrl) || knownUrls.has(r.feedUrl)) return;
    seenFeeds.add(r.feedUrl);
    allResults.push(r);
  }

  const existingNames = (
    getDb().prepare(`SELECT name FROM sources ORDER BY id DESC LIMIT 12`).all() as { name: string }[]
  )
    .map((r) => r.name)
    .join(', ');

  const locale = region.hl;
  const searchTerms = expandSearchTerms(q);

  await Promise.all([
    runProviderStage('catalog', 'كتالوج', providers.catalog, stages, async () =>
      runCatalog(q, opts.catalogId, addResult)
    ),

    runProviderStage('feedly', 'Feedly', providers.feedly, stages, async () => {
      let count = 0;
      const feedlyLocales = locale.startsWith('ar') ? ['ar', 'en'] : ['en', 'ar'];
      for (const term of searchTerms.slice(0, 4)) {
        for (const loc of feedlyLocales) {
          count += await runFeedly(term, addResult, loc);
        }
      }
      return count;
    }),

    runProviderStage('google_news', 'Google News + Bing', providers.google_news, stages, async () => {
      let count = 0;
      for (const term of searchTerms.slice(0, 3)) {
        count += await runGoogleNews(term, addResult, region, knownUrls);
      }
      if (count < 6 && opts.region !== 'GLOBAL_EN') {
        const enRegion = REGION_PRESETS.GLOBAL_EN;
        for (const term of searchTerms.slice(0, 2)) {
          count += await runGoogleNews(term, addResult, enRegion, knownUrls);
        }
      }
      // Bing News RSS (free, no key)
      for (const term of searchTerms.slice(0, 2)) {
        try {
          const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(term)}&format=rss&mkt=${region.hl}-${region.gl}`;
          const bingRes = await fetchUrlGuarded(bingUrl);
          if (bingRes.ok) {
            const linkRe = /<link>([^<]+)<\/link>/gi;
            const seenOrigins = new Set<string>();
            const tasks: Promise<void>[] = [];
            let bm: RegExpExecArray | null;
            while ((bm = linkRe.exec(bingRes.body)) !== null && tasks.length < 8) {
              try {
                const origin = new URL(bm[1].trim()).origin;
                if (seenOrigins.has(origin) || knownUrls.has(origin)) continue;
                seenOrigins.add(origin);
                tasks.push(discoverSiteFeed(origin, origin).then((r) => {
                  if (r) { addResult({ ...r, provider: 'google_news' }); count++; }
                }));
              } catch { /* skip */ }
            }
            await Promise.allSettled(tasks);
          }
        } catch { /* non-fatal */ }
      }
      return count;
    }),

    runProviderStage('rsshub', 'RSSHub', providers.rsshub, stages, async () =>
      runRsshub(q, sector, addResult)
    ),

    runProviderStage('reddit', 'Reddit', providers.reddit, stages, async () => runReddit(q, addResult)),

    runProviderStage('podcast', 'بودكاست', providers.podcast, stages, async () => runPodcastIndex(q, addResult)),

    runProviderStage('openalex', 'OpenAlex', providers.openalex, stages, async () => runOpenAlex(q, addResult)),

    runProviderStage('youtube', 'YouTube', providers.youtube, stages, async () =>
      Promise.resolve(runYoutubeCatalog(q, sector, addResult))
    ),

    runProviderStage('official', 'رسمي', providers.official, stages, async () =>
      runOfficial(q, searchTerms, addResult)
    ),

    runProviderStage('ai', 'ذكاء اصطناعي', providers.ai, stages, async () =>
      runAi(q, addResult, existingNames)
    ),

    runProviderStage('telegram', 'Telegram', providers.telegram, stages, async () => {
      const { discoverTelegramFromArticles } = await import('../sources');
      const tg = await discoverTelegramFromArticles(100);
      let count = 0;
      for (const t of tg) {
        if (q && !t.title.toLowerCase().includes(q.toLowerCase())) continue;
        addResult({ ...t, provider: 'telegram' });
        count++;
      }
      return count;
    })
  ]);

  const rankT0 = Date.now();
  let live = allResults.filter((r) => r.score !== 0);
  if (opts.language && opts.language !== 'any') {
    live = live.filter((r) => {
      if (!r.language) return true;
      return r.language === opts.language || r.language === 'mixed';
    });
  }
  live.sort((a, b) => {
    const sd = (b.score ?? 50) - (a.score ?? 50);
    if (sd !== 0) return sd;
    return (b.subscribers ?? 0) - (a.subscribers ?? 0);
  });
  const trimmed = live.slice(0, limit);
  stages.push(stage('rank', 'ترتيب النتائج', 'done', trimmed.length, Date.now() - rankT0));

  if (trimmed.length === 0) {
    return {
      ok: true,
      results: [],
      stages,
      sector,
      error:
        'لم يُعثر على مصادر — جرّب قطاعاً محدداً، «عالمي إنجليزي»، تبويب الكتالوج، أو فعّل RSSHub/بودكاست/AI',
    };
  }

  getDb()
    .prepare(
      `INSERT INTO source_discovery_cache (query_hash, results_json, created_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(query_hash) DO UPDATE SET results_json=excluded.results_json, created_at=datetime('now')`
    )
    .run(key, JSON.stringify(trimmed));

  return { ok: true, results: trimmed, stages, cached: false, sector };
}

/** Resolve catalog-only browse (no query) */
export async function browseCatalog(catalogId: string, query = ''): Promise<SourceSearchResponse> {
  return searchSourcesAdvanced({
    query: query.trim(),
    catalogId,
    providers: {
      feedly: false,
      google_news: false,
      ai: false,
      catalog: true,
      official: false,
      telegram: false,
      rsshub: false,
      reddit: false,
      podcast: false,
      openalex: false,
      youtube: false,
    },
    limit: 60,
  });
}
