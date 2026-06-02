import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ArticleFull } from '../../../../../shared/api-types';
import { SocialPublishCard } from '../../social';
import { RichEditor } from '../../../components/editor/RichEditor';
import { TranslatePanel } from '../../../components/translation/TranslatePanel';
import { Badge, Btn, Card, Field, Input, Loading, Msg, Panel, Select, Textarea, Toolbar } from '../../../ui';

/* ── Processing steps available in the AI card ─────────────────── */
const PROC_STEPS = [
  { key: 'sanitize',      icon: '🧹', labelKey: 'pipeline.steps.sanitize',      ai: false },
  { key: 'proofread',     icon: '🔎', labelKey: 'pipeline.steps.proofread',     ai: false },
  { key: 'rewrite',       icon: '✍️', labelKey: 'pipeline.steps.rewrite',       ai: true  },
  { key: 'tldr',          icon: '📝', labelKey: 'pipeline.steps.tldr',          ai: true  },
  { key: 'seo_meta',      icon: '🔍', labelKey: 'pipeline.steps.seo_meta',      ai: true  },
  { key: 'tag_sentiment', icon: '🏷️', labelKey: 'pipeline.steps.tag_sentiment', ai: true  },
  { key: 'validate',      icon: '✅', labelKey: 'pipeline.steps.validate',      ai: false },
] as const;

/** Strip HTML tags and count words. */
function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

