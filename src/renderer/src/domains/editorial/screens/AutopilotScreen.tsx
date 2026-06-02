import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AutopilotConfig, AutopilotProgress, AutopilotRunRow, AutopilotStatus } from '../../../../../shared/api-types';
import { Btn, Field, Input, Loading, Msg, Panel, Select, Toolbar } from '../../../ui';
import './autopilot.css';

const GEO_OPTIONS = ['SA', 'EG', 'AE', 'JO', 'KW', 'QA', 'LB', 'MA', 'US', 'GB'];

const FLOW_STEPS = [
  { id: 'fetch', icon: '🔭' },
  { id: 'dedup', icon: '🛡️' },
  { id: 'generate', icon: '✍️' },
  { id: 'pipeline', icon: '⚙️' },
  { id: 'review', icon: '✅' },
] as const;

function parseRunResult(row: AutopilotRunRow): { generated: number; errors: string[]; warnings: string[] } | null {
  if (!row.result_json) return null;
  try {
    const r = JSON.parse(row.result_json) as { generated?: number; errors?: string[]; warnings?: string[] };
    return { generated: r.generated ?? 0, errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } catch {
    return null;
  }
}

export function AutopilotScreen() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [runs, setRuns] = useState<AutopilotRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activePhase, setActivePhase] = useState<string>('fetch');
  const [log, setLog] = useState<AutopilotProgress[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [st, cfg, hist] = await Promise.all([
      window.eyespro.autopilot.status(),
      window.eyespro.autopilot.config(),
      window.eyespro.autopilot.runs(12),
    ]);
    if (st.ok && st.data) setStatus(st.data);
    if (cfg.ok && cfg.data) setConfig(cfg.data);
    if (hist.ok && hist.data) setRuns(hist.data);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off = window.eyespro.on?.('autopilot:progress', (p: unknown) => {
      const progress = p as AutopilotProgress;
      setActivePhase(progress.phase === 'select' ? 'fetch' : progress.phase);
      setLog(prev => [...prev.slice(-24), progress]);
    });
    return () => {
      off?.();
    };
  }, []);

  async function patchConfig(partial: Partial<AutopilotConfig>) {
    if (!config) return;
    setSaving(true);
    const next = { ...config, ...partial };
    setConfig(next);
    await window.eyespro.autopilot.setConfig(partial);
    setSaving(false);
    void refresh();
  }

  async function onRun() {
    setMsg(null);
    setLog([]);
    setRunning(true);
    setActivePhase('fetch');
    const res = await window.eyespro.autopilot.run();
    setRunning(false);
    if (res.ok && res.data) {
      const d = res.data;
      setMsg({
        ok: d.ok,
        text: t('autopilot.runDone', {
          generated: d.generated,
          skipped: d.duplicatesSkipped,
          pipeline: d.pipelineOk,
        }),
      });
    } else {
      setMsg({ ok: false, text: res.error ?? t('autopilot.runFailed') });
    }
    void refresh();
  }

  async function onStop() {
    await window.eyespro.autopilot.stop();
  }

  if (loading || !config) return <Loading label={t('autopilot.loading')} />;

  const crisis = config.crisisMode;
  const isActive = running || status?.running;

  return (
    <Panel>
      <div className={`autopilot-hero ${crisis ? 'crisis' : ''}`}>
        <div className="autopilot-hero-inner">
          <div>
            <div className="autopilot-kicker">
              <span className={`autopilot-kicker-dot ${crisis ? 'crisis' : ''} ${isActive ? 'is-running' : ''}`} />
              EyesPro Autopilot
            </div>
            <h2 className="autopilot-title">{t('autopilot.title')}</h2>
            <p className="autopilot-desc">{t('autopilot.description')}</p>
            <div className="autopilot-stats">
              <div className="autopilot-stat">
                <div className="autopilot-stat-val">{status?.pendingTrends ?? 0}</div>
                <div className="autopilot-stat-label">{t('autopilot.pendingTrends')}</div>
              </div>
              <div className="autopilot-stat">
                <div className="autopilot-stat-val">{config.maxPerRun}{crisis ? '×2' : ''}</div>
                <div className="autopilot-stat-label">{t('autopilot.maxPerRun')}</div>
              </div>
              <div className="autopilot-stat">
                <div className="autopilot-stat-val">{config.geo}</div>
                <div className="autopilot-stat-label">{t('autopilot.region')}</div>
              </div>
            </div>
          </div>
          <div className="autopilot-actions">
            <button
              type="button"
              className={`autopilot-run-btn ${crisis ? 'crisis' : ''}`}
              disabled={running}
              onClick={() => void onRun()}
            >
              {running ? t('autopilot.running') : crisis ? t('autopilot.runCrisis') : t('autopilot.runNow')}
            </button>
            {running && (
              <button type="button" className="autopilot-stop-btn" onClick={() => void onStop()}>
                {t('autopilot.stop')}
              </button>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 16 }}>
          <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>
        </div>
      )}

      <Toolbar>
        <Btn onClick={() => void refresh()} disabled={running}>↻ {t('common.refresh')}</Btn>
        {saving && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t('autopilot.saving')}</span>}
      </Toolbar>

      <div className="autopilot-grid">
        <div className="autopilot-panel">
          <h3 className="autopilot-panel-title">🔄 {t('autopilot.flowTitle')}</h3>
          <div className="autopilot-flow">
            {FLOW_STEPS.map((step, i) => (
              <div
                key={step.id}
                className={`autopilot-flow-step ${activePhase === step.id || (running && step.id === 'fetch' && activePhase === 'fetch') ? 'is-active' : ''}`}
              >
                <span className="autopilot-flow-num">{i + 1}</span>
                <span>{step.icon} {t(`autopilot.steps.${step.id}`)}</span>
              </div>
            ))}
          </div>
          <div className="autopilot-links">
            <Link to="/articles" className="autopilot-link-btn">{t('autopilot.openKanban')}</Link>
            <Link to="/content?tab=trends" className="autopilot-link-btn">{t('autopilot.openTrends')}</Link>
          </div>
        </div>

        <div className="autopilot-panel">
          <h3 className="autopilot-panel-title">⚙️ {t('autopilot.configTitle')}</h3>
          <div className="autopilot-config-grid">
            <div className={`autopilot-toggle-row ${crisis ? 'crisis' : ''}`}>
              <div>
                <div className="autopilot-toggle-label">{t('autopilot.crisisMode')}</div>
                <div className="autopilot-toggle-hint">{t('autopilot.crisisHint')}</div>
              </div>
              <input
                type="checkbox"
                checked={config.crisisMode}
                onChange={e => void patchConfig({ crisisMode: e.target.checked })}
              />
            </div>
            <div className="autopilot-toggle-row">
              <div>
                <div className="autopilot-toggle-label">{t('autopilot.autoPipeline')}</div>
                <div className="autopilot-toggle-hint">{t('autopilot.autoPipelineHint')}</div>
              </div>
              <input
                type="checkbox"
                checked={config.autoPipeline}
                onChange={e => void patchConfig({ autoPipeline: e.target.checked })}
              />
            </div>
            <div className="autopilot-toggle-row">
              <div>
                <div className="autopilot-toggle-label">{t('autopilot.dedup')}</div>
                <div className="autopilot-toggle-hint">{t('autopilot.dedupHint')}</div>
              </div>
              <input
                type="checkbox"
                checked={config.dedupEnabled}
                onChange={e => void patchConfig({ dedupEnabled: e.target.checked })}
              />
            </div>
            <div className="autopilot-toggle-row">
              <div>
                <div className="autopilot-toggle-label">{t('autopilot.scheduled')}</div>
                <div className="autopilot-toggle-hint">{t('autopilot.scheduledHint')}</div>
              </div>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={e => void patchConfig({ enabled: e.target.checked })}
              />
            </div>
            <Field label={t('autopilot.region')}>
              <Select value={config.geo} onChange={e => void patchConfig({ geo: e.target.value })}>
                {GEO_OPTIONS.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('autopilot.maxPerRun')}>
              <Input
                type="number"
                min={1}
                max={20}
                value={config.maxPerRun}
                onChange={e => void patchConfig({ maxPerRun: Number(e.target.value) || 3 })}
              />
            </Field>
            <Field label={t('autopilot.intervalMin')}>
              <Input
                type="number"
                min={0}
                max={1440}
                value={config.intervalMin}
                onChange={e => void patchConfig({ intervalMin: Number(e.target.value) || 0 })}
              />
            </Field>
            <div className="autopilot-toggle-row">
              <div>
                <div className="autopilot-toggle-label">{t('autopilot.fetchGoogle')}</div>
              </div>
              <input
                type="checkbox"
                checked={config.fetchGoogle}
                onChange={e => void patchConfig({ fetchGoogle: e.target.checked })}
              />
            </div>
          </div>
        </div>

        <div className="autopilot-panel">
          <h3 className="autopilot-panel-title">📡 {t('autopilot.liveLog')}</h3>
          <div className="autopilot-log">
            {log.length === 0 ? (
              <p style={{ color: 'var(--t3)', fontSize: 12, margin: 0 }}>{t('autopilot.logEmpty')}</p>
            ) : (
              log.map((item, i) => (
                <div
                  key={i}
                  className={`autopilot-log-item phase-${item.phase}`}
                >
                  {item.message}
                  {item.current != null && item.total != null && (
                    <span style={{ opacity: 0.7 }}> ({item.current}/{item.total})</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="autopilot-panel">
          <h3 className="autopilot-panel-title">📋 {t('autopilot.history')}</h3>
          {runs.length === 0 ? (
            <p style={{ color: 'var(--t3)', fontSize: 12 }}>{t('autopilot.noRuns')}</p>
          ) : (
            <table className="autopilot-runs-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('autopilot.colTime')}</th>
                  <th>{t('autopilot.colStatus')}</th>
                  <th>{t('autopilot.colResult')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => {
                  const parsed = parseRunResult(r);
                  return (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{new Date(r.started_at).toLocaleString('ar')}</td>
                      <td>{r.status}</td>
                      <td>
                        {parsed ? `${parsed.generated} ${t('autopilot.articles')}` : '—'}
                        {/* v2.0: Show errors (critical) in red, warnings (non-critical) in orange */}
                        {parsed?.errors?.[0] ? (
                          <span style={{ color: 'var(--err)', display: 'block', fontSize: 10 }}>
                            {parsed.errors[0].slice(0, 60)}
                          </span>
                        ) : parsed?.warnings?.[0] ? (
                          <span style={{ color: 'var(--warn)', display: 'block', fontSize: 10 }}>
                            {parsed.warnings[0].slice(0, 60)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}
