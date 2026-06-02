import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { AiProvidersPanel } from '../components/AiProvidersPanel';
import { OllamaEmbeddedPanel } from '../components/OllamaEmbeddedPanel';
import { SocialPlatformsPanel } from '../components/SocialPlatformsPanel';
import { useAiSettings } from '../hooks/useAiSettings';
import { Btn, Card, Field, Input, Msg, Panel } from '../../../ui';

type SettingsTab = 'general' | 'ai' | 'social' | 'privacy' | 'about';

export function SettingsScreen() {
  const { t } = useTranslation();
  const location = useLocation();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ai = useAiSettings();

  const [torStatus, setTorStatus] = useState<any>(null);
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
          setTorStatus(res.data);
        }
      } catch {}
    };
    void fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    const st = (location.state as { tab?: string } | null)?.tab;
    if (st === 'ai' || st === 'social' || st === 'general' || st === 'privacy' || st === 'about') setTab(st as SettingsTab);
  }, [location.state]);

  async function save(key: string, value: string) {
    setMsg(null);
    const res = await window.eyespro.settings.set(key, value);
    setMsg({ ok: res.ok, text: res.ok ? t('settings.saved') : t('settings.saveFailed') });
    void load();
  }

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'general', label: t('settings.general'), icon: '⚙️' },
    { id: 'privacy', label: 'الخصوصية والأمان', icon: '🛡️' },
    { id: 'ai', label: t('settings.groupAi'), icon: '🤖' },
    { id: 'social', label: t('settings.groupSocial'), icon: '📱' },
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
              <Card title="البروكسي (لتشغيل TikTok والمنصات الصعبة)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)' }}>
                    أدخل بروكسي سكنياً مدفوعاً لرصد المنصات التي تحجب الطلبات الآلية (مثل TikTok).
                    إذا تركت الحقل فارغاً يستخدم البرنامج البروكسيات المجانية تلقائياً.
                    <br />
                    الصيغة المدعومة:&nbsp;
                    <code dir="ltr" style={{ color: 'var(--t1)' }}>host:port</code> أو&nbsp;
                    <code dir="ltr" style={{ color: 'var(--t1)' }}>http://user:pass@host:port</code>
                  </p>
                  <Field label="عنوان البروكسي">
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
                          مسح
                        </Btn>
                      ) : null}
                    </div>
                  </Field>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--t3)' }}>
                    {settings.custom_proxy
                      ? '✓ بروكسي مخصّص مُفعّل — له الأولوية على البروكسيات المجانية.'
                      : 'لا يوجد بروكسي مخصّص — يُستخدم البروكسي المجاني التلقائي.'}
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
            </>
          )}
          {tab === 'privacy' && (
            <Card title="إعدادات الخصوصية وشبكة التخفي Tor">
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
                  تتيح لك شبكة Tor المدمجة تجاوز حجب المواقع بنسبة 100% ورصد المنافسين دون الكشف عن هويتك الرقمية أو التعرض لتقييد الطلبات (Rate Limiting). يتم توجيه جميع عمليات جلب المصادر والمنافسين وتنزيل الفيديوهات عبرها تلقائياً عند التفعيل.
                </p>

                {/* Tor Activation Toggle */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.02)', padding: '12px 16px',
                  borderRadius: 10, border: '1px solid var(--border)'
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>تفعيل توجيه حركة المرور عبر Tor</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>قم بتشغيل محرك Tor الداخلي لحماية اتصالات الزاحف وجلب المحتوى.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={torStatus?.enabled ?? false}
                    style={{ width: 20, height: 20, cursor: 'pointer' }}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setTorStatus((prev: any) => prev ? { ...prev, enabled: checked } : null);
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)' }}>حالة شبكة Tor الحالية</span>
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
                          {torStatus.status === 'ready' ? 'متصل وجاهز' : torStatus.status === 'starting' ? 'جاري الاتصال...' : 'متوقف / خطأ'}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--t2)', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: 6 }}>
                      {torStatus.bootstrap || 'لا توجد معلومات إضافية عن الاتصال.'}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--t3)' }}>منفذ وكيل SOCKS5 Proxy</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', marginTop: 4, fontFamily: 'monospace' }}>127.0.0.1:{torStatus.socksPort || 9050}</div>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--t3)' }}>منفذ التحكم Control Port</div>
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
                            setMsg({
                              ok: res?.ok && (res as any).data?.success,
                              text: res?.ok && (res as any).data?.success ? 'تم تدوير هوية Tor بنجاح وبناء مسار اتصال جديد.' : 'فشل تدوير هوية Tor. يرجى المحاولة لاحقاً.'
                            });
                          }}
                        >
                          {rotating ? 'جاري التدوير وبناء الدائرة...' : '🔄 تدوير الهوية الرقمية (IP Rotation) الآن'}
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
          {tab === 'social' && <SocialPlatformsPanel />}
          {tab === 'about' && (
            <Card title={t('settings.about')}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--t2)' }}>
                {t('settings.aboutText')} — {window.eyespro.app.copyright()}
              </p>
            </Card>
          )}
        </div>
      </div>
    </Panel>
  );
}
