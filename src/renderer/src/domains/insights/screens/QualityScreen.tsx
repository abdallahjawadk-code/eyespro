import { useCallback, useEffect, useRef, useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Empty, Input, Loading, Msg, Panel, Select, Stat, StatGrid, Toolbar } from '../../../ui';

type QueueItem = { id: number; title: string; quality_score?: number; review_status?: string };

export function QualityScreen() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<{ workflow?: Record<string, number>; avgQuality?: number }>({});
  const [status, setStatus]   = useState('review');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);

  function toggleExpand(id: number) {
    setExpandedItemId((prev) => (prev === id ? null : id));
  }


  // Reject reason dialog state
  const [rejectId, setRejectId]       = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const rejectInputRef = useRef<HTMLInputElement>(null);

  // Stable load — status is passed as argument, not captured in closure
  const load = useCallback(async (st: string) => {
    setLoading(true);
    setError('');
    const [q, s] = await Promise.all([
      window.eyespro.quality.queue(st).catch(() => ({ ok: false, data: [] })),
      window.eyespro.quality.stats().catch(() => ({ ok: false, data: {} })),
    ]);
    if (q.ok && q.data) setQueue(q.data as QueueItem[]);
    else setError(t('common.loadError', { defaultValue: 'Failed to load data' }));
    if (s.ok && s.data) setStats(s.data as typeof stats);
    setLoading(false);
  }, [t]);

  const handleReCheck = useCallback(() => {
    void load(status);
  }, [load, status]);

  // Only status change drives reload
  useEffect(() => { void load(status); }, [status, load]);

  async function approve(id: number) {
    await window.eyespro.quality.approve(id);
    void load(status);
  }

  function openReject(id: number) {
    setRejectId(id);
    setRejectReason('');
    setTimeout(() => rejectInputRef.current?.focus(), 50);
  }

  async function confirmReject() {
    if (rejectId === null) return;
    await window.eyespro.quality.reject(rejectId, rejectReason.trim() || undefined);
    setRejectId(null);
    setRejectReason('');
    void load(status);
  }

  const wf = stats.workflow ?? {};

  return (
    <Panel>
      <Toolbar>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="review">{t('quality.inReview')}</option>
          <option value="approved">{t('quality.approved')}</option>
          <option value="rejected">{t('quality.rejected')}</option>
        </Select>
        <Btn onClick={() => void load(status)}>↻</Btn>
      </Toolbar>

      {error && <Msg tone="err" style={{ marginBottom: 12 }}>{error}</Msg>}

      <StatGrid>
        <Stat label={t('quality.inReview')} value={wf.in_review ?? wf.review ?? 0} accent="#f59e0b" />
        <Stat label={t('quality.approved')} value={wf.approved ?? 0}               accent="#22c55e" />
        <Stat label={t('quality.rejected')} value={wf.rejected ?? 0}               accent="#ef4444" />
        <Stat label={t('quality.avgScore')} value={Math.round(stats.avgQuality ?? 0)} accent="var(--acc)" />
      </StatGrid>

      {/* Inline reject dialog */}
      {rejectId !== null && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {t('quality.rejectReason', { defaultValue: 'Reason for rejection (optional)' })}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              ref={rejectInputRef}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('quality.rejectPlaceholder', { defaultValue: 'e.g. Low quality, factual error…' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmReject();
                if (e.key === 'Escape') { setRejectId(null); setRejectReason(''); }
              }}
              style={{ flex: 1 }}
            />
            <Btn variant="danger" onClick={() => void confirmReject()}>
              {t('quality.rejectConfirm', { defaultValue: 'Reject' })}
            </Btn>
            <Btn onClick={() => { setRejectId(null); setRejectReason(''); }}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Btn>
          </div>
        </div>
      )}

      {loading ? <Loading /> : queue.length === 0 ? (
        <Empty
          icon="✨"
          title={t('quality.emptyTitle', { defaultValue: 'No articles in this queue' })}
          desc={t('quality.emptyDesc', { defaultValue: 'Switch the filter or submit articles for review' })}
        />
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('articles.colTitle')}</th>
                <th>{t('quality.score')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => {
                const isExpanded = expandedItemId === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      style={{ cursor: 'pointer', background: isExpanded ? 'rgba(255,255,255,0.01)' : 'transparent' }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        toggleExpand(item.id);
                      }}
                    >
                      <td>{item.id}</td>
                      <td>{item.title}</td>
                      <td>
                        <Badge tone={item.quality_score && item.quality_score >= 60 ? 'ok' : item.quality_score ? 'warn' : 'muted'}>
                          {item.quality_score ?? '—'}
                        </Badge>
                      </td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <Btn size="sm" onClick={() => toggleExpand(item.id)}>
                          {isExpanded ? '▲' : '▼'}
                        </Btn>
                        {status === 'review' && (
                          <>
                            <Btn size="sm" variant="primary" onClick={() => void approve(item.id)}>✓</Btn>
                            <Btn size="sm" variant="danger"  onClick={() => openReject(item.id)}>✗</Btn>
                          </>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4} style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.02)' }}>
                          <QualityDetailsPanel itemId={item.id} onReCheck={handleReCheck} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

interface QualityDetailsPanelProps {
  itemId: number;
  onReCheck: () => void;
}

type QualityReport = { check_type?: string; score: number; result_json?: string };

function QualityDetailsPanel({ itemId, onReCheck }: QualityDetailsPanelProps) {
  const [reports, setReports] = useState<QualityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.eyespro.quality.reports(itemId);
      if (res.ok && res.data) {
        setReports(res.data as QualityReport[]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  async function triggerCheck() {
    setChecking(true);
    try {
      await window.eyespro.quality.check(itemId, 'full');
      await fetchReports();
      onReCheck();
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  }

  const latestReport = reports[0];

  const mapIssue = (issue: string) => {
    switch (issue) {
      case 'short_content': return 'المحتوى الإخباري قصير جداً (أقل من 200 حرف)';
      case 'missing_summary': return 'الملخص الإخباري غير مكتمل أو مفقود';
      case 'missing_image': return 'المقال لا يحتوي على صورة بارزة';
      default: return issue;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, direction: 'rtl', textAlign: 'right' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>📊 تفاصيل تقرير الجودة والملاءمة</h4>
        <Btn size="sm" onClick={triggerCheck} disabled={checking}>
          {checking ? '⏳ جاري الفحص...' : '🔄 إعادة الفحص'}
        </Btn>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>جاري استخراج التقارير الأخيرة...</div>
      ) : latestReport ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10,
          background: 'rgba(0, 0, 0, 0.2)', padding: '12px 16px',
          borderRadius: 8, border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', gap: 24, fontSize: 12, flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
            <span>نوع الفحص: <strong style={{ color: 'var(--acc)' }}>{latestReport.check_type === 'full' ? 'فحص شامل للنشر' : latestReport.check_type}</strong></span>
            <span>التقييم: <strong style={{ color: latestReport.score >= 60 ? '#22c55e' : '#ef4444' }}>{latestReport.score} / 100</strong></span>
            {latestReport.score >= 60 ? (
              <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ مستوفٍ لمعايير الجودة</span>
            ) : (
              <span style={{ color: '#ef4444', fontWeight: 600 }}>⚠️ يتطلب تحسينات قبل النشر</span>
            )}
          </div>

          {latestReport.result_json && (() => {
            try {
              const resData = JSON.parse(latestReport.result_json);
              const issues = resData.issues || [];
              const wordCount = resData.wordCount || 0;

              return (
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>عدد الكلمات الإجمالي: <strong>{wordCount} كلمة</strong></div>
                  
                  {issues.length > 0 ? (
                    <div>
                      <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 4 }}>الملاحظات والمخالفات المكتشفة:</div>
                      <ul style={{ margin: 0, paddingRight: 20, color: '#fca5a5', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {issues.map((iss: string, idx: number) => (
                          <li key={idx} style={{ listStyleType: 'disc' }}>{mapIssue(iss)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div style={{ color: '#4ade80', fontWeight: 600 }}>✨ رائع! لم يتم رصد أي أخطاء برمجية أو معايير جودة ناقصة. المقال جاهز تماماً.</div>
                  )}
                </div>
              );
            } catch {
              return <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>بيانات إضافية: {latestReport.result_json}</div>;
            }
          })()}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '10px 0' }}>
          لا يوجد سجل فحص سابق لهذا المقال. انقر على "إعادة الفحص" لبدء التقييم التلقائي.
        </div>
      )}
    </div>
  );
}
