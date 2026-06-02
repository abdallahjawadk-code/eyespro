import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TrendRow } from '../../../../../shared/api-types';
import { Badge, Btn, Card, Empty, Field, Input, Loading, Modal, Msg, Panel, Textarea, Toolbar } from '../../../ui';

export function TrendsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.trendRadar.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) setRows(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function fetchAll() {
    setFetchingAll(true);
    setMsg(null);
    try {
      const res = await window.eyespro.trendRadar.fetchAll().catch(() => ({ ok: false, data: undefined }));
      if (res.ok && res.data) {
        const d = res.data as { total?: number; inserted?: number; failed?: number };
        const inserted = d.inserted ?? 0;
        const failed   = d.failed   ?? 0;
        setMsg({ ok: true, text: t('trendRadar.fetchAllDone', { total: d.total ?? 0, inserted: inserted, defaultValue: `Fetched — added ${inserted} new` }) + (failed > 0 ? ` (${failed} failed)` : '') });
      } else {
        setMsg({ ok: false, text: t('common.error') });
      }
    } finally {
      setFetchingAll(false);
    }
    void load();
  }

  async function generate(id: number) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await window.eyespro.trendRadar.generate(id);
      if (res.ok && res.data?.articleId) {
        navigate(`/articles/${res.data.articleId}`);
        return;
      }
      setMsg({ ok: false, text: res.error ?? t('trendRadar.generateFailed') });
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: number) {
    if (!confirm(t('trendRadar.dismissConfirm', { defaultValue: 'Dismiss this trend?' }))) return;
    await window.eyespro.trendRadar.dismiss(id);
    void load();
  }

  function openEdit(tr: TrendRow) {
    setEditId(tr.id);
    setEditForm({ title: tr.title, description: tr.description ?? '' });
  }

  async function saveEdit() {
    if (!editId) return;
    await window.eyespro.trendRadar.update(editId, editForm);
    setEditId(null);
    void load();
  }

  return (
    <Panel>
      <div style={{
        marginBottom: 16, padding: '14px 18px', borderRadius: 16,
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 12%, var(--bg2)), var(--bg1))',
        border: '1px solid color-mix(in srgb, var(--acc) 25%, var(--border))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>🤖 {t('nav.autopilot')}</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{t('autopilot.description')}</div>
        </div>
        <Btn variant="primary" onClick={() => navigate('/autopilot')}>{t('autopilot.runNow')}</Btn>
      </div>
      <Toolbar>
        <Btn disabled={fetchingAll} onClick={() => void fetchAll()}>
          {fetchingAll ? '…' : t('trendRadar.fetchAllBtn')}
        </Btn>
        <Btn onClick={() => void load()}>↻</Btn>
      </Toolbar>
      {msg && <div style={{ marginBottom: 12 }}><Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg></div>}
      {loading ? <Loading label={t('trendRadar.loading')} /> : rows.length === 0 ? (
        <Empty title={t('trendRadar.noData')} desc={t('trendRadar.noDataHint')} icon="⚡" />
      ) : (
        <div className="ui-grid ui-grid--2">
          {rows.map((tr) => (
            <Card key={tr.id} title={tr.title}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>{tr.description?.slice(0, 200) ?? '—'}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={tr.status === 'completed' ? 'ok' : tr.status === 'generating' ? 'warn' : 'muted'}>{tr.status}</Badge>
                <Badge tone="muted">{tr.region}</Badge>
                <Btn size="sm" onClick={() => openEdit(tr)}>{t('trendRadar.editBtn')}</Btn>
                {tr.article_id && (
                  <Btn size="sm" onClick={() => navigate(`/articles/${tr.article_id}`)}>{t('common.open')}</Btn>
                )}
                <Btn size="sm" variant="primary" disabled={busy === tr.id} onClick={() => void generate(tr.id)}>
                  {busy === tr.id ? t('trendRadar.generating') : t('trendRadar.generateBtn')}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => void dismiss(tr.id)}>{t('trendRadar.dismissBtn')}</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editId != null && (
        <Modal title={t('trendRadar.editBtn')} onClose={() => setEditId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('articles.colTitle')}>
              <Input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field label={t('articles.summary')}>
              <Textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={4} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setEditId(null)}>{t('common.cancel')}</Btn>
              <Btn variant="primary" onClick={() => void saveEdit()}>{t('common.save')}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
