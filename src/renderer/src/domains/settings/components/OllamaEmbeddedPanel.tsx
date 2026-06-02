import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type OllamaStatus = {
  enabled: boolean;
  binaryFound: boolean;
  binaryPath: string | null;
  running: boolean;
  weStarted: boolean;
  manageProcess: boolean;
  baseUrl: string;
  modelsDir: string;
};

type Recommended = { name: string; label: string; sizeHint: string; note: string };

type LocalModel = { name: string; size?: number };

type InstallProgress = {
  phase: string;
  message: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  done?: boolean;
  error?: string;
};

function formatBytes(n?: number): string {
  if (n == null || n < 0) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function formatSpeed(bps?: number): string {
  if (!bps || bps < 1) return '—';
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export function OllamaEmbeddedPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [recommended, setRecommended] = useState<Recommended[]>([]);
  const [local, setLocal] = useState<LocalModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullLog, setPullLog] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [st, rec, loc] = await Promise.all([
      window.eyespro.ollama.status(),
      window.eyespro.ollama.recommended(),
      window.eyespro.ollama.localModels(),
    ]);
    if (st.ok && st.data) setStatus(st.data as OllamaStatus);
    if (rec.ok && rec.data) setRecommended(rec.data as Recommended[]);
    if (loc.ok && loc.data) setLocal(loc.data as LocalModel[]);
  }, []);

  useEffect(() => {
    void refresh();
    const unsubPull = window.eyespro.on?.('ollama:pullProgress', (p: { model: string; line: string; done?: boolean }) => {
      if (p.line) setPullLog((prev) => [...prev.slice(-40), p.line]);
      if (p.done) {
        setPulling(null);
        void refresh();
      }
    });
    const unsubInstall = window.eyespro.on?.('ollama:installProgress', (p: InstallProgress) => {
      setInstallProgress(p);
      if (p.done) {
        setInstalling(false);
        if (!p.error) {
          setMsg({ ok: true, text: t('ollama.installWingetOk') });
          void refresh();
        } else {
          setMsg({ ok: false, text: p.error });
        }
      }
    });
    return () => {
      unsubPull?.();
      unsubInstall?.();
    };
  }, [refresh, t]);

  async function toggleEnabled(on: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await window.eyespro.ollama.setEnabled(on);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: on ? t('ollama.enabledOk') : t('ollama.disabledOk') });
      void refresh();
    } else {
      setMsg({ ok: false, text: mapErr(res.error ?? '', t) });
    }
  }

  async function install() {
    setInstalling(true);
    setInstallProgress({ phase: 'starting', message: t('ollama.installStarting'), percent: 0 });
    setMsg(null);
    const winget = await window.eyespro.ollama.installWinget();
    if (!winget.ok) {
      setInstalling(false);
      setInstallProgress(null);
      await window.eyespro.ollama.openDownload();
      setMsg({ ok: false, text: winget.error ?? t('ollama.installManual') });
    }
  }

  async function pullModel(name: string) {
    setPulling(name);
    setPullLog([]);
    setMsg(null);
    const res = await window.eyespro.ollama.pull(name);
    setPulling(null);
    if (res.ok) {
      setMsg({ ok: true, text: t('ollama.pullOk', { name }) });
      void refresh();
    } else {
      setMsg({ ok: false, text: mapErr(res.error ?? '', t) });
    }
  }

  async function deleteModel(name: string) {
    if (!confirm(t('ollama.deleteConfirm', { name }))) return;
    await window.eyespro.ollama.deleteModel(name);
    void refresh();
  }

  const enabled = status?.enabled ?? false;
  const pct = Math.min(100, Math.max(0, installProgress?.percent ?? 0));

  return (
    <div className="sp-group-card" style={{ marginTop: 16 }}>
      <div className="sp-group-hdr" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>🖥 {t('ollama.title')}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || installing}
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          {t('ollama.enableBuiltin')}
        </label>
      </div>
      <div className="sp-group-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--t2)', lineHeight: 1.6 }}>
          {t('ollama.desc')}
        </p>

        {msg && <div className={msg.ok ? 'ok-banner' : 'err-banner'}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, fontSize: 'var(--text-xs)' }}>
          <StatusChip label={t('ollama.chipInstalled')} ok={!!status?.binaryFound} />
          <StatusChip label={t('ollama.chipRunning')} ok={!!status?.running} />
          <StatusChip label={t('ollama.chipManaged')} ok={!!status?.weStarted || !!status?.running} />
        </div>

        {status && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--t3)', wordBreak: 'break-all' }}>
            {status.binaryPath && (
              <div>
                {t('ollama.binary')}: {status.binaryPath}
              </div>
            )}
            <div>
              {t('ollama.api')}: {status.baseUrl}
            </div>
            <div>
              {t('ollama.modelsDir')}: {status.modelsDir}
            </div>
          </div>
        )}

        {!status?.binaryFound && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || installing} onClick={() => void install()}>
              {installing ? t('ollama.installing') : t('ollama.install')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || installing}
              onClick={() => void window.eyespro.ollama.openDownload()}
            >
              {t('ollama.downloadPage')}
            </button>
          </div>
        )}

        {(installing || installProgress) && (
          <div className="ollama-install-box">
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--t1)' }}>
              {t('ollama.installProgress')}
            </div>
            <div className="ollama-install-track">
              <div className="ollama-install-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="ollama-install-meta">
              <span>
                {pct}% — {installProgress?.message?.slice(0, 80) || t('ollama.installStarting')}
              </span>
              <span>
                {formatBytes(installProgress?.downloadedBytes)} / {formatBytes(installProgress?.totalBytes)}
              </span>
              <span>
                {t('ollama.speed')}: {formatSpeed(installProgress?.speedBps)}
              </span>
            </div>
          </div>
        )}

        {status?.binaryFound && !status.running && enabled && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void window.eyespro.ollama.start().then(() => refresh())}
          >
            {t('ollama.startEngine')}
          </button>
        )}

        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 8 }}>{t('ollama.recommended')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recommended.map((m) => (
              <div
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'var(--bg3)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--t3)' }}>
                    {m.name} · {m.sizeHint} · {m.note}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!!pulling || !status?.binaryFound}
                  onClick={() => void pullModel(m.name)}
                >
                  {pulling === m.name ? '⏳' : `⬇ ${t('ollama.pull')}`}
                </button>
              </div>
            ))}
          </div>
        </div>

        {pulling && (
          <div
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              maxHeight: 120,
              overflow: 'auto',
              background: 'var(--bg3)',
              padding: 8,
              borderRadius: 6,
            }}
          >
            {pullLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {local.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 8 }}>
              {t('ollama.installed')} ({local.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {local.map((m) => (
                <span
                  key={m.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    background: 'var(--bg3)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                >
                  {m.name}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0 4px', fontSize: 10 }}
                    onClick={() => void deleteModel(m.name)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)',
        color: ok ? 'var(--ok)' : 'var(--err)',
        border: `1px solid ${ok ? 'var(--ok)' : 'var(--err)'}`,
      }}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

function mapErr(code: string, t: (k: string) => string): string {
  if (code === 'OLLAMA_NOT_INSTALLED') return t('ollama.errNotInstalled');
  if (code === 'OLLAMA_START_TIMEOUT') return t('ollama.errStartTimeout');
  if (code === 'OLLAMA_NOT_RUNNING') return t('ollama.errNotRunning');
  return code;
}
