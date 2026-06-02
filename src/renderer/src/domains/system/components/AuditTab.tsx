import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  details: string | null;
  created_at: string;
  username: string | null;
}

/* ─── Action label coloring ─────────────────────────────────────────────── */
const ACTION_COLOR: Record<string, string> = {
  login:           '#22c55e',
  logout:          '#94a3b8',
  create:          '#60a5fa',
  update:          '#f59e0b',
  delete:          '#f87171',
  publish:         '#a855f7',
  reset_password:  '#fb923c',
};

function actionColor(action: string): string {
  const key = Object.keys(ACTION_COLOR).find(k => action.toLowerCase().includes(k));
  return key ? ACTION_COLOR[key] : '#94a3b8';
}

/* ─── CSV export helper ─────────────────────────────────────────────────── */
function exportToCsv(rows: AuditRow[]) {
  const header = 'id,user,action,target_type,target_id,created_at,details';
  const lines = rows.map(r =>
    [r.id, r.username ?? r.user_id ?? '', r.action, r.target_type ?? '', r.target_id ?? '', r.created_at, r.details ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `audit_log_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ─────────────────────────────────────────────────────────── */
export function AuditTab() {
  const { t } = useTranslation();
  const [rows, setRows]         = useState<AuditRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('');
  const [typeFilter, setType]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.audit.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) setRows(res.data as AuditRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Filtered rows */
  const filtered = rows.filter(r => {
    const matchText = !filter || [r.action, r.username ?? '', r.target_type ?? ''].join(' ').toLowerCase().includes(filter.toLowerCase());
    const matchType = !typeFilter || r.target_type === typeFilter;
    return matchText && matchType;
  });

  /* Unique target types for filter dropdown */
  const targetTypes = [...new Set(rows.map(r => r.target_type).filter(Boolean))] as string[];

  /* Format date */
  const fmt = (iso: string) => new Date(iso).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div style={{ padding: '4px 0 24px' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder={t('audit.searchPlaceholder', { defaultValue: 'ابحث عن إجراء، مستخدم…' })}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            flex: 1, minWidth: 180, padding: '7px 12px',
            borderRadius: 8, border: '1px solid var(--border, rgba(255,255,255,.1))',
            background: 'var(--surface2, #1e293b)', color: 'var(--text, #f1f5f9)',
            fontSize: 12, outline: 'none',
          }}
        />
        <select
          value={typeFilter}
          onChange={e => setType(e.target.value)}
          style={{
            padding: '7px 10px', borderRadius: 8,
            border: '1px solid var(--border, rgba(255,255,255,.1))',
            background: 'var(--surface2, #1e293b)', color: 'var(--text, #f1f5f9)',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">{t('audit.allTypes', { defaultValue: 'كل الأنواع' })}</option>
          {targetTypes.map(tt => <option key={tt} value={tt}>{tt}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: '7px 14px', borderRadius: 8,
            border: '1px solid var(--border, rgba(255,255,255,.1))',
            background: 'var(--surface2, #1e293b)', color: 'var(--text, #f1f5f9)',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          ↻ {t('common.refresh')}
        </button>
        <button
          type="button"
          onClick={() => exportToCsv(filtered)}
          disabled={filtered.length === 0}
          style={{
            padding: '7px 14px', borderRadius: 8,
            border: '1px solid var(--border, rgba(255,255,255,.1))',
            background: 'var(--surface2, #1e293b)', color: 'var(--acc, #6366f1)',
            fontSize: 12, cursor: 'pointer', fontWeight: 600,
          }}
        >
          ⬇ {t('audit.exportCsv', { defaultValue: 'تصدير CSV' })}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted, #94a3b8)', marginInlineStart: 'auto' }}>
          {filtered.length} {t('audit.record', { defaultValue: 'سجل' })}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          ⏳ {t('common.loading', { defaultValue: 'جاري التحميل…' })}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          <span style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>📋</span>
          {t('audit.noRecords', { defaultValue: 'لا توجد سجلات' })}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,.08))' }}>
                {[
                  t('audit.col.time',       { defaultValue: 'الوقت' }),
                  t('audit.col.user',       { defaultValue: 'المستخدم' }),
                  t('audit.col.action',     { defaultValue: 'الإجراء' }),
                  t('audit.col.targetType', { defaultValue: 'النوع' }),
                  t('audit.col.targetId',   { defaultValue: 'المعرف' }),
                  t('audit.col.details',    { defaultValue: 'التفاصيل' }),
                ].map(col => (
                  <th key={col} style={{
                    padding: '8px 10px', textAlign: 'start', fontWeight: 600,
                    color: 'var(--muted, #94a3b8)', textTransform: 'uppercase',
                    letterSpacing: '.05em', fontSize: 10, whiteSpace: 'nowrap',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid var(--border, rgba(255,255,255,.05))',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)')}
                >
                  <td style={{ padding: '8px 10px', color: 'var(--muted, #94a3b8)', whiteSpace: 'nowrap' }}>
                    {fmt(row.created_at)}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>
                    {row.username ?? <span style={{ color: 'var(--muted, #94a3b8)', fontStyle: 'italic' }}>system</span>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 5,
                      background: `${actionColor(row.action)}18`,
                      color: actionColor(row.action),
                      fontWeight: 600, fontSize: 11,
                    }}>
                      {row.action}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--muted, #94a3b8)' }}>
                    {row.target_type ?? '—'}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--muted, #94a3b8)' }}>
                    {row.target_id ?? '—'}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--muted, #94a3b8)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.details
                      ? (() => { try { return JSON.stringify(JSON.parse(row.details), null, 0).slice(0, 80); } catch { return row.details.slice(0, 80); } })()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
