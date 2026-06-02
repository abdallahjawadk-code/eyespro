import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './translate-panel.css';

export type TranslateBackend = 'google' | 'ai';
export type TranslateLang = 'ar' | 'en' | 'fr' | 'es' | 'de' | 'tr' | 'ur' | 'fa';

type ArticleFields = {
  title?: string;
  summary?: string;
  content?: string;
};

type Props = {
  articleId?: number;
  fields?: ArticleFields;
  onFieldsChange?: (patch: ArticleFields) => void;
  onSaved?: () => void;
  compact?: boolean;
};

export function TranslatePanel({
  articleId,
  fields,
  onFieldsChange,
  onSaved,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const [backend, setBackend] = useState<TranslateBackend>('google');
  const [target, setTarget] = useState<TranslateLang>('ar');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [persist, setPersist] = useState(!!articleId);

  const langs: { id: TranslateLang; label: string }[] = [
    { id: 'ar', label: t('translation.lang.ar') },
    { id: 'en', label: t('translation.lang.en') },
    { id: 'fr', label: t('translation.lang.fr') },
    { id: 'es', label: t('translation.lang.es') },
    { id: 'tr', label: t('translation.lang.tr') },
    { id: 'de', label: t('translation.lang.de') },
    { id: 'ur', label: t('translation.lang.ur') },
    { id: 'fa', label: t('translation.lang.fa') },
  ];

  const translateText = async (text: string) => {
    const res = await window.eyespro.translation.text(text, target, backend);
    if (res.ok && typeof res.data === 'string') return res.data;
    throw new Error(res.error ?? t('articles.translateFailed'));
  };

  const runAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (articleId && persist) {
        const res = await window.eyespro.translation.article(articleId, target, backend, true);
        if (!res.ok || !res.data) throw new Error(res.error ?? t('articles.translateFailed'));
        const d = res.data as ArticleFields;
        onFieldsChange?.({ title: d.title, summary: d.summary, content: d.content });
        onSaved?.();
        setMsg({ text: t('translation.savedToDb'), ok: true });
      } else if (fields && onFieldsChange) {
        const [title, summary, content] = await Promise.all([
          fields.title?.trim() ? translateText(fields.title) : Promise.resolve(fields.title ?? ''),
          fields.summary?.trim() ? translateText(fields.summary) : Promise.resolve(fields.summary ?? ''),
          fields.content?.trim() ? translateText(fields.content) : Promise.resolve(fields.content ?? ''),
        ]);
        onFieldsChange({ title, summary, content });
        setMsg({ text: t('articles.translateSuccess'), ok: true });
      } else if (articleId) {
        const res = await window.eyespro.translation.article(articleId, target, backend);
        if (!res.ok || !res.data) throw new Error(res.error ?? t('articles.translateFailed'));
        onFieldsChange?.(res.data as ArticleFields);
        onSaved?.();
        setMsg({ text: t('articles.translateSuccess'), ok: true });
      } else {
        setMsg({ text: t('translation.noContent'), ok: false });
      }
    } catch (e) {
      const raw = String(e).replace(/^Error:\s*/i, '');
      const friendly = raw.includes('No handler registered')
        ? t('translation.handlerMissing', { defaultValue: 'خدمة الترجمة غير متاحة — أعد تشغيل التطبيق' })
        : raw;
      setMsg({ text: friendly, ok: false });
    }
    setBusy(false);
  };

  const runField = async (key: keyof ArticleFields) => {
    if (!fields?.[key]?.trim() || !onFieldsChange) return;
    setBusy(true);
    setMsg(null);
    try {
      const translated = await translateText(fields[key]!);
      onFieldsChange({ [key]: translated });
      setMsg({ text: t('translation.fieldDone', { field: key }), ok: true });
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    }
    setBusy(false);
  };

  return (
    <div className={`tr-panel${compact ? ' tr-panel--compact' : ''}`}>
      <div className="tr-panel-hdr">
        <span className="tr-panel-icon">🌐</span>
        <div>
          <strong>{t('translation.title')}</strong>
          {!compact && <p className="tr-panel-hint">{t('translation.hint')}</p>}
        </div>
      </div>

      <div className="tr-panel-row">
        <label className="tr-field">
          <span>{t('translation.backend')}</span>
          <select
            value={backend}
            onChange={(e) => setBackend(e.target.value as TranslateBackend)}
            disabled={busy}
          >
            <option value="google">{t('translation.backendGoogle')}</option>
            <option value="ai">{t('translation.backendAi')}</option>
          </select>
        </label>
        <label className="tr-field">
          <span>{t('translation.targetLang')}</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as TranslateLang)}
            disabled={busy}
          >
            {langs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {articleId && onFieldsChange && (
        <label className="tr-check">
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => setPersist(e.target.checked)}
            disabled={busy}
          />
          {t('translation.persistDb')}
        </label>
      )}

      <div className="tr-panel-actions">
        <button type="button" className="tr-btn tr-btn--primary" disabled={busy} onClick={() => void runAll()}>
          {busy ? '⏳' : '🌐'} {t('translation.translateAll')}
        </button>
        {fields && onFieldsChange && !compact && (
          <>
            <button type="button" className="tr-btn tr-btn--ghost" disabled={busy} onClick={() => void runField('title')}>
              {t('translation.fieldTitle')}
            </button>
            <button type="button" className="tr-btn tr-btn--ghost" disabled={busy} onClick={() => void runField('summary')}>
              {t('translation.fieldSummary')}
            </button>
            <button type="button" className="tr-btn tr-btn--ghost" disabled={busy} onClick={() => void runField('content')}>
              {t('translation.fieldContent')}
            </button>
          </>
        )}
      </div>

      {msg && <div className={msg.ok ? 'tr-msg tr-msg--ok' : 'tr-msg tr-msg--err'}>{msg.text}</div>}
    </div>
  );
}
