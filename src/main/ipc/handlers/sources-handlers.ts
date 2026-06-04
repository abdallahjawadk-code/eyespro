import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import fs from 'node:fs';
import { sanitizeInt, sanitizeString } from '../../security/sanitize';
import { isUrlFetchAllowed } from '../../security/url-policy';
import { normaliseTelegramUrl } from '../../services/source-discovery';
import * as sources from '../../services/sources';
import { listFetchAudit } from '../../services/fetch-audit';
import * as domainPolicy from '../../services/domain-policy';
import { getSourceTrust } from '../../services/source-trust';
import { hostFromUrl, getCircuitState } from '../../services/fetch-shield';
import { getSetting } from '../../services/settings';
import { getSessionFromEvent } from '../../auth/session-store';
function ok<T>(data: T): { ok: true; data: T } { return { ok: true, data }; }
import type { SourceSearchOptions } from '../../services/source-search/search';
import type { RegionPresetId } from '../../services/source-search/types';

export function registerSourcesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('sources:list', () => ok(sources.listSources()));
  ipcMain.handle('sources:get', (_e, id: number) => ok(sources.getSource(sanitizeInt(id, 1))));
  ipcMain.handle('sources:create', async (_e, data) => {
    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const name = sanitizeString(payload.name, 200);
    if (!name) return { ok: false, error: 'اسم المصدر مطلوب', code: 'VALIDATION' };

    const rawUrl = payload.url ? String(payload.url).trim() : '';
    const url = rawUrl ? normaliseTelegramUrl(sanitizeString(rawUrl, 2048)) : null;
    if (url) {
      const allowed = isUrlFetchAllowed(url);
      if (!allowed.ok) {
        return { ok: false, error: 'رابط المصدر غير صالح', code: allowed.error ?? 'INVALID_URL' };
      }
    }

    const id = sources.createSource({
      name,
      url: url ?? undefined,
      source_type: payload.source_type ? String(payload.source_type) : undefined,
      category: payload.category ? String(payload.category) : undefined,
      enabled: payload.enabled === false || payload.enabled === 0 ? 0 : 1,
    });

    const skipDetect = payload.skipDetect === true;
    if (url && !skipDetect && getSetting('fetch_auto_detect_on_create') !== '0') {
      const detected = await sources.autoDetectAndUpdateSource(id, url);
      return ok({ id, detected: detected ?? undefined });
    }
    return ok({ id });
  });
  ipcMain.handle('sources:update', (_e, id: number, data) => {
    const r = sources.updateSource(sanitizeInt(id, 1), data || {});
    return r ? ok(undefined) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('sources:delete', (_e, id: number) => { sources.deleteSource(sanitizeInt(id, 1)); return ok(undefined); });
  ipcMain.handle('sources:toggle', (_e, id: number, enabled: boolean) =>
    ok({ ok: sources.toggleSource(sanitizeInt(id, 1), !!enabled) })
  );
  ipcMain.handle('sources:fetch', async (event, id: number) => {
    const u = getSessionFromEvent(event);
    return ok(await sources.fetchSource(sanitizeInt(id, 1), u?.id));
  });
  ipcMain.handle('sources:fetchAll', async (event) => {
    const u = getSessionFromEvent(event);
    return ok(await sources.fetchAllEnabled(u?.id));
  });
  ipcMain.handle('sources:detect', async (_e, url: string) => {
    const res = await sources.detectSourceUrl(String(url || ''));
    return res.ok ? ok(res) : { ok: false, error: res.error, data: res.candidates?.length ? { candidates: res.candidates } : undefined };
  });
  ipcMain.handle('sources:discover', async (_e, url: string) => {
    const res = await sources.discoverSourceCandidates(String(url || ''));
    return res.ok ? ok(res) : { ok: false, error: res.error };
  });
  ipcMain.handle('sources:searchFeeds', async (_e, query: string) => {
    const res = await sources.searchFeedsByTopic(String(query || ''));
    return res.ok ? ok(res.results ?? []) : { ok: false, error: res.error };
  });
  ipcMain.handle('sources:searchAdvanced', async (_e, opts: unknown) => {
    const { searchSourcesAdvanced } = await import('../../services/source-search/search');
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
    const res = await searchSourcesAdvanced({
      query: String(o.query ?? ''),
      region: o.region as RegionPresetId | undefined,
      sector: o.sector ? String(o.sector) : undefined,
      language: o.language as SourceSearchOptions['language'],
      catalogId: o.catalogId ? String(o.catalogId) : undefined,
      limit: o.limit != null ? sanitizeInt(o.limit, 5, 80) : undefined,
      providers: o.providers as SourceSearchOptions['providers'],
    });
    return res.ok ? ok(res) : { ok: false, error: res.error, data: { stages: res.stages, sector: res.sector } };
  });
  ipcMain.handle('sources:listSectors', async () => {
    const { listSectors } = await import('../../services/source-search/search');
    return ok(listSectors());
  });
  ipcMain.handle('sources:clearDiscoveryCache', async (_e, query?: string) => {
    const { clearDiscoveryCache } = await import('../../services/source-search/search');
    return ok({ cleared: clearDiscoveryCache(query ? String(query) : undefined) });
  });
  ipcMain.handle('sources:similarFeeds', async (_e, feedUrl: string) => {
    const { getSimilarFeeds } = await import('../../services/source-search/search');
    return ok(await getSimilarFeeds(String(feedUrl || '')));
  });
  ipcMain.handle('sources:suggestCatalog', async (_e, data: unknown) => {
    const { suggestCatalogSource } = await import('../../services/source-search/search');
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return ok(suggestCatalogSource({ name: String(d.name ?? ''), feedUrl: String(d.feedUrl ?? d.url ?? ''), website: d.website ? String(d.website) : undefined, sector: d.sector ? String(d.sector) : undefined, language: d.language ? String(d.language) : undefined }));
  });
  ipcMain.handle('sources:providerStats', async () => {
    const { listProviderStats } = await import('../../services/source-search/search');
    return ok(listProviderStats());
  });
  ipcMain.handle('sources:listCatalogs', async () => {
    const { listCatalogs } = await import('../../services/source-search/search');
    return ok(listCatalogs());
  });
  ipcMain.handle('sources:browseCatalog', async (_e, catalogId: string, query?: string) => {
    const { browseCatalog } = await import('../../services/source-search/search');
    const res = await browseCatalog(String(catalogId || ''), query ? String(query) : '');
    return res.ok ? ok(res) : { ok: false, error: res.error, data: { stages: res.stages } };
  });
  ipcMain.handle('sources:previewFeed', async (_e, feedUrl: string) => ok(await sources.previewFeedUrl(String(feedUrl || ''))));
  ipcMain.handle('sources:bulkDiscover', async (_e, urlsOrText: string) => ok(await sources.bulkDiscoverSources(String(urlsOrText || ''))));
  ipcMain.handle('sources:previewFetch', async (_e, id: number, sampleUrl?: string) =>
    ok(await sources.previewSourceFetch(sanitizeInt(id, 1), sampleUrl ? String(sampleUrl) : undefined))
  );
  ipcMain.handle('sources:health', (_e, id: number) => ok(sources.getSourceHealth(sanitizeInt(id, 1))));
  ipcMain.handle('sources:healthAll', () => {
    const all = sources.listSources();
    return ok(all.map(s => {
      const host = s.url ? hostFromUrl(s.url) : '';
      const circuit = host ? getCircuitState(host) : null;
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        last_fetched_at: s.last_fetched_at,
        last_error: s.last_error,
        trust_score: getSourceTrust(s.id),
        fetch_interval_min: s.fetch_interval_min ?? null,
        next_fetch_at: s.next_fetch_at ?? null,
        circuit: circuit ? { mode: circuit.mode, shieldScore: circuit.shieldScore } : null,
        health: sources.getSourceHealth(s.id),
      };
    }));
  });
  ipcMain.handle('fetch:shieldOverview', async () => {
    const { getShieldOverview, listCircuitStates } = await import('../../services/fetch-shield');
    return ok({ overview: getShieldOverview(), circuits: listCircuitStates(30) });
  });
  ipcMain.handle('fetch:qualityTiers', async () => {
    const { getQualityTierStats, getLinkHealthStats } = await import('../../services/fetch-stats');
    return ok({ tiers: getQualityTierStats(), linkHealth: getLinkHealthStats() });
  });
  ipcMain.handle('domain:suggestPolicy', async (_e, host: string) => {
    const { suggestDomainPolicy } = await import('../../services/domain-intelligence');
    return ok(suggestDomainPolicy(String(host || '')));
  });
  ipcMain.handle('fetch:audit', (_e, opts?: { sourceId?: number; limit?: number }) => ok(listFetchAudit(opts)));
  ipcMain.handle('domainPolicies:list', () => ok(domainPolicy.listDomainPolicies()));
  ipcMain.handle('domainPolicies:upsert', (_e, data) => { domainPolicy.upsertDomainPolicy(data || {}); return ok(undefined); });
  ipcMain.handle('domainPolicies:delete', (_e, host: string) => ok({ deleted: domainPolicy.deleteDomainPolicy(String(host || '')) }));

  // sources:rediscoverBroken and sources:discoverTelegram kept here
  ipcMain.handle('sources:rediscoverBroken', async (_e, limit?: number) =>
    ok(await sources.rediscoverBrokenSources(limit ? sanitizeInt(limit, 1, 100) : 20))
  );
  ipcMain.handle('sources:discoverTelegram', async () => ok(await sources.discoverTelegramFromArticles()));

  // OPML
  ipcMain.handle('opml:preview', async (_e, xml: string) => {
    const { previewOpml } = await import('../../services/opml-import');
    return ok(previewOpml(String(xml || '')));
  });
  ipcMain.handle('opml:import', async (_e, xml: string) => {
    const { importOpml } = await import('../../services/opml-import');
    return ok(await importOpml(String(xml || '')));
  });
  ipcMain.handle('opml:importFile', async () => {
    const { importOpml } = await import('../../services/opml-import');
    const result = await dialog.showOpenDialog({ filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths.length) return ok(null);
    const xml = fs.readFileSync(result.filePaths[0], 'utf8');
    return ok(await importOpml(xml));
  });
  ipcMain.handle('opml:importUrl', async (_e, url: string) => {
    const { importOpmlFromUrl } = await import('../../services/opml-import');
    return ok(await importOpmlFromUrl(String(url || '')));
  });

  // Links
  ipcMain.handle('links:scan', async (_e, url: string) => {
    const { scanLink } = await import('../../services/link-scan');
    return ok(scanLink(String(url || '')));
  });
  ipcMain.handle('links:scanBatch', async (_e, urls: unknown) => {
    const { scanBatch } = await import('../../services/link-scan');
    const arr = Array.isArray(urls) ? urls.map(String).slice(0, 50) : [];
    return ok(scanBatch(arr));
  });
  ipcMain.handle('links:sanitize', async (_e, url: string) => {
    const { sanitizeLinkUrl } = await import('../../services/link-scan');
    return ok(sanitizeLinkUrl(String(url || '')));
  });
  ipcMain.handle('links:extract', async (_e, html: string) => {
    const { extractLinksFromHtml } = await import('../../services/link-scan');
    return ok(extractLinksFromHtml(String(html || '')));
  });
  ipcMain.handle('links:history', async () => {
    const { listScanHistory } = await import('../../services/link-scan');
    return ok(listScanHistory());
  });
  ipcMain.handle('links:health', async (_e, url: string) => {
    const { checkLinkHealth } = await import('../../services/link-health');
    return ok(await checkLinkHealth(String(url || '')));
  });
  ipcMain.handle('links:healthLog', async () => {
    const { listLinkHealthLog } = await import('../../services/link-health');
    return ok(listLinkHealthLog());
  });
  ipcMain.handle('domain:intelligence', async (_e, host?: string) => {
    const intel = await import('../../services/domain-intelligence');
    if (host) return ok(intel.analyzeDomain(String(host)));
    return ok(intel.listDomainIntelligence());
  });
  ipcMain.handle('sources:lowTrust', async () => {
    const trust = await import('../../services/source-trust');
    return ok(trust.listLowTrustSources());
  });

  // Sources search keywords
  ipcMain.handle('keywords:list', async () => {
    const kw = await import('../../services/keyword-alerts');
    return ok(kw.listAlerts());
  });
  ipcMain.handle('keywords:create', async (_e, keyword: string) => {
    const kw = await import('../../services/keyword-alerts');
    return ok({ id: kw.createAlert(sanitizeString(String(keyword), 200)) });
  });
  ipcMain.handle('keywords:delete', async (_e, id: number) => {
    const kw = await import('../../services/keyword-alerts');
    return ok({ ok: kw.deleteAlert(sanitizeInt(id, 1)) });
  });
  ipcMain.handle('keywords:toggle', async (_e, id: number, enabled: boolean) => {
    const kw = await import('../../services/keyword-alerts');
    return ok({ ok: kw.toggleAlert(sanitizeInt(id, 1), Boolean(enabled)) });
  });
  ipcMain.handle('keywords:matches', async (_e, dismissed?: boolean) => {
    const kw = await import('../../services/keyword-alerts');
    return ok(kw.listMatches(!!dismissed));
  });
  ipcMain.handle('keywords:dismiss', async (_e, id: number) => {
    const kw = await import('../../services/keyword-alerts');
    return ok({ ok: kw.dismissMatch(sanitizeInt(id, 1)) });
  });
}
