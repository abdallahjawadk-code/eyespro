import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { AiProvidersPanel } from '../components/AiProvidersPanel';
import { OllamaEmbeddedPanel } from '../components/OllamaEmbeddedPanel';
import { VoicePanel } from '../components/VoicePanel';
import { BackupPanel } from '../components/BackupPanel';
import { UpdatePanel } from '../components/UpdatePanel';
import { useAiSettings } from '../hooks/useAiSettings';
import { Btn, Card, Field, Input, Msg, Panel } from '../../../ui';

type SettingsTab = 'general' | 'ai' | 'privacy' | 'backup' | 'about';

type TorStatus = {
  enabled?: boolean;
  status?: string;
  bootstrap?: string;
  socksPort?: number;
  controlPort?: number;
};

export function SettingsScreen() {
  const { t } = useTranslation();
  const location = useLocation();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ai = useAiSettings();

  const [torStatus, setTorStatus] = useState<TorStatus | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    const res = await window.eyespro.settings.getAll().catch(() => ({ ok: false, data: {} }));
    if (res.ok && res.data) setSettings(res.data as Record<string, string>);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab !== 'privacy') return;
    const fetchStatus = async () => {
      try {
        const res = await window.eyespro.tor.status().catch(() => null);
        if (res?.ok && res?.data) {
          setTorStatus(res.data as TorStatus);
        }
      } catch {}
    };
    void fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    const st = (location.state as { tab?: string } | null)?.tab;
    if (st === 'ai' || st === 'general' || st === 'privacy' || st === 'backup' || st === 'about') setTab(st as SettingsTab);
  }, [location.state]);

  async function save(key: string, value: string) {
    setMsg(null);
    const res = await window.eyespro.settings.set(key, value);
    setMsg({ ok: res.ok, text: res.ok ? t('settings.saved') : t('settings.saveFailed') });
    void load();
  }

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'general', label: t('settings.general'), icon: '⚙️' },
    { id: 'privacy', label: t('settings.groupPrivacy', { defaultValue: 'Privacy & security' }), icon: '🛡️' },
    { id: 'ai', label: t('settings.groupAi'), icon: '🤖' },
    { id: 'backup', label: t('backup.tab', { defaultValue: 'Backup' }), icon: '💾' },
    { id: 'about', label: t('settings.about'), icon: 'ℹ️' },
  ];

  return (
    <Panel>
      <div className="ui-settings-layout">
        <nav className="ui-settings-nav">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ui-settings-nav-btn${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ui-settings-main">
          {msg && <div style={{ marginBottom: 12 }}><Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg></div>}
          {tab === 'general' && (
            <Card title={t('settings.general')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
                <Field label={t('settings.siteName')}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input value={settings.site_name ?? ''} onChange={(e) => setSettings((s) => ({ ...s, site_name: e.target.value }))} />
                    <Btn variant="primary" onClick={() => void save('site_name', settings.site_name ?? '')}>{t('common.save')}</Btn>
                  </div>
                </Field>
                <Field label={t('settings.defaultLang')}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input value={settings.default_lang ?? 'ar'} onChange={(e) => setSettings((s) => ({ ...s, default_lang: e.target.value }))} />
                    <Btn variant="primary" onClick={() => void save('default_lang', settings.default_lang ?? 'ar')}>{t('common.save')}</Btn>
                  </div>
                </Field>
              </div>
            </Card>
          )}
          {tab === 'general' && (
            <div style={{ marginTop: 16 }}>
              <Card title={t('proxy.title', { defaultValue: 'Proxy (for TikTok & hard-to-reach platforms)' })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)' }}>
                    {t('proxy.desc', { defaultValue: 'Enter a paid residential proxy to monitor platforms that block automated requests (like TikTok). Leave the field empty to use free proxies automatically.' })}
                    <br />
                    {t('proxy.format', { defaultValue: 'Supported format:' })}&nbsp;
                    <code dir="ltr" style={{ color: 'var(--t1)' }}>host:port</code> {t('common.or', { defaultValue: 'or' })}&nbsp;
                    <code dir="ltr" style={{ color: 'var(--t1)' }}>http://user:pass@host:port</code>
                  </p>
                  <Field label={t('proxy.address', { defaultValue: 'Proxy address' })}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Input
                        dir="ltr"
                        placeholder="http://user:pass@host:port"
                        value={settings.custom_proxy ?? ''}
                        onChange={(e) => setSettings((s) => ({ ...s, custom_proxy: e.target.value }))}
                      />
                      <Btn variant="primary" onClick={() => void save('custom_proxy', (settings.custom_proxy ?? '').trim())}>
                        {t('common.save')}
                      </Btn>
                      {settings.custom_proxy ? (
                        <Btn onClick={() => { setSettings((s) => ({ ...s, custom_proxy: '' })); void save('custom_proxy', ''); }}>
                          {t('common.clear', { defaultValue: 'Clear' })}
                        </Btn>
                      ) : null}
                    </div>
                  </Field>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--t3)' }}>
                    {settings.custom_proxy
                      ? t('proxy.customOn', { defaultValue: '✓ Custom proxy enabled — it takes priority over the free proxies.' })
                      : t('proxy.customOff', { defaultValue: 'No custom proxy — the automatic free proxy is used.' })}
                  </p>
                </div>
              </Card>
            </div>
          )}
          {tab === 'ai' && (
            <>
              <Card title={t('settings.aiProvidersAndModels')}>
                <AiProvidersPanel {...ai} />
              </Card>
              <div style={{ marginTop: 16 }}>
                <Card title={t('ollama.title')}>
                  <OllamaEmbeddedPanel />
                </Card>
              </div>
              <div style={{ marginTop: 16 }}><VoicePanel /></div>
            </>
          )}
          {tab === 'privacy' && (
            <Card title={t('tor.cardTitle', { defaultValue: 'Privacy & Tor stealth network settings' })}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
                <style>{`
                  @keyframes pulseGlow {
                    0% { transform: scale(0.92); opacity: 0.7; }
                    50% { transform: scale(1.08); opacity: 1; }
                    100% { transform: scale(0.92); opacity: 0.7; }
                  }
                  .pulsing-dot-tor {
                    animation: pulseGlow 1.8s infinite ease-in-out;
                  }
                `}</style>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--t2)' }}>
                  {t('tor.desc', { defaultValue: 'The built-in Tor network lets you bypass site blocks completely and monitor competitors without exposing your digital identity or hitting rate limits. When enabled, all source/competitor fetching and video downloads are routed through it automatically.' })}
                </p>

                {/* Tor Activation Toggle */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.02)', padding: '12px 16px',
                  borderRadius: 10, border: '1px solid var(--border)'
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>{t('tor.toggleTitle', { defaultValue: 'Route traffic through Tor' })}</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{t('tor.toggleDesc', { defaultValue: 'Start the internal Tor engine to protect crawler and content-fetch connections.' })}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={torStatus?.enabled ?? false}
                    style={{ width: 20, height: 20, cursor: 'pointer' }}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setTorStatus((prev) => prev ? { ...prev, enabled: checked } : null);
                      await window.eyespro.tor.toggle(checked).catch(() => null);
                      void load();
                    }}
                  />
                </div>

                {/* Tor Status Panel */}
                {torStatus?.enabled && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 14,
                    background: 'rgba(0, 0, 0, 0.15)', padding: '16px',
                    borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.04)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)' }}>{t('tor.statusTitle', { defaultValue: 'Current Tor network status' })}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="pulsing-dot-tor" style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: torStatus.status === 'ready' ? 'var(--ok)' : torStatus.status === 'starting' ? 'var(--warn)' : 'var(--err)',
                          boxShadow: torStatus.status === 'ready' ? '0 0 8px var(--ok)' : torStatus.status === 'starting' ? '0 0 8px var(--warn)' : '0 0 8px var(--err)'
                        }} />
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: torStatus.status === 'ready' ? 'var(--ok)' : torStatus.status === 'starting' ? 'var(--warn)' : 'var(--err)'
                        }}>
                          {torStatus.status === 'ready' ? t('tor.ready', { defaultValue: 'Connected & ready' }) : torStatus.status === 'starting' ? t('tor.starting', { defaultValue: 'Connecting…' }) : t('tor.stopped', { defaultValue: 'Stopped / error' })}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--t2)', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: 6 }}>
                      {torStatus.bootstrap || t('tor.noInfo', { defaultValue: 'No additional connection info.' })}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--t3)' }}>{t('tor.socksPort', { defaultValue: 'SOCKS5 proxy port' })}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginTop: 4, fontFamily: 'monospace' }}>127.0.0.1:{torStatus.socksPort || 9050}</div>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--t3)' }}>{t('tor.controlPort', { defaultValue: 'Control port' })}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginTop: 4, fontFamily: 'monospace' }}>127.0.0.1:{torStatus.controlPort || 9051}</div>
                      </div>
                    </div>

                    {torStatus.status === 'ready' && (
                      <div style={{ marginTop: 6 }}>
                        <Btn
                          variant="primary"
                          disabled={rotating}
                          style={{ width: '100%', padding: '8px 0', fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={async () => {
                            setRotating(true);
                            const res = await window.eyespro.tor.rotate().catch(() => ({ ok: false }));
                            setRotating(false);
                            const rotated = Boolean(res?.ok && (res as { data?: { success?: boolean } }).data?.success);
                            setMsg({
                              ok: rotated,
                              text: rotated ? t('tor.rotated', { defaultValue: 'Tor identity rotated successfully and a new circuit was built.' }) : t('tor.rotateFailed', { defaultValue: 'Failed to rotate Tor identity. Please try again later.' })
                            });
                          }}
                        >
                          {rotating ? t('tor.rotating', { defaultValue: 'Rotating & building circuit…' }) : t('tor.rotateBtn', { defaultValue: '🔄 Rotate digital identity (IP rotation) now' })}
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
          {tab === 'backup' && <BackupPanel />}
          {tab === 'about' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <UpdatePanel />
              <Card title={t('settings.about')}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--t2)' }}>
                  {t('settings.aboutText')} — {window.eyespro.app.copyright()}
                </p>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