/** Strip HTML tags from plain-text fields (title, summary) that may contain raw HTML. */
function stripHtml(value: string | undefined | null): string {
  if (!value) return '';
  // If the value doesn't look like HTML, return as-is
  if (!/<[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 0–100 completeness score based on key article fields. */
function calcHealth(form: Partial<ArticleFull>): number {
  const checks = [
    Boolean(form.title?.trim()),
    Boolean(form.summary?.trim()),
    (form.content?.replace(/<[^>]*>/g, '').trim().length ?? 0) > 50,
    Boolean(form.category?.trim()),
    Boolean(form.link?.trim()),
    Boolean(form.image_url?.trim()),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

const empty: Partial<ArticleFull> = {
  title: '', summary: '', content: '', category: '', status: 'draft', link: '', source: '',
};

export function ArticleEditorScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  /* ── Article form ─────────────────────────────────────────────── */
  const [form, setForm] = useState<Partial<ArticleFull>>(empty);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);          // unsaved changes exist
  const [autoSaving, setAutoSaving] = useState(false); // auto-save in progress
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── Download card ───────────────────────────────────────────── */
  const [downloading, setDownloading] = useState(false);
  const [dlMsg, setDlMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── AI processing card ───────────────────────────────────────── */
  const [selSteps, setSelSteps] = useState<Set<string>>(
    new Set(['rewrite', 'tldr', 'seo_meta', 'tag_sentiment']),
  );
  const [aiRunning, setAiRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [aiLabel, setAiLabel] = useState('');

  /* ── Derived values ──────────────────────────────────────────── */
  const wordCount = useMemo(() => countWords(form.content ?? ''), [form.content]);
  const healthScore = useMemo(() => calcHealth(form), [form]);

  /* ── Helper: update form field and mark dirty ────────────────── */
  function patch(fields: Partial<ArticleFull>) {
    setForm((prev: Partial<ArticleFull>) => ({ ...prev, ...fields }));
    setDirty(true);
  }

  /* ── Save ref for Ctrl+S ──────────────────────────────────────── */
  const saveRef    = useRef<() => void>(() => undefined);
  /** Guard against concurrent save calls (manual + auto-save race) */
  const isSavingRef = useRef(false);

  /* ── Load article ─────────────────────────────────────────────── */
  const loadArticle = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const res = await window.eyespro.articles.get(Number(id));
    if (res.ok && res.data) {
      const raw        = res.data as ArticleFull;
      const cleanTitle   = stripHtml(raw.title);
      const cleanSummary = stripHtml(raw.summary);
      setForm({ ...raw, title: cleanTitle, summary: cleanSummary });

      // If HTML was present, sync cleaned version to DB immediately so
      // the database is never out-of-sync with what's shown in the editor.
      // This prevents a "silent mutation on next auto-save" scenario.
      const wasStripped =
        cleanTitle   !== (raw.title   ?? '') ||
        cleanSummary !== (raw.summary ?? '');
      if (wasStripped) {
        void window.eyespro.articles
          .update(Number(id), { ...raw, title: cleanTitle, summary: cleanSummary })
          .catch(() => undefined);
      }
    }
    setDirty(false);
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => { void loadArticle(); }, [loadArticle]);

  /* ── Load AI status on mount ─────────────────────────────────── */
  useEffect(() => {
    window.eyespro.pipeline.aiStatus().then((r) => {
      if (r.ok && r.data) {
        const d = r.data as { ok: boolean; providerLabel?: string };
        setAiReady(d.ok);
        setAiLabel(d.providerLabel ?? '');
      }
    }).catch(() => undefined);
  }, []);

  /* ── Ctrl+S keyboard shortcut ────────────────────────────────── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ── Save article ─────────────────────────────────────────────── */
  async function save(e?: FormEvent, silent = false) {
    e?.preventDefault();
    // Prevent concurrent saves — manual Ctrl+S + auto-save timer race
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    if (silent) setAutoSaving(true);
    else { setSaving(true); setMsg(null); }
    try {
      const res = isNew
        ? await window.eyespro.articles.create({ ...form })
        : await window.eyespro.articles.update(Number(id), { ...form });
      if (res.ok) {
        setSavedAt(new Date());
        setDirty(false);
        if (!silent) {
          setMsg({ ok: true, text: t('articles.saved') });
          setTimeout(() => setMsg(null), 3000);
        }
        if (isNew && res.data?.id) navigate(`/articles/${res.data.id}`, { replace: true });
      } else if (!silent) {
        setMsg({ ok: false, text: t('articles.saveFailed') });
      }
    } finally {
      isSavingRef.current = false;
      if (silent) setAutoSaving(false);
      else setSaving(false);
    }
  }

  // Keep ref in sync with latest save closure
  useEffect(() => { saveRef.current = () => void save(); });

  /* ── Auto-save every 30 s when dirty ────────────────────────── */
  useEffect(() => {
    if (isNew || !dirty) return;
    const timer = setTimeout(() => { void save(undefined, true); }, 30_000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, form, isNew]);

  async function submitReview() {
    const res = await window.eyespro.quality.submit(Number(id));
    setMsg({
      ok: res.ok && res.data?.ok !== false,
      text: res.ok ? t('quality.submitted') : t('quality.submitFailed'),
    });
  }

  /* ── Download article ────────────────────────────────────────── */
  async function downloadDocx() {
    if (isNew) return;
    setDownloading(true);
    setDlMsg(null);
    try {
      const r = await window.eyespro.articles.downloadDocx([Number(id)], { groupBy: 'none', toDesktop: false });
      if (r.ok) {
        setDlMsg({ ok: true, text: t('download.successOne') });
      } else if (r.error !== 'cancelled') {
        setDlMsg({ ok: false, text: r.error ?? t('download.failed') });
      }
    } finally {
      setDownloading(false);
    }
  }

  /* ── Run AI processing steps ──────────────────────────────────── */
  async function runProcessing() {
    if (!selSteps.size || isNew) return;
    setAiRunning(true);
    setAiMsg(null);
    setCurrentStep(null);
    let failCount = 0;
    try {
      for (const step of [...selSteps]) {
        setCurrentStep(step);
         
        const r = await window.eyespro.pipeline.runStep(Number(id), step as never);
        if (!r.ok) failCount++;
      }
      // Reload article so the editor reflects AI-updated content
      const fresh = await window.eyespro.articles.get(Number(id));
      if (fresh.ok && fresh.data) setForm(fresh.data as ArticleFull);
    } finally {
      setAiRunning(false);
      setCurrentStep(null);
    }
    setAiMsg({
      ok: failCount === 0,
      text: failCount === 0
        ? t('pipeline.processingDone')
        : t('pipeline.failed'),
    });
  }

  function toggleStep(key: string) {
    setSelSteps((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  /* ── Health score color ─────────────────────────────────────── */
  function healthColor(score: number): string {
    if (score >= 80) return 'var(--ok)';
    if (score >= 50) return 'var(--warn)';
    return 'var(--err)';
  }

  /* ── Format save time ────────────────────────────────────────── */
  function formatSavedAt(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Render ───────────────────────────────────────────────────── */
  if (loading) return <Loading />;

  return (
    <div className="page-content" style={{ padding: '0 24px 48px' }}>
      <Toolbar>
        <Link to="/articles" className="btn btn-ghost">← {t('nav.articlesContent')}</Link>
        <Badge
          tone={form.status === 'published' ? 'ok' : form.status === 'pending' ? 'warn' : 'muted'}
        >
          {form.status}
        </Badge>

        {/* Word count chip */}
        <span style={{
          fontSize: 11, color: 'var(--t3)', background: 'var(--surface-2, var(--border))',
          borderRadius: 99, padding: '2px 8px', userSelect: 'none',
        }}>
          {t('articles.wordCount', { count: wordCount })}
        </span>

        <div style={{ flex: 1 }} />

        {/* Save status indicator */}
        {autoSaving && (
          <span style={{ fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 10 }}>⟳</span>
            {t('articles.autoSaving')}
          </span>
        )}
        {!autoSaving && savedAt && !dirty && (
          <span style={{ fontSize: 11, color: 'var(--ok)' }}>
            ✓ {formatSavedAt(savedAt)}
          </span>
        )}
        {!autoSaving && dirty && (
          <span style={{ fontSize: 11, color: 'var(--warn)' }} title={t('articles.ctrlSHint')}>
            ● {t('articles.unsaved')}
          </span>
        )}

        {!isNew && (
          <Btn onClick={() => void submitReview()}>
            {t('quality.submitReview')}
          </Btn>
        )}
        <Btn variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '…' : t('common.save')}
        </Btn>
      </Toolbar>

      {msg && (
        <div style={{ marginBottom: 12 }}>
          <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>
        </div>
      )}

      {/* Force LTR so the sidebar column always appears on the right in RTL apps */}
      <form
        onSubmit={(e) => void save(e)}
        dir="ltr"
        style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}
      >
        {/* ── Left: editor ─────────────────────────────────────── */}
        <div dir={i18n.dir()} style={{ flex: 1, minWidth: 0 }}>
        <Panel>
          <Field label={t('articles.colTitle')}>
            <Input
              value={form.title ?? ''}
              onChange={(e) => patch({ title: e.target.value })}
              style={{
                fontSize: 18, fontWeight: 700,
                border: 'none', borderBottom: '2px solid var(--border)',
                borderRadius: 0, background: 'transparent',
              }}
            />
          </Field>
          <Field label={t('articles.summary')}>
            <Textarea
              value={form.summary ?? ''}
              onChange={(e) => patch({ summary: e.target.value })}
              rows={2}
            />
          </Field>
          <RichEditor
            value={form.content ?? ''}
            onChange={(content) => patch({ content })}
            articleId={isNew ? undefined : Number(id)}
          />
        </Panel>
        </div>

        {/* ── Right: sidebar cards ──────────────────────────────── */}
        <div dir={i18n.dir()} style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Article health / completeness card */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* Progress arc */}
            <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
              <svg width="40" height="40" viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="4" />
                <circle
                  cx="20" cy="20" r="16" fill="none"
                  stroke={healthColor(healthScore)} strokeWidth="4"
                  strokeDasharray={`${(healthScore / 100) * 100.53} 100.53`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.4s ease' }}
                />
              </svg>
              <span style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: healthColor(healthScore),
              }}>
                {healthScore}
              </span>
            </div>
            <div title={`معايير تقييم صحة المقال:
• العنوان مكتوب: ${form.title?.trim() ? '✓' : '✗'}
• الملخص مكتوب: ${form.summary?.trim() ? '✓' : '✗'}
• المحتوى كافي (>50 حرف): ${(form.content?.replace(/<[^>]*>/g, '').trim().length ?? 0) > 50 ? '✓' : '✗'}
• التصنيف محدد: ${form.category?.trim() ? '✓' : '✗'}
• رابط المصدر موجود: ${form.link?.trim() ? '✓' : '✗'}
• صورة المقال موجودة: ${form.image_url?.trim() ? '✓' : '✗'}`}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>
                {t('articles.health')}
              </div>
              <div style={{ fontSize: 11, color: healthColor(healthScore), cursor: 'help' }}>
                {t('articles.healthScore', { score: healthScore })}
              </div>
            </div>
          </div>

          {/* Meta card */}
          <Card title={t('articles.meta')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label={t('articles.colStatus')}>
                <Select
                  value={form.status ?? 'draft'}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  <option value="draft">{t('articles.statusDraft')}</option>
                  <option value="pending">{t('articles.statusPending')}</option>
                  <option value="published">{t('articles.statusPublished')}</option>
                </Select>
              </Field>
              <Field label={t('articles.colCategory')}>
                <Input
                  value={form.category ?? ''}
                  onChange={(e) => patch({ category: e.target.value })}
                />
              </Field>
              <Field label="URL">
                <Input
                  value={form.link ?? ''}
                  onChange={(e) => patch({ link: e.target.value })}
                />
              </Field>
            </div>
          </Card>

          {/* Translation panel */}
          {!isNew && <TranslatePanel articleId={Number(id)} />}

          {/* Download card */}
          {!isNew && (
            <Card title={`⬇ ${t('download.downloadBtn')}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ color: 'var(--t2)', fontSize: 12, margin: 0 }}>
                  {t('download.tip1')}
                </p>
                {dlMsg && <Msg tone={dlMsg.ok ? 'ok' : 'err'}>{dlMsg.text}</Msg>}
                <Btn
                  variant="primary"
                  disabled={downloading}
                  onClick={() => void downloadDocx()}
                >
                  {downloading ? '…' : `⬇ ${t('download.downloadBtn')}`}
                </Btn>
              </div>
            </Card>
          )}

          {/* Social publish card */}
          {!isNew && (
            <SocialPublishCard
              articleId={Number(id)}
              title={form.title ?? ''}
              summary={form.summary ?? ''}
              content={form.content ?? ''}
              sourceUrl={form.link ?? ''}
              imageUrl={form.image_url ?? ''}
            />
          )}

          {/* AI processing card */}
          {!isNew && (
            <Card title={`🤖 ${t('pipeline.aiProcessing')}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                {/* AI provider status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: aiReady === null ? '#94a3b8' : aiReady ? '#22c55e' : '#f59e0b',
                  }} />
                  <span style={{ fontSize: 11, color: 'var(--t2)' }}>
                    {aiReady === null
                      ? '…'
                      : aiReady
                      ? (aiLabel || t('pipeline.aiReady'))
                      : t('pipeline.aiNotReady')}
                  </span>
                </div>

                {/* Current running step indicator */}
                {currentStep && (
                  <div style={{
                    fontSize: 11, color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: 'var(--accent-soft, rgba(37,99,235,.06))',
                    borderRadius: 6, padding: '4px 8px',
                  }}>
                    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 12 }}>⏳</span>
                    {t('pipeline.currentStep', { step: t(`pipeline.steps.${currentStep}`, { defaultValue: currentStep }) })}
                  </div>
                )}

                {/* AI processing stepper / checklist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}>
                  {PROC_STEPS.map((step, idx) => {
                    const isSelected = selSteps.has(step.key);
                    if (!isSelected && aiRunning) return null; // hide unselected items during execution for cleanliness
                    const isRunning = aiRunning && currentStep === step.key;
                    const isCompleted = aiRunning && currentStep && PROC_STEPS.findIndex(s => s.key === currentStep) > idx;

                    return (
                      <div
                        key={step.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 8px',
                          borderRadius: 8,
                          background: isRunning ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                          border: isRunning ? '1px solid rgba(37, 99, 235, 0.2)' : '1px solid transparent',
                          opacity: aiRunning && !isRunning && !isCompleted ? 0.4 : 1,
                          transition: 'all 0.2s',
                        }}
                      >
                        {!aiRunning ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleStep(step.key)}
                            disabled={aiRunning}
                            style={{ cursor: 'pointer' }}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: isCompleted ? 'var(--ok)' : isRunning ? 'var(--accent)' : 'var(--t3)' }}>
                            {isCompleted ? '✓' : isRunning ? '⚡' : '○'}
                          </span>
                        )}
                        <span style={{ fontSize: 13 }}>{step.icon}</span>
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: isRunning ? 700 : 400, color: isRunning ? 'var(--accent)' : 'var(--t1)' }}>
                          {t(step.labelKey)}
                        </span>
                        {step.ai && !aiRunning && (
                          <span style={{
                            fontSize: 9, background: 'var(--accent)', color: '#fff',
                            borderRadius: 3, padding: '1px 4px', fontWeight: 'bold',
                          }}>
                            AI
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {aiMsg && <Msg tone={aiMsg.ok ? 'ok' : 'err'}>{aiMsg.text}</Msg>}

                <Btn
                  variant="primary"
                  disabled={aiRunning || !selSteps.size}
                  onClick={() => void runProcessing()}
                >
                  {aiRunning
                    ? `⏳ ${t('pipeline.processing')}`
                    : `🤖 ${t('pipeline.runProcessing')}`}
                </Btn>
              </div>
            </Card>
          )}

        </div>
      </form>
    </div>
  );
}
