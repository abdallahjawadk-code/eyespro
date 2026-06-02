import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './activity-heatmap.css';

interface Props {
  data: { date: string; count: number }[]; // ISO date → count
  weeks?: number;
}

const DAYS_AR = ['أح', 'إث', 'ث', 'أر', 'خ', 'ج', 'س'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function isoToDate(iso: string) { return new Date(iso + 'T00:00:00'); }

export function ActivityHeatmap({ data, weeks = 26 }: Props) {
  const { t } = useTranslation();

  const grid = useMemo(() => {
    const map = new Map(data.map(d => [d.date, d.count]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Go back `weeks` weeks from today
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - weeks * 7 + 1);

    const cols: { date: string; count: number; isToday: boolean; isFuture: boolean }[][] = [];
    let col: typeof cols[0] = [];

    // fill from startDate to today
    const cur = new Date(startDate);
    while (cur <= today) {
      const iso = cur.toISOString().slice(0, 10);
      col.push({
        date: iso,
        count: map.get(iso) ?? 0,
        isToday: cur.getTime() === today.getTime(),
        isFuture: false,
      });
      if (col.length === 7) { cols.push(col); col = []; }
      cur.setDate(cur.getDate() + 1);
    }
    if (col.length > 0) {
      // pad remaining days
      while (col.length < 7) {
        const nextDate = new Date(cur);
        col.push({ date: nextDate.toISOString().slice(0, 10), count: 0, isToday: false, isFuture: true });
        cur.setDate(cur.getDate() + 1);
      }
      cols.push(col);
    }

    return cols;
  }, [data, weeks]);

  const maxCount = useMemo(() => Math.max(1, ...data.map(d => d.count)), [data]);
  const totalArticles = useMemo(() => data.reduce((s, d) => s + d.count, 0), [data]);

  function intensity(count: number, future: boolean): number {
    if (future || count === 0) return 0;
    return Math.ceil((count / maxCount) * 4); // 1–4
  }

  // Month labels (show at column boundary)
  const monthLabels = useMemo(() => {
    const labels: { colIdx: number; label: string }[] = [];
    let lastMonth = -1;
    grid.forEach((col, i) => {
      const d = isoToDate(col[0].date);
      const m = d.getMonth();
      if (m !== lastMonth) {
        labels.push({ colIdx: i, label: MONTHS_AR[m] });
        lastMonth = m;
      }
    });
    return labels;
  }, [grid]);

  return (
    <div className="hm-root">
      <div className="hm-toprow">
        <span className="hm-title">
          📅 {t('dash.activityHeatmap', { defaultValue: 'نشاط النشر' })}
        </span>
        <span className="hm-total">
          {totalArticles} {t('dash.articlesTotal', { defaultValue: 'مقال' })} — {t('dash.last6Months', { defaultValue: 'آخر 6 أشهر' })}
        </span>
      </div>

      <div className="hm-scroll">
        {/* Month labels */}
        <div className="hm-months" style={{ gridTemplateColumns: `20px repeat(${grid.length}, 12px)` }}>
          <div />
          {grid.map((_, i) => {
            const label = monthLabels.find(m => m.colIdx === i);
            return <div key={i} className="hm-month-label">{label ? label.label : ''}</div>;
          })}
        </div>

        {/* Grid */}
        <div className="hm-grid-wrap">
          {/* Day labels */}
          <div className="hm-days">
            {DAYS_AR.map((d, i) => (
              <span key={i} className="hm-day-label">{i % 2 === 0 ? d : ''}</span>
            ))}
          </div>

          {/* Cells */}
          <div className="hm-cols">
            {grid.map((col, ci) => (
              <div key={ci} className="hm-col">
                {col.map((cell, ri) => {
                  const lvl = intensity(cell.count, cell.isFuture);
                  return (
                    <div
                      key={ri}
                      className={`hm-cell lvl-${lvl} ${cell.isToday ? 'today' : ''} ${cell.isFuture ? 'future' : ''}`}
                      title={cell.isFuture ? '' : `${cell.date}: ${cell.count}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="hm-legend">
          <span className="hm-legend-lbl">{t('dash.less', { defaultValue: 'أقل' })}</span>
          {[0, 1, 2, 3, 4].map(l => <div key={l} className={`hm-cell lvl-${l}`} />)}
          <span className="hm-legend-lbl">{t('dash.more', { defaultValue: 'أكثر' })}</span>
        </div>
      </div>
    </div>
  );
}
