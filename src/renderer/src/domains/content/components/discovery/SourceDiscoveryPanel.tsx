import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './discovery.css';
import type {
  CatalogMeta,
  DetectPayload,
  DiscoveryMode,
  FeedResult,
  LanguageFilter,
  ProviderToggles,
  RegionId,
  SearchStage,
  SectorId,
  SectorMeta,
} from './types';
import { DEFAULT_PROVIDERS } from './types';
import { normalizeSourceUrl } from '../../lib/source-url';

const TYPE_ICONS: Record<string, string> = {
  rss: '📰',
  wordpress: '🌐',
  telegram: '✈️',
  json_api: '📋',
  html: '🔍',
  podcast: '🎙',
  youtube: '▶️',
};

const PROVIDER_KEYS: (keyof ProviderToggles)[] = [
  'catalog',
  'feedly',
  'google_news',
  'rsshub',
  'reddit',
  'podcast',
  'openalex',
  'youtube',
  'ai',
  'official',
  'telegram',
];

type AddDraft = {
  name: string;
  url: string;
  source_type: string;
  category?: string;
};

type Props = {
  knownUrls?: Set<string>;
  onAddSource: (draft: AddDraft) => Promise<{ ok: boolean; error?: string }>;
  onImported?: () => void;
};

export function SourceDiscoveryPanel({ knownUrls, onAddSource, onImported }: Props) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<DiscoveryMode>('topic');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionId>('SA');
  const [sector, setSector] = useState<SectorId>('all');
  const [langFilter, setLangFilter] = useState<LanguageFilter>('any');
  const [filterProvider, setFilterProvider] = useState('');
  const [detectedSector, setDetectedSector] = useState('');
  const [sectors, setSectors] = useState<SectorMeta[]>([]);
  const [providers, setProviders] = useState<ProviderToggles>({ ...DEFAULT_PROVIDERS });
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FeedResult[]>([]);
  const [stages, setStages] = useState<SearchStage[]>([]);
  const [err, setErr] = useState('');
  const [cached, setCached] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [addFeedback, setAddFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);

  const [catalogs, setCatalogs] = useState<CatalogMeta[]>([]);
  const [catalogId, setCatalogId] = useState('');

  const [detectUrl, setDetectUrl] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectPayload | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);

  const [bulkText, setBulkText] = useState('');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [opmlUrl, setOpmlUrl] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [similar, setSimilar] = useState<Record<string, FeedResult[]>>({});
  const [similarLoading, setSimilarLoading] = useState<string | null>(null);
  const [suggestName, setSuggestName] = useState('');
  const [suggestUrl, setSuggestUrl] = useState('');
  const [suggestMsg, setSuggestMsg] = useState('');

  useEffect(() => {
    void window.eyespro.sources.listCatalogs().then((res) => {
      if (res.ok && Array.isArray(res.data)) {
        const list = res.data as CatalogMeta[];
        setCatalogs(list);
        if (list[0]) setCatalogId(list[0].id);
      }
    });
    void window.eyespro.sources.listSectors().then((res) => {
      if (res.ok && Array.isArray(res.data)) setSectors(res.data as SectorMeta[]);
    });
  }, []);

  const sectorLabel = (s: SectorMeta) => (i18n.language.startsWith('ar') ? s.labelAr : s.labelEn);

  const filteredResults = useMemo(() => {
    let list = results;
    if (filterProvider) list = list.filter((r) => r.provider === filterProvider);
    return list;
  }, [results, filterProvider]);

  const toggleProv = (key: keyof ProviderToggles) => {
    setProviders((p) => ({ ...p, [key]: !p[key] }));
  };

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    setErr('');
    setResults([]);
    setStages([]);
    setCached(false);
    setAddFeedback(null);
    setSimilar({});
    setDetectedSector('');
    try {
      const res = await window.eyespro.sources.searchAdvanced({
        query: query.trim(),
        region,
        sector: sector !== 'all' ? sector : undefined,
        language: langFilter,
        providers,
        catalogId: mode === 'catalog' ? catalogId : undefined,
        limit: 60,
      });
      if (res.ok && res.data) {
        const data = res.data as {
          results?: FeedResult[];
          stages?: SearchStage[];
          cached?: boolean;
          error?: string;
          sector?: string;
        };
        setResults(data.results ?? []);
        setStages(data.stages ?? []);
        setCached(!!data.cached);
        if (data.sector) setDetectedSector(data.sector);
        if ((data.results ?? []).length === 0) {
          setErr(data.error ?? t('sources.discovery.noResults'));
        }
      } else {
        setErr(res.error ?? t('sources.searchFailed'));
        const data = res.data as { stages?: SearchStage[] } | undefined;
        if (data?.stages) setStages(data.stages);
      }
    } catch {
      setErr(t('common.connectionError'));
    }
    setBusy(false);
  }, [query, region, sector, langFilter, providers, catalogId, mode, t]);

  const loadSimilar = async (feedUrl: string) => {
    setSimilarLoading(feedUrl);
    const res = await window.eyespro.sources.similarFeeds(feedUrl);
    setSimilarLoading(null);
    if (res.ok && res.data) setSimilar((s) => ({ ...s, [feedUrl]: res.data as FeedResult[] }));
  };

  const clearCache = async () => {
    const res = await window.eyespro.sources.clearDiscoveryCache(query.trim() || undefined);
    if (res.ok) setImportMsg({ ok: true, text: t('sources.discovery.cacheCleared', { n: (res.data as { cleared: number })?.cleared ?? 0 }) });
    else setImportMsg({ ok: false, text: res.error ?? t('common.error') });
  };

  const submitSuggestion = async () => {
    if (!suggestName.trim() || !suggestUrl.trim()) return;
    const res = await window.eyespro.sources.suggestCatalog({
      name: suggestName.trim(),
      feedUrl: suggestUrl.trim(),
      sector: sector !== 'all' ? sector : undefined,
      language: langFilter !== 'any' ? langFilter : undefined,
    });
    if (res.ok) {
      setSuggestMsg(t('sources.discovery.suggestOk'));
      setSuggestName('');
      setSuggestUrl('');
      void window.eyespro.sources.listCatalogs().then((r) => {
        if (r.ok && Array.isArray(r.data)) setCatalogs(r.data as CatalogMeta[]);
      });
    } else {
      setSuggestMsg(res.error ?? t('common.error'));
    }
  };

  const loadCatalog = useCallback(async () => {
    if (!catalogId) return;
    setBusy(true);
    setErr('');
    setResults([]);
    setStages([]);
    try {
      const res = await window.eyespro.sources.browseCatalog(catalogId, query.trim());
      if (res.ok && res.data) {
        const data = res.data as { results?: FeedResult[]; stages?: SearchStage[] };
        setResults(data.results ?? []);
        setStages(data.stages ?? []);
      } else {
        setErr(res.error ?? t('sources.searchFailed'));
      }
    } catch {
      setErr(t('common.connectionError'));
    }
    setBusy(false);
  }, [catalogId, query, t]);

  const onDetect = async () => {
    if (!detectUrl.trim()) return;
    setDetecting(true);
    setDetectResult(null);
    setPickedUrl(null);
    try {
      const res = await window.eyespro.sources.discover(detectUrl.trim());
      if (res.ok && res.data) {
        const data = res.data as DetectPayload & { ok: boolean };
        setDetectResult(data);
        setPickedUrl(data.best?.feedUrl ?? null);
      } else {
        setDetectResult({ error: res.error ?? t('sources.detectFailed') });
      }
    } catch {
      setDetectResult({ error: t('common.connectionError') });
    }
    setDetecting(false);
  };

  const isKnown = (feedUrl: string) => {
    const url = normalizeSourceUrl(feedUrl);
    return !url || knownUrls?.has(url) || added.has(url);
  };

  const addResult = async (r: FeedResult) => {
    const url = normalizeSourceUrl(r.feedUrl);
    if (!url || isKnown(r.feedUrl) || adding.has(url)) return;

    setAdding((s) => new Set([...s, url]));
    setAddFeedback(null);
    try {
      const res = await onAddSource({
        name: r.title?.trim() || url,
        url,
        source_type: r.type ?? 'rss',
        category: r.category,
      });
      if (res.ok) {
        setAdded((s) => new Set([...s, url]));
        setAddFeedback({ ok: true, text: t('sources.discovery.addedOk', { name: r.title || url }) });
      } else {
        setAddFeedback({ ok: false, text: res.error ?? t('sources.discovery.addFailed') });
      }
    } catch {
      setAddFeedback({ ok: false, text: t('common.connectionError') });
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(url);
        return next;
      });
    }
  };

  const addTop = async (n: number) => {
    setAddFeedback(null);

    const candidates = results.slice(0, n).filter((r) => {
      const url = normalizeSourceUrl(r.feedUrl);
      return url && !isKnown(r.feedUrl) && !adding.has(url);
    });

    if (candidates.length === 0) {
      setAddFeedback({ ok: false, text: t('sources.discovery.nothingToAdd') });
      return;
    }

    // Mark all as adding upfront
    const urls = candidates.map((r) => normalizeSourceUrl(r.feedUrl)).filter(Boolean) as string[];
    setAdding((s) => new Set([...s, ...urls]));

    const results2 = await Promise.all(
      candidates.map(async (r) => {
        const url = normalizeSourceUrl(r.feedUrl)!;
        try {
          const res = await onAddSource({
            name: r.title?.trim() || url,
            url,
            source_type: r.type ?? 'rss',
            category: r.category,
          });
          return { url, ok: res.ok, error: res.error };
        } catch {
          return { url, ok: false, error: t('common.connectionError') };
        }
      }),
    );

    const okUrls = results2.filter((r) => r.ok).map((r) => r.url);
    const firstErr = results2.find((r) => !r.ok)?.error;

    if (okUrls.length > 0) setAdded((s) => new Set([...s, ...okUrls]));
    setAdding((s) => {
      const next = new Set(s);
      urls.forEach((u) => next.delete(u));
      return next;
    });

    if (okUrls.length > 0) {
      setAddFeedback({ ok: true, text: t('sources.discovery.addedBulk', { n: okUrls.length }) });
    } else {
      setAddFeedback({ ok: false, text: firstErr ?? t('sources.discovery.addFailed') });
    }
  };

  const previewFeed = async (feedUrl: string) => {
    setPreviewing(feedUrl);
    const res = await window.eyespro.sources.previewFeed(feedUrl);
    setPreviewing(null);
    if (res.ok && res.data?.preview) {
      const p = res.data.preview;
      const count = (res.data as { itemCount?: number }).itemCount;
      const warn = (p.warnings ?? []).join(' · ');
      const summary = p.summary?.slice(0, 220) ?? '';
      const parts = [
        p.title?.slice(0, 100),
        count != null ? `${count} ${t('sources.items')}` : '',
        `${p.purityScore}%`,
        p.method === 'feed' ? t('sources.discovery.previewFromFeed') : '',
        summary,
        warn,
      ].filter(Boolean);
      setPreview((prev) => ({ ...prev, [feedUrl]: parts.join(' — ') }));
    } else {
      const err = res.error ?? (res.data as { error?: string })?.error ?? t('sources.previewFailed');
      setPreview((prev) => ({
        ...prev,
        [feedUrl]: err.replace(/^Error:\s*/i, ''),
      }));
    }
  };

  const addDetected = async () => {
    const url = normalizeSourceUrl(pickedUrl ?? detectResult?.best?.feedUrl ?? '');
    if (!url || !detectResult || isKnown(url)) return;
    const picked = detectResult.candidates?.find((c) => normalizeSourceUrl(c.feedUrl) === url) ?? detectResult.best;
    setAddFeedback(null);
    setAdding((s) => new Set([...s, url]));
    try {
      const res = await onAddSource({
        name:
          detectResult.title?.trim() ||
          (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return url;
            }
          })(),
        url,
        source_type: picked?.type ?? detectResult.type ?? 'rss',
      });
      if (res.ok) {
        setAdded((s) => new Set([...s, url]));
        setAddFeedback({ ok: true, text: t('sources.discovery.addedOk', { name: detectResult.title || url }) });
      } else {
        setAddFeedback({ ok: false, text: res.error ?? t('sources.discovery.addFailed') });
      }
    } catch {
      setAddFeedback({ ok: false, text: t('common.connectionError') });
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(url);
        return next;
      });
    }
  };

  const onOpmlFile = async () => {
    setImportMsg(null);
    setBusy(true);
    try {
      const res = await window.eyespro.opml.importFile();
      if (res.ok && res.data) {
        const d = res.data as { created: number; skipped: number };
        setImportMsg({ ok: true, text: t('sources.discovery.opmlDone', { created: d.created, skipped: d.skipped }) });
        onImported?.();
      } else {
        setImportMsg({ ok: false, text: res.error ?? t('sources.discovery.opmlFail') });
      }
    } catch {
      setImportMsg({ ok: false, text: t('common.connectionError') });
    }
    setBusy(false);
  };

  const regionOptions = useMemo(
    () =>
      (['SA', 'EG', 'AE', 'JO', 'MA', 'KW', 'QA', 'LB', 'GLOBAL_AR', 'GLOBAL_EN'] as RegionId[]).map((id) => ({
        id,
        label: t(`sources.discovery.region.${id}`),
      })),
    [t]
  );

  return (
    <section className="sd-panel" aria-label={t('sources.discoverTitle')}>
      <header className="sd-hdr">
        <div className="sd-hdr-title">
          <span className="sd-hdr-dot" aria-hidden />
          {t('sources.discoverTitle')}
        </div>
        <nav className="sd-modes" role="tablist">
          {(
            [
              ['topic', '🗞', 'sources.searchTopic'],
              ['url', '🔗', 'sources.searchUrl'],
              ['catalog', '📚', 'sources.discovery.catalog'],
              ['import', '📥', 'sources.discovery.import'],
              ['community', '🤝', 'sources.discovery.community'],
            ] as const
          ).map(([id, icon, labelKey]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={`sd-mode-btn${mode === id ? ' is-active' : ''}`}
              onClick={() => {
                setMode(id);
                setErr('');
              }}
            >
              {icon} {t(labelKey)}
            </button>
          ))}
        </nav>
        <button type="button" className="sd-btn sd-btn--ghost sd-tools-toggle" onClick={() => setShowTools((v) => !v)}>
          ⚙ {showTools ? '▾' : '▸'}
        </button>
      </header>

      {sectors.length > 0 && (mode === 'topic' || mode === 'catalog') && (
        <div className="sd-sectors" role="group" aria-label={t('sources.discovery.sectors')}>
          {sectors.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sd-sector-chip${sector === s.id ? ' is-active' : ''}`}
              onClick={() => setSector(s.id as SectorId)}
            >
              {s.icon} {sectorLabel(s)}
            </button>
          ))}
        </div>
      )}

      {showTools && (
        <div className="sd-tools">
          <button type="button" className="sd-btn sd-btn--ghost" onClick={() => void clearCache()}>
            🗑 {t('sources.discovery.clearCache')}
          </button>
          {importMsg && mode !== 'import' && (
            <div className={importMsg.ok ? 'ok-banner' : 'sd-err'}>{importMsg.text}</div>
          )}
          <div className="sd-tools-row">
            <input
              className="sd-input"
              value={opmlUrl}
              onChange={(e) => setOpmlUrl(e.target.value)}
              placeholder={t('sources.discovery.opmlUrlPlaceholder')}
              dir="ltr"
            />
            <button
              type="button"
              className="sd-btn sd-btn--ghost"
              disabled={busy || !opmlUrl.trim()}
              onClick={async () => {
                setBusy(true);
                setImportMsg(null);
                try {
                  const res = await window.eyespro.opml.importUrl(opmlUrl.trim());
                  if (res.ok && res.data) {
                    const d = res.data as { created: number; skipped: number };
                    setImportMsg({ ok: true, text: t('sources.discovery.opmlDone', { created: d.created, skipped: d.skipped }) });
                    onImported?.();
                  } else {
                    setImportMsg({ ok: false, text: res.error ?? t('sources.discovery.opmlFail') });
                  }
                } catch {
                  setImportMsg({ ok: false, text: t('common.connectionError') });
                }
                setBusy(false);
              }}
            >
              {t('sources.discovery.opmlUrl')}
            </button>
          </div>
        </div>
      )}

      <div className="sd-body">
        {mode === 'topic' && (
          <>
            <div className="sd-toolbar">
              <div className="sd-field" style={{ flex: 2 }}>
                <label>{t('sources.discovery.query')}</label>
                <input
                  className="sd-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                  placeholder={t('sources.searchPlaceholder')}
                  disabled={busy}
                />
              </div>
              <div className="sd-field">
                <label>{t('sources.discovery.regionLabel')}</label>
                <select
                  className="sd-select"
                  value={region}
                  onChange={(e) => setRegion(e.target.value as RegionId)}
                  disabled={busy}
                >
                  {regionOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sd-field">
                <label>{t('sources.discovery.language')}</label>
                <select
                  className="sd-select"
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value as LanguageFilter)}
                  disabled={busy}
                >
                  <option value="any">{t('sources.discovery.langAny')}</option>
                  <option value="ar">{t('sources.discovery.langAr')}</option>
                  <option value="en">{t('sources.discovery.langEn')}</option>
                </select>
              </div>
              <button type="button" className="sd-btn sd-btn--primary" disabled={busy || !query.trim()} onClick={() => void runSearch()}>
                {busy ? `⏳ ${t('sources.searching')}` : `🔍 ${t('sources.searchBtn')}`}
              </button>
            </div>

            {detectedSector && detectedSector !== 'all' && (
              <p className="sd-hint sd-detected-sector">
                {t('sources.discovery.detectedSector')}: <strong>{detectedSector}</strong>
              </p>
            )}

            <div className="sd-providers">
              {PROVIDER_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`sd-prov-chip${providers[key] ? ' is-on' : ''}`}
                  onClick={() => toggleProv(key)}
                >
                  {providers[key] ? '✓' : '○'} {t(`sources.discovery.provider.${key}`)}
                </button>
              ))}
            </div>
            <p className="sd-hint">{t('sources.searchHint')}</p>
          </>
        )}

        {mode === 'catalog' && (
          <>
            <div className="sd-catalog-grid">
              {catalogs.map((c) => {
                const isAr = i18n.language === 'ar';
                const displayName = isAr ? c.name : (c.nameEn ?? c.name);
                const displayDesc = isAr ? c.description : (c.descEn ?? c.description);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`sd-catalog-tile${catalogId === c.id ? ' is-active' : ''}`}
                    onClick={() => setCatalogId(c.id)}
                  >
                    <strong>{displayName}</strong>
                    <span>{displayDesc}</span>
                  </button>
                );
              })}
            </div>
            <div className="sd-toolbar">
              <div className="sd-field">
                <label>{t('sources.discovery.filterCatalog')}</label>
                <input
                  className="sd-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('sources.discovery.filterPlaceholder')}
                />
              </div>
              <button type="button" className="sd-btn sd-btn--primary" disabled={busy || !catalogId} onClick={() => void loadCatalog()}>
                {busy ? '…' : t('sources.discovery.loadCatalog')}
              </button>
            </div>
          </>
        )}

        {mode === 'url' && (
          <>
            <div className="sd-toolbar">
              <div className="sd-field" style={{ flex: 2 }}>
                <label>{t('sources.discovery.siteUrl')}</label>
                <input
                  className="sd-input"
                  value={detectUrl}
                  onChange={(e) => setDetectUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void onDetect()}
                  placeholder={t('sources.urlDetectPlaceholder')}
                  disabled={detecting}
                  dir="ltr"
                />
              </div>
              <button type="button" className="sd-btn sd-btn--primary" disabled={detecting || !detectUrl.trim()} onClick={() => void onDetect()}>
                {detecting ? t('sources.detecting') : t('sources.detect')}
              </button>
            </div>
            <p className="sd-hint">{t('sources.detectHint')}</p>
            {detectResult?.error && <div className="sd-err">⚠ {detectResult.error}</div>}
            {detectResult && !detectResult.error && (
              <>
                {detectResult.title && <div className="sd-card-title">{detectResult.title}</div>}
                <div className="sd-candidates">
                  {(detectResult.candidates ?? []).map((c) => (
                    <button
                      key={c.feedUrl}
                      type="button"
                      className={`sd-candidate${pickedUrl === c.feedUrl ? ' is-picked' : ''}`}
                      onClick={() => setPickedUrl(c.feedUrl)}
                    >
                      <span className="sd-score-ring">{c.score}%</span>
                      <div className="sd-card-main">
                        <span className="sd-card-title">
                          {TYPE_ICONS[c.type] ?? '📡'} {c.label}
                        </span>
                        <span className="sd-card-meta" dir="ltr">
                          {c.feedUrl}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="sd-footer-actions">
                  <button type="button" className="sd-btn sd-btn--primary" disabled={!pickedUrl || adding.size > 0} onClick={() => void addDetected()}>
                    + {t('sources.addSource')}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {mode === 'community' && (
          <div className="sd-community">
            <p className="sd-hint">{t('sources.discovery.communityHint')}</p>
            <div className="sd-toolbar">
              <div className="sd-field">
                <label>{t('sources.discovery.suggestName')}</label>
                <input className="sd-input" value={suggestName} onChange={(e) => setSuggestName(e.target.value)} />
              </div>
              <div className="sd-field" style={{ flex: 2 }}>
                <label>{t('sources.discovery.suggestFeed')}</label>
                <input
                  className="sd-input"
                  value={suggestUrl}
                  onChange={(e) => setSuggestUrl(e.target.value)}
                  placeholder="https://..."
                  dir="ltr"
                />
              </div>
              <button type="button" className="sd-btn sd-btn--primary" onClick={() => void submitSuggestion()}>
                + {t('sources.discovery.suggestSubmit')}
              </button>
            </div>
            {suggestMsg && <div className="ok-banner">{suggestMsg}</div>}
          </div>
        )}

        {mode === 'import' && (
          <div className="sd-bulk">
            <p className="sd-hint">{t('sources.discovery.importHint')}</p>
            <button type="button" className="sd-btn sd-btn--primary" disabled={busy} onClick={() => void onOpmlFile()}>
              📥 {t('sources.discovery.opmlFile')}
            </button>
            {importMsg && <div className={importMsg.ok ? 'ok-banner' : 'sd-err'}>{importMsg.text}</div>}
            <label className="sd-field">
              <span>{t('sources.discovery.bulkUrls')}</span>
              <textarea
                className="sd-textarea"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder="https://example.com/feed&#10;https://..."
                dir="ltr"
              />
            </label>
            <button
              type="button"
              className="sd-btn sd-btn--ghost"
              disabled={busy || !bulkText.trim()}
              onClick={async () => {
                setBusy(true);
                setImportMsg(null);
                try {
                  const res = await window.eyespro.sources.bulkDiscover(bulkText);
                  if (res?.ok && res.data) {
                    const d = res.data as { imported: number; failed: number };
                    setImportMsg({ ok: true, text: t('sources.discovery.bulkDone', { n: d.imported, f: d.failed }) });
                    onImported?.();
                  } else {
                    setImportMsg({ ok: false, text: (res as { error?: string })?.error ?? t('common.error') });
                  }
                } catch {
                  setImportMsg({ ok: false, text: t('common.connectionError') });
                }
                setBusy(false);
              }}
            >
              {t('sources.discovery.bulkRun')}
            </button>
          </div>
        )}

        {(mode === 'topic' || mode === 'catalog') && (
          <>
            {stages.length > 0 && (
              <div className="sd-stages" role="status">
                {cached && <span className="sd-stage is-done">⚡ {t('sources.discovery.cached')}</span>}
                {stages.map((s) => (
                  <span
                    key={s.id}
                    className={`sd-stage${s.status === 'done' ? ' is-done' : ''}${s.status === 'error' ? ' is-error' : ''}${s.status === 'running' ? ' is-running' : ''}`}
                  >
                    {s.label}
                    <span className="sd-stage-count">{s.count}</span>
                    {s.ms > 0 && <span>({s.ms}ms)</span>}
                  </span>
                ))}
              </div>
            )}

            {err && <div className="sd-err">⚠ {err}</div>}

            {addFeedback && (
              <div className={addFeedback.ok ? 'ok-banner' : 'sd-err'}>{addFeedback.text}</div>
            )}

            {results.length > 0 && (
              <>
                <div className="sd-footer-actions">
                  <span className="sd-hint">
                    {t('sources.discovery.resultCount', { n: filteredResults.length })}
                    {filterProvider ? ` / ${results.length}` : ''}
                  </span>
                  <select
                    className="sd-select sd-select--compact"
                    value={filterProvider}
                    onChange={(e) => setFilterProvider(e.target.value)}
                    aria-label={t('sources.discovery.filterProvider')}
                  >
                    <option value="">{t('sources.discovery.allProviders')}</option>
                    {[...new Set(results.map((r) => r.provider).filter(Boolean))].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="sd-btn sd-btn--ghost" disabled={adding.size > 0} onClick={() => void addTop(5)}>
                    + {t('sources.discovery.addTop5')}
                  </button>
                </div>
                <div className="sd-results">
                  {filteredResults.map((r, i) => {
                    const url = normalizeSourceUrl(r.feedUrl);
                    const isAdded = Boolean(url && (added.has(url) || knownUrls?.has(url)));
                    const isAdding = Boolean(url && adding.has(url));
                    const score = r.score ?? 0;
                    return (
                      <article
                        key={`${r.feedUrl}-${i}`}
                        className="sd-card"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <div className={`sd-score-ring${score < 40 ? ' is-low' : ''}`}>{score > 0 ? score : '—'}</div>
                        <div className="sd-card-main">
                          <div className="sd-card-title" title={r.title}>
                            {r.title}
                          </div>
                          {r.description && <div className="sd-card-desc">{r.description}</div>}
                          <div className="sd-card-meta">
                            <span className="sd-badge sd-badge--prov">{r.provider ?? '—'}</span>
                            <span className="sd-badge">{(r.type ?? 'rss').toUpperCase()}</span>
                            {r.subscribers != null && r.subscribers > 0 && (
                              <span>👥 {r.subscribers.toLocaleString()}</span>
                            )}
                            <span dir="ltr" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {r.feedUrl}
                            </span>
                          </div>
                          {preview[r.feedUrl] && (
                            <div className="sd-preview">
                              <strong>{t('sources.discovery.preview')}</strong>
                              {preview[r.feedUrl]}
                            </div>
                          )}
                        </div>
                        <div className="sd-card-actions">
                          <button
                            type="button"
                            className={`sd-btn sd-btn--primary${isAdded ? ' is-added' : ''}`}
                            disabled={isAdded || isAdding || !url}
                            onClick={() => void addResult(r)}
                          >
                            {isAdding ? '…' : isAdded ? '✓' : `+ ${t('sources.addSource')}`}
                          </button>
                          <button
                            type="button"
                            className="sd-btn sd-btn--ghost"
                            disabled={previewing === r.feedUrl}
                            onClick={() => void previewFeed(r.feedUrl)}
                          >
                            {previewing === r.feedUrl ? '…' : `👁 ${t('sources.discovery.preview')}`}
                          </button>
                          <button
                            type="button"
                            className="sd-btn sd-btn--ghost"
                            disabled={similarLoading === r.feedUrl}
                            onClick={() => void loadSimilar(r.feedUrl)}
                          >
                            {similarLoading === r.feedUrl ? '…' : `↔ ${t('sources.discovery.similar')}`}
                          </button>
                        </div>
                        {similar[r.feedUrl]?.length ? (
                          <div className="sd-similar">
                            {similar[r.feedUrl]!.map((s) => (
                              <button
                                key={s.feedUrl}
                                type="button"
                                className="sd-similar-item"
                                onClick={() => void addResult(s)}
                              >
                                + {s.title}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            {!busy && results.length === 0 && !err && mode === 'topic' && (
              <div className="sd-empty">{t('sources.discovery.emptyTopic')}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
