import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Msg } from '../../../ui';
import type { UpdaterStatus, UpdaterProgress } from '../../../../../shared/api-types';

export function UpdatePanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [progress, setProgress] = useState<UpdaterProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await window.eyespro.updater.status().catch(() => ({ ok: false }) as never);
    if (r.ok) setStatus(r.data as UpdaterStatus);
  }, []);

  useEffect(() => {
    void refresh();
    const sub = window.eyespro.on;
    if (!sub) return;
    const offStatus = sub('updater:status', (s) => setStatus(s as UpdaterStatus));
    const offProgress = sub('updater:progress', (p) => setProgress(p as UpdaterProgress));
    return () => { offStatus(); offProgress(); };
  }, [refresh]);

  async function onCheck() {
    setBusy(true); setMsg(null); setProgress(null);
    try {
      const r = await window.eyespro.updater.check();
      const s = r.ok ? (r.data as UpdaterStatus) : null;
      if (s) setStatus(s);
      if (s && !s.available && !s.error) setMsg({ ok: true, text: t('updater.upToDate', { defaultValue: 'You have the latest version.' }) });
      if (s?.error) setMsg({ ok: false, text: s.error });
    } finally { setBusy(false); }
  }

  async function onDownload() {
    setBusy(true); setMsg(null);
    try { await window.eyespro.updater.download(); }
    finally { setBusy(false); }
  }

  function onInstall() {
    void window.eyespro.updater.install();
  }

  const dev = status && status.currentVersion === '1.0.0' && !status.available && !status.checking;

  return (
    <Card title={t('updater.title', { defaultValue: 'App updates' })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ color: 'var(--t2)' }}>{t('updater.current', { defaultValue: 'Current version:' })}</span>
          <Badge tone="muted"><span dir="ltr">v{status?.currentVersion ?? '—'}</span></Badge>
          {status?.available && !status.downloaded && (
            <Badge tone="warn">{t('updater.available', { defaultValue: 'Update available:' })} <span dir="ltr">v{status.version}</span></Badge>
          )}
          {status?.downloaded && (
            <Badge tone="ok">{t('updater.ready', { defaultValue: 'Update ready to install:' })} <span dir="ltr">v{status.version}</span></Badge>
          )}
        </div>

        {/* Download progress */}
        {progress && !status?.downloaded && (
          <div>
            <div style={{ height: 8, borderRadius: 6, background: 'var(--bg2)', overflow: 'hidden' }}>
              <div style={{ width: `${progress.percent}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>
              {progress.percent}% · {(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!status?.downloaded && !status?.available && (
            <Btn variant="primary" onClick={() => void onCheck()} disabled={busy || status?.checking}>
              {status?.checking ? t('updater.checking', { defaultValue: 'Checking…' }) : t('updater.check', { defaultValue: 'Check for updates' })}
            </Btn>
          )}
          {status?.available && !status?.downloaded && (
            <Btn variant="primary" onClick={() => void onDownload()} disabled={busy}>
              ⬇️ {t('updater.download', { defaultValue: 'Download update' })}
            </Btn>
          )}
          {status?.downloaded && (
            <Btn variant="primary" onClick={onInstall}>
              ♻️ {t('updater.install', { defaultValue: 'Restart & install' })}
            </Btn>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--t3)' }}>
          {dev
            ? t('updater.devNote', { defaultValue: 'Auto-update runs only in the installed app, not in development.' })
            : t('updater.note', { defaultValue: 'Updates are downloaded securely and verified before installing. The app checks automatically on startup.' })}
        </p>
      </div>
    </Card>
  );
}
