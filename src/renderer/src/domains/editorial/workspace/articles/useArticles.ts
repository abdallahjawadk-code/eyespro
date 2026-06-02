import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleFull, ArticleFilters, ArticleStats, IngestMsg, SourceRow, Toast, ViewMode } from './types';

export type DocxGroupBy = 'source' | 'category' | 'status' | 'none';

const DEFAULT_FILTERS: ArticleFilters = {
  search: '',
  status: 'all',
  category: 'all',
  source: 'all',
  sortField: 'updated_at',
  sortOrder: 'DESC',
  page: 1,
  pageSize: 18,
};

export function useArticles(t: (key: string, opts?: Record<string, unknown>) => string) {
  const [rows, setRows] = useState<ArticleFull[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ArticleFilters>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem('eyespro_articles_view') as ViewMode) || 'grid';
    } catch {
      return 'grid';
    }
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [stats, setStats] = useState<ArticleStats>({ total: 0, draft: 0, pending: 0, published: 0 });

  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestMsg, setIngestMsg] = useState<IngestMsg>(null);

  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [bulkGroupBy, setBulkGroupBy] = useState<DocxGroupBy>('source');

  const [previewId, setPreviewId] = useState<number | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const pushToast = useCallback((text: string, ok: boolean) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, ok, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.search.trim()), 400);
    return () => clearTimeout(id);
  }, [filters.search]);

  useEffect(() => {
    try {
      localStorage.setItem('eyespro_articles_view', viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const listOpts = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      category: filters.category !== 'all' ? filters.category : undefined,
      source: filters.source !== 'all' ? filters.source : undefined,
      sortField: filters.sortField,
      sortOrder: filters.sortOrder,
      page: filters.page,
      pageSize: filters.pageSize,
    }),
    [debouncedSearch, filters]
  );

  const loadMeta = useCallback(async () => {
    const [initRes, srcRes] = await Promise.all([
      window.eyespro.articles.pageInit(),
      window.eyespro.sources.list(),
    ]);
    if (initRes.ok && initRes.data) {
      setCategories(initRes.data.categories);
      setStats(initRes.data.stats);
    }
    if (srcRes.ok && srcRes.data) setSources(srcRes.data as SourceRow[]);
  }, []);

  const loadStats = useCallback(async () => {
    const r = await window.eyespro.articles.pageInit();
    if (r.ok && r.data) setStats(r.data.stats);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [listRes, countRes] = await Promise.all([
      window.eyespro.articles.list(listOpts),
      window.eyespro.articles.count({
        search: listOpts.search,
        status: listOpts.status,
        category: listOpts.category,
        source: listOpts.source,
      }),
    ]);
    if (listRes.ok && listRes.data) setRows(listRes.data);
    if (countRes.ok && countRes.data !== undefined) setTotal(countRes.data);
    setLoading(false);
  }, [listOpts]);

  useEffect(() => {
    void loadMeta();
    void loadStats();
  }, [loadMeta, loadStats]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 }));
  }, [debouncedSearch, filters.status, filters.category, filters.source, filters.sortField, filters.sortOrder]);

  const patchFilters = useCallback((patch: Partial<ArticleFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, []);

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === rows.length && rows.length > 0) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const ingest = useCallback(async () => {
    const url = ingestUrl.trim();
    if (!url) return;
    setIngestMsg(null);
    const r = await window.eyespro.articles.ingest(url);
    if (!r.ok) {
      const err = r.error ?? '';
      setIngestMsg({
        ok: false,
        text: err === 'DUPLICATE' ? t('articles.ingestDuplicate') : err || t('articles.ingestFailed'),
      });
      return;
    }
    const data = r.data as { ok?: boolean; error?: string };
    if (data?.ok === false) {
      setIngestMsg({
        ok: false,
        text: data.error === 'DUPLICATE' ? t('articles.ingestDuplicate') : data.error || t('articles.ingestFailed'),
      });
      return;
    }
    setIngestUrl('');
    setIngestMsg({ ok: true, text: t('articles.ingestSuccess') });
    pushToast(t('articles.ingestSuccess'), true);
    void load();
    void loadStats();
  }, [ingestUrl, load, loadStats, pushToast, t]);

  const deleteArticle = useCallback(
    async (id: number) => {
      if (!confirm(t('articles.deleteConfirm'))) return;
      await window.eyespro.articles.delete(id);
      setSelected((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      if (previewId === id) setPreviewId(null);
      pushToast(t('articles.deleted'), true);
      void load();
      void loadStats();
    },
    [load, loadStats, previewId, pushToast, t]
  );

  const bulkDelete = useCallback(async () => {
    if (!selected.size) return;
    if (!confirm(t('articles.deleteConfirm'))) return;
    const r = await window.eyespro.articles.bulkDelete([...selected]);
    if (r.ok) {
      setSelected(new Set());
      pushToast(t('articles.deleted'), true);
      void load();
      void loadStats();
    } else {
      pushToast(r.error ?? t('articles.deleteFailed'), false);
    }
  }, [load, loadStats, pushToast, selected, t]);

  const deleteAll = useCallback(async () => {
    if (!confirm(t('articles.deleteAllConfirm'))) return;
    const r = await window.eyespro.articles.deleteAll();
    if (r.ok) {
      setSelected(new Set());
      const n = (r.data as { deleted: number })?.deleted ?? 0;
      pushToast(t('articles.deleteAllDone', { count: n }), true);
      void load();
      void loadStats();
    } else {
      pushToast(r.error ?? t('articles.deleteFailed'), false);
    }
  }, [load, loadStats, pushToast, t]);

  const downloadArticle = useCallback(
    async (id: number, groupBy: DocxGroupBy = 'none') => {
      setDownloadingId(id);
      try {
        const r = await window.eyespro.articles.downloadDocx([id], { groupBy, toDesktop: false });
        if (r.ok) {
          pushToast(t('articles.downloadSuccess', { defaultValue: 'تم حفظ الملف بنجاح' }), true);
        } else if (r.error !== 'cancelled') {
          pushToast(r.error ?? t('articles.downloadFailed', { defaultValue: 'فشل التحميل' }), false);
        }
      } finally {
        setDownloadingId(null);
      }
    },
    [pushToast, t]
  );

  const bulkDownload = useCallback(
    async (groupBy?: DocxGroupBy) => {
      if (!selected.size) return;
      const group = groupBy ?? bulkGroupBy;
      setDownloadingBulk(true);
      try {
        const r = await window.eyespro.articles.downloadDocx([...selected], {
          groupBy: group,
          title: t('articles.bulkDownloadTitle', { n: selected.size, defaultValue: `${selected.size} مقالات` }),
          toDesktop: false,
        });
        if (r.ok) {
          const count = (r.data as { count: number })?.count ?? selected.size;
          pushToast(t('articles.downloadSuccess', { defaultValue: `تم حفظ ${count} مقال بنجاح` }), true);
          clearSelection();
        } else if (r.error !== 'cancelled') {
          pushToast(r.error ?? t('articles.downloadFailed', { defaultValue: 'فشل التحميل' }), false);
        }
      } finally {
        setDownloadingBulk(false);
      }
    },
    [bulkGroupBy, clearSelection, pushToast, selected, t]
  );

  const downloadAllFiltered = useCallback(
    async (groupBy?: DocxGroupBy) => {
      const group = groupBy ?? bulkGroupBy;
      setDownloadingBulk(true);
      try {
        const countRes = await window.eyespro.articles.count({
          search: listOpts.search,
          status: listOpts.status,
          category: listOpts.category,
          source: listOpts.source,
        });
        const totalCount = countRes.ok ? (countRes.data ?? 0) : 0;
        if (!totalCount) {
          pushToast(t('articles.noArticles', { defaultValue: 'لا توجد مقالات' }), false);
          return;
        }
        const listRes = await window.eyespro.articles.list({ ...listOpts, page: 1, pageSize: 500 });
        if (!listRes.ok || !listRes.data?.length) {
          pushToast(t('articles.downloadFailed', { defaultValue: 'فشل التحميل' }), false);
          return;
        }
        const ids = listRes.data.map((a) => a.id);
        const r = await window.eyespro.articles.downloadDocx(ids, {
          groupBy: group,
          title: buildDownloadTitle(filters, group),
          toDesktop: false,
        });
        if (r.ok) {
          const count = (r.data as { count: number })?.count ?? ids.length;
          pushToast(t('articles.downloadSuccess', { defaultValue: `تم حفظ ${count} مقال بنجاح` }), true);
        } else if (r.error !== 'cancelled') {
          pushToast(r.error ?? t('articles.downloadFailed', { defaultValue: 'فشل التحميل' }), false);
        }
      } finally {
        setDownloadingBulk(false);
      }
    },
    [bulkGroupBy, filters, listOpts, pushToast, t]
  );

  const refresh = useCallback(() => {
    void load();
    void loadStats();
    void loadMeta();
  }, [load, loadMeta, loadStats]);

  const previewArticle = useMemo(
    () => (previewId != null ? rows.find((r) => r.id === previewId) ?? null : null),
    [previewId, rows]
  );

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  return {
    rows,
    total,
    totalPages,
    loading,
    filters,
    patchFilters,
    resetFilters,
    viewMode,
    setViewMode,
    selected,
    toggleRow,
    toggleAllOnPage,
    clearSelection,
    categories,
    sources,
    stats,
    ingestUrl,
    setIngestUrl,
    ingest,
    ingestMsg,
    bulkGroupBy,
    setBulkGroupBy,
    previewId,
    setPreviewId,
    previewArticle,
    downloadingId,
    downloadingBulk,
    downloadArticle,
    bulkDownload,
    downloadAllFiltered,
    deleteArticle,
    bulkDelete,
    deleteAll,
    refresh,
    toasts,
    filtersOpen,
    setFiltersOpen,
  };
}

function buildDownloadTitle(filters: ArticleFilters, groupBy: DocxGroupBy): string {
  const parts: string[] = [];
  if (filters.status !== 'all') parts.push(filters.status);
  if (filters.category !== 'all') parts.push(filters.category);
  if (filters.source !== 'all') parts.push(filters.source);
  if (filters.search) parts.push(filters.search.slice(0, 30));
  const base = parts.length ? parts.join(' — ') : 'جميع المقالات';
  const groupLabel = groupBy !== 'none' ? ` (مجمّع بـ${groupBy === 'source' ? 'المصدر' : groupBy === 'category' ? 'الفئة' : 'الحالة'})` : '';
  return base + groupLabel;
}
