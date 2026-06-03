import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Input, Msg } from '../../../ui';
import type { BackupInfo, BackupStatus } from '../../../../../shared/api-types';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(locale); } catch { return iso; }
}

export function BackupPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ar';
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [list, setList] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const unwrap = <T,>(r: { ok: boolean; data?: T; error?: string }): T | null => (r.ok ? r.data ?? null : null);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      window.eyespro.backup.status().catch(() => ({ ok: false }) as never),
      window.eyespro.backup.list().catch(() => ({ ok: false }) as never),
    ]);
    setStatus(unwrap(s));
    setList(unwrap(l) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, okText: string): Promise<{ ok: boolean; data?: T } | null> {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r.ok) { setMsg({ ok: true, text: okText }); await load(); }
      else setMsg({ ok: false, text: r.error || t('common.error', { defaultValue: 'Error' }) });
      return r;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return null;
    } finally { setBusy(false); }
  }

  async function onBackupNow() {
    await run(() => window.eyespro.backup.create(), t('backup.doneCreate', { defaultValue: 'Backup created' }));
  }

  async function onExport() {
    const r = await run(() => window.eyespro.backup.export(passphrase || undefined), t('backup.doneExport', { defaultValue: 'Backup exported' }));
    if (r?.ok && (r.data as { canceled?: boolean })?.canceled) setMsg(null);
  }

  async function onImport() {
    if (!confirm(t('backup.confirmImport', { defaultValue: 'Restore from this backup? The app will restart and current data will be replaced.' }))) return;
    const r = await run(() => window.eyespro.backup.import(passphrase || undefined), t('backup.restarting', { defaultValue: 'Restoring… the app will restart' }));
    if (r?.ok && (r.data as { canceled?: boolean })?.canceled) setMsg(null);
  }

  async function onRestore(b: BackupInfo) {
    setConfirmId(null);
    await run(() => window.eyespro.backup.restore(b.path, passphrase || undefined), t('backup.restarting', { defaultValue: 'Restoring… the app will restart' }));
  }

  async function onToggleAuto() {
    if (!status) return;
    await run(() => window.eyespro.backup.setAuto(!status.autoEnabled), t('settings.saved', { defaultValue: 'Saved' }));
  }

  return (
    <Card title={t('backup.title', { defaultValue: 'Backup & restore' })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
        {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}

        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)' }}>
          {t('backup.desc', { defaultValue: 'Keep a safe copy of all your data (articles, sources, settings, connections). Backups are encrypted. Store a portable copy on an external drive to recover after a disk failure or on a new PC.' })}
        </p>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Badge tone={status?.autoEnabled ? 'ok' : 'muted'}>
            {status?.autoEnabled
              ? t('backup.autoOn', { defaultValue: 'Auto-backup: on (daily)' })
              : t('backup.autoOff', { defaultValue: 'Auto-backup: off' })}
          </Badge>
          <Btn size="sm" onClick={() => void onToggleAuto()} disabled={busy}>
            {status?.autoEnabled ? t('backup.disable', { defaultValue: 'Disable' }) : t('backup.enable', { defaultValue: 'Enable' })}
          </Btn>
          <span style={{ color: 'var(--t2)' }}>
            {t('backup.last', { defaultValue: 'Last backup:' })} {fmtDate(status?.lastBackupAt ?? null, locale)}
          </span>
          <span style={{ color: 'var(--t3)' }}>
            ({status?.count ?? 0} {t('backup.files', { defaultValue: 'files' })}, {fmtSize(status?.totalSize ?? 0)})
          </span>
        </div>

        {/* Primary actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="primary" onClick={() => void onBackupNow()} disabled={busy}>
            💾 {t('backup.now', { defaultValue: 'Back up now' })}
          </Btn>
          <Btn onClick={() => void window.eyespro.backup.openFolder()} disabled={busy}>
            📂 {t('backup.openFolder', { defaultValue: 'Open backups folder' })}
          </Btn>
        </div>

        {/* Portable export / import */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t1)' }}>
            {t('backup.portable', { defaultValue: 'Portable copy (move to another PC / external drive)' })}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--t2)' }}>
            {t('backup.passHint', { defaultValue: 'Set a password to protect a portable copy. You will need the same password to restore it on another PC. Leave empty for a same-PC backup.' })}
          </p>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={t('backup.passPlaceholder', { defaultValue: 'Optional password for portable backup' })}
            style={{ maxWidth: 360 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn onClick={() => void onExport()} disabled={busy}>
              ⬆️ {t('backup.export', { defaultValue: 'Export to file…' })}
            </Btn>
            <Btn variant="danger" onClick={() => void onImport()} disabled={busy}>
              ⬇️ {t('backup.import', { defaultValue: 'Import & restore from file…' })}
            </Btn>
          </div>
        </div>

        {/* Existing backups */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t1)', marginBottom: 8 }}>
            {t('backup.existing', { defaultValue: 'Saved backups' })}
          </div>
          {list.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>{t('backup.none', { defaultValue: 'No backups yet.' })}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((b) => (
              <div key={b.path} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 12,
              }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="ltr" title={b.name}>
                  {b.name}
                </span>
                <span style={{ color: 'var(--t3)', whiteSpace: 'nowrap' }}>{fmtSize(b.size)}</span>
                <span style={{ color: 'var(--t3)', whiteSpace: 'nowrap' }}>{fmtDate(b.createdAt, locale)}</span>
                {confirmId === b.path ? (
                  <>
                    <Btn size="sm" variant="danger" onClick={() => void onRestore(b)} disabled={busy}>
                      {t('backup.confirm', { defaultValue: 'Confirm restore' })}
                    </Btn>
                    <Btn size="sm" onClick={() => setConfirmId(null)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Btn>
                  </>
                ) : (
                  <Btn size="sm" onClick={() => setConfirmId(b.path)} disabled={busy}>
                    ♻️ {t('backup.restore', { defaultValue: 'Restore' })}
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
