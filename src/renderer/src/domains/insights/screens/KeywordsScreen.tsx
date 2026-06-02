import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Empty, Field, Input, Loading, Msg, Panel, Toolbar } from '../../../ui';

type Keyword = { id: number; keyword: string; enabled: boolean };

export function KeywordsScreen() {
  const { t } = useTranslation();
  const [rows, setRows]       = useState<Keyword[]>([]);
  const [newWord, setNewWord] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await window.eyespro.keywords.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) {
      setRows(res.data as Keyword[]);
    } else {
      setError(t('common.loadError', { defaultValue: 'Failed to load data' }));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const word = newWord.trim();
    if (!word) return;
    setSaving(true);
    await window.eyespro.keywords.create(word);
    setNewWord('');
    setSaving(false);
    void load();
  }

  async function toggle(id: number, enabled: boolean) {
    await window.eyespro.keywords.toggle(id, !enabled);
    // Optimistic update
    setRows((prev) => prev.map((k) => k.id === id ? { ...k, enabled: !enabled } : k));
  }

  async function remove(id: number) {
    await window.eyespro.keywords.delete(id);
    setRows((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <Panel>
      <Toolbar>
        <Field label="">
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder={t('keywordAlerts.addPlaceholder')}
              style={{ width: 220 }}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            />
            <Btn variant="primary" onClick={() => void add()} disabled={saving || !newWord.trim()}>
              {saving ? '…' : t('keywordAlerts.addBtn')}
            </Btn>
          </div>
        </Field>
        <Btn onClick={() => void load()}>↻</Btn>
      </Toolbar>

      {error && <Msg tone="err" style={{ marginBottom: 12 }}>{error}</Msg>}

      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty
          icon="🔔"
          title={t('keywordAlerts.emptyTitle', { defaultValue: 'No keyword alerts' })}
          desc={t('keywordAlerts.emptyDesc',   { defaultValue: 'Add keywords to get notified when matching articles are ingested' })}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {rows.map((k) => (
            <div
              key={k.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: k.enabled ? 'var(--acc-soft)' : 'var(--bg2)',
                border: `1px solid ${k.enabled ? 'var(--acc)' : 'var(--border)'}`,
                borderRadius: 20, padding: '6px 12px',
                opacity: k.enabled ? 1 : 0.55,
                transition: 'all .15s',
              }}
            >
              <button
                type="button"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--t1)' }}
                title={k.enabled
                  ? t('keywordAlerts.disable', { defaultValue: 'Disable' })
                  : t('keywordAlerts.enable',  { defaultValue: 'Enable' })}
                onClick={() => void toggle(k.id, k.enabled)}
              >
                {k.keyword}
              </button>
              <span style={{ fontSize: 11, color: k.enabled ? 'var(--acc)' : 'var(--t3)' }}>
                {k.enabled ? '●' : '○'}
              </span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--t3)', lineHeight: 1 }}
                title={t('common.delete', { defaultValue: 'Delete' })}
                onClick={() => void remove(k.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
