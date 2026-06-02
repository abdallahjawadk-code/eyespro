import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Card, Field, Input, Msg } from '../../../ui';

type PlatformDef = {
  id: string;
  icon: string;
  name: string;
  fields: { key: string; labelKey: string; hintKey?: string }[];
};

const PLATFORMS: PlatformDef[] = [
  {
    id: 'telegram',
    icon: '✈️',
    name: 'Telegram',
    fields: [
      { key: 'telegram_bot_token', labelKey: 'settings.telegramToken' },
      { key: 'telegram_channel_id', labelKey: 'settings.telegramChat' },
    ],
  },
  {
    id: 'facebook',
    icon: '📘',
    name: 'Facebook',
    fields: [
      { key: 'facebook_page_token', labelKey: 'settings.facebookToken' },
      { key: 'facebook_page_id', labelKey: 'settings.facebookPageId' },
    ],
  },
  {
    id: 'twitter',
    icon: '🐦',
    name: 'Twitter / X',
    fields: [
      { key: 'twitter_api_key', labelKey: 'settings.twitterApiKey', hintKey: 'settings.hintTwitterApiKey' },
      { key: 'twitter_api_secret', labelKey: 'settings.twitterApiSecret', hintKey: 'settings.hintTwitterApiSecret' },
      { key: 'twitter_access_token', labelKey: 'settings.twitterAccessToken', hintKey: 'settings.hintTwitterAccessToken' },
      { key: 'twitter_access_secret', labelKey: 'settings.twitterAccessSecret', hintKey: 'settings.hintTwitterAccessSecret' },
      { key: 'twitter_bearer_token', labelKey: 'settings.twitterToken', hintKey: 'settings.hintTwitterBearerToken' },
    ],
  },
  {
    id: 'youtube',
    icon: '▶️',
    name: 'YouTube',
    fields: [{ key: 'youtube_access_token', labelKey: 'settings.youtubeAccessToken' }],
  },
  {
    id: 'linkedin',
    icon: '💼',
    name: 'LinkedIn',
    fields: [
      { key: 'linkedin_access_token', labelKey: 'settings.linkedinToken' },
      { key: 'linkedin_author_urn', labelKey: 'settings.linkedinUrn' },
    ],
  },
  {
    id: 'instagram',
    icon: '📸',
    name: 'Instagram',
    fields: [
      { key: 'instagram_app_id',       labelKey: 'settings.instagramAppId' },
      { key: 'instagram_app_secret',   labelKey: 'settings.instagramAppSecret' },
      { key: 'instagram_access_token', labelKey: 'settings.instagramToken' },
      { key: 'instagram_account_id',   labelKey: 'settings.instagramAccountId' },
    ],
  },
  {
    id: 'whatsapp',
    icon: '💬',
    name: 'WhatsApp',
    fields: [
      { key: 'whatsapp_api_url', labelKey: 'settings.whatsappUrl', hintKey: 'settings.hintWhatsappApiUrl' },
      { key: 'whatsapp_token',   labelKey: 'settings.whatsappToken', hintKey: 'settings.hintWhatsappToken' },
    ],
  },
];

// OAuth app credentials for the new social publishing system
type OAuthAppDef = { id: string; icon: string; name: string; clientIdKey: string; clientSecretKey: string };
const OAUTH_APPS: OAuthAppDef[] = [
  { id: 'facebook',  icon: '📘', name: 'Facebook / Instagram', clientIdKey: 'oauth_facebook_client_id',  clientSecretKey: 'oauth_facebook_client_secret'  },
  { id: 'youtube',   icon: '▶️', name: 'YouTube (Google)',      clientIdKey: 'oauth_youtube_client_id',   clientSecretKey: 'oauth_youtube_client_secret'   },
  { id: 'linkedin',  icon: '💼', name: 'LinkedIn',              clientIdKey: 'oauth_linkedin_client_id',  clientSecretKey: 'oauth_linkedin_client_secret'  },
  { id: 'twitter',   icon: '🐦', name: 'Twitter / X',           clientIdKey: 'oauth_twitter_client_id',   clientSecretKey: 'oauth_twitter_client_secret'   },
  { id: 'tiktok',    icon: '🎵', name: 'TikTok',                clientIdKey: 'oauth_tiktok_client_id',    clientSecretKey: 'oauth_tiktok_client_secret'    },
];

export function SocialPlatformsPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [youtubeConnecting, setYoutubeConnecting] = useState(false);
  const [youtubeCallbackUrl, setYoutubeCallbackUrl] = useState('');
  const [youtubePasting, setYoutubePasting] = useState(false);
  const [twitterProbing, setTwitterProbing] = useState(false);
  const [igConnecting, setIgConnecting] = useState(false);
  const [igConnected, setIgConnected]   = useState(false);
  const [igTesting,   setIgTesting]     = useState(false);

  const load = useCallback(async () => {
    const res = await window.eyespro.settings.getAll().catch(() => ({ ok: false, data: {} }));
    if (res.ok && res.data) setSettings(res.data as Record<string, string>);
    // Check Instagram connection status
    const igRes = await window.eyespro.instagram.loggedIn().catch(() => ({ ok: false, data: false }));
    setIgConnected(igRes.ok && !!igRes.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function savePlatform(plat: PlatformDef) {
    setMsg(null);
    for (const f of plat.fields) {
      const v = settings[f.key] ?? '';
      if (/^•{4}/u.test(v)) continue;
      await window.eyespro.settings.set(f.key, v);
    }
    setMsg({ ok: true, text: t('settings.saved') });
    await load();
  }

  async function testPlatform(plat: PlatformDef) {
    setTesting(plat.id);
    setTestMsg(null);
    for (const f of plat.fields) {
      const v = settings[f.key] ?? '';
      if (/^•{4}/u.test(v)) continue;
      await window.eyespro.settings.set(f.key, v);
    }
    const res = await window.eyespro.social.testPlatform(plat.id).catch(() => ({ ok: false as const, error: 'Network error' }));
    setTesting(null);
    setTestMsg({
      id: plat.id,
      ok: res.ok,
      text: res.ok ? t('settings.connectionOk') : (res.error ?? t('settings.connectionFail')),
    });
    if (res.ok) await load();
  }

  async function connectYoutubeOAuth() {
    setYoutubeConnecting(true);
    setMsg(null);
    const res = await window.eyespro.youtube.connectOAuth().catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setYoutubeConnecting(false);
    if (!res.ok) {
      if (res.error === 'cancelled' || (res as { code?: string }).code === 'CANCELLED') return;
      setMsg({ ok: false, text: res.error ?? t('settings.connectionFail') });
      return;
    }
    await load();
    const data = res.data as { channelTitle?: string; hasRefreshToken?: boolean } | undefined;
    let text = t('settings.youtubeConnectOk', {
      channel: data?.channelTitle
        ? t('settings.youtubeConnectChannelSuffix', { title: data.channelTitle })
        : '',
    });
    if (data?.hasRefreshToken === false) text += t('settings.youtubeConnectNoRefresh');
    setMsg({ ok: true, text });
  }

  async function completeYoutubeFromUrl() {
    const url = youtubeCallbackUrl.trim();
    if (!url) return;
    setYoutubePasting(true);
    setMsg(null);
    const res = await window.eyespro.youtube.completeOAuthFromUrl(url).catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setYoutubePasting(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error ?? t('settings.connectionFail') });
      return;
    }
    setYoutubeCallbackUrl('');
    await load();
    const data = res.data as { channelTitle?: string; hasRefreshToken?: boolean } | undefined;
    let text = t('settings.youtubeConnectOk', {
      channel: data?.channelTitle
        ? t('settings.youtubeConnectChannelSuffix', { title: data.channelTitle })
        : '',
    });
    if (data?.hasRefreshToken === false) text += t('settings.youtubeConnectNoRefresh');
    setMsg({ ok: true, text });
  }

  async function connectInstagramOAuth() {
    // Save app_id and app_secret first if the user typed them
    const igPlat = PLATFORMS.find((p) => p.id === 'instagram')!;
    for (const f of igPlat.fields) {
      const v = settings[f.key] ?? '';
      if (/^•{4}/u.test(v) || !v.trim()) continue;
      await window.eyespro.settings.set(f.key, v);
    }
    setIgConnecting(true);
    setMsg(null);
    const res = await window.eyespro.instagram.login().catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setIgConnecting(false);
    if (!res.ok) {
      if ((res as { error?: string }).error !== 'أُغلقت نافذة تسجيل الدخول') {
        setMsg({ ok: false, text: (res as { error?: string }).error ?? t('settings.connectionFail') });
      }
      return;
    }
    await load();
    setIgConnected(true);
    setMsg({
      ok: true,
      text: 'تم الاتصال بـ Instagram بنجاح ✅ — إذا كان النشر يفشل، اضغط «اختبار الاتصال» للتحقق من صلاحية النشر',
    });
  }

  async function disconnectInstagram() {
    setIgConnecting(true);
    await window.eyespro.instagram.disconnect().catch(() => undefined);
    setIgConnecting(false);
    setIgConnected(false);
    setMsg({ ok: true, text: 'تم قطع الاتصال بـ Instagram' });
  }

  async function testInstagram() {
    setIgTesting(true);
    setTestMsg(null);
    const res = await window.eyespro.instagram.test().catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setIgTesting(false);
    if (!res.ok) {
      setTestMsg({ id: 'instagram', ok: false, text: (res as { error?: string }).error ?? t('settings.connectionFail') });
      return;
    }
    const data = res.data as { username?: string; accountType?: string; publishQuota?: string; error?: string } | undefined;
    if (data?.error) {
      setTestMsg({ id: 'instagram', ok: false, text: data.error });
      return;
    }
    const quota = data?.publishQuota ? ` · ${data.publishQuota}` : '';
    setTestMsg({
      id: 'instagram',
      ok: true,
      text: `✅ @${data?.username ?? '—'} (${data?.accountType ?? 'BUSINESS'})${quota}`,
    });
  }

  async function probeTwitterPublish() {
    setTwitterProbing(true);
    setMsg(null);
    for (const f of PLATFORMS.find((p) => p.id === 'twitter')!.fields) {
      const v = settings[f.key] ?? '';
      if (/^•{4}/u.test(v)) continue;
      await window.eyespro.settings.set(f.key, v);
    }
    const res = await window.eyespro.twitter.probePublish().catch((e: Error) => ({
      ok: false as const,
      error: e.message,
    }));
    setTwitterProbing(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error ?? t('settings.connectionFail') });
      return;
    }
    const info = (res.data as { info?: string } | undefined)?.info;
    setMsg({ ok: true, text: info ?? t('settings.twitterProbeOk') });
    await load();
  }

  /** Non-empty or masked (••••) = value stored in DB */
  function isSettingPresent(value: string | undefined): boolean {
    return (value ?? '').trim().length > 0;
  }

  function configured(plat: PlatformDef) {
    if (plat.id === 'youtube') {
      return (
        isSettingPresent(settings.youtube_access_token)
        || (isSettingPresent(settings.youtube_refresh_token) && isSettingPresent(settings.youtube_client_id))
      );
    }
    if (plat.id === 'twitter') {
      return ['twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_secret'].every(
        (k) => isSettingPresent(settings[k]),
      );
    }
    return plat.fields.every((f) => isSettingPresent(settings[f.key]));
  }

  async function saveOAuthApp(app: OAuthAppDef) {
    const cid = settings[app.clientIdKey] ?? '';
    const csec = settings[app.clientSecretKey] ?? '';
    if (!/^•{4}/u.test(cid))  await window.eyespro.settings.set(app.clientIdKey, cid);
    if (!/^•{4}/u.test(csec)) await window.eyespro.settings.set(app.clientSecretKey, csec);
    setMsg({ ok: true, text: t('settings.saved') });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
        {t('settings.introSocial')}
      </p>
      {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}

      {/* OAuth App Credentials — for the new social publishing system */}
      <Card title="🔑 بيانات تطبيقات OAuth (للنشر الاجتماعي)">
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
          لاستخدام نظام النشر الاجتماعي الجديد (صفحة التواصل الاجتماعي)، أدخل Client ID و Client Secret
          لكل منصة. اضغط على زر "دليل الإعداد" في صفحة التواصل الاجتماعي لتعليمات تفصيلية.
        </p>
        {OAUTH_APPS.map(app => {
          const cidVal = settings[app.clientIdKey] ?? '';
          const csecVal = settings[app.clientSecretKey] ?? '';
          const configured = cidVal.length > 0 && csecVal.length > 0;
          const [oauthOpen, setOauthOpen] = [expanded[`oauth_${app.id}`], (v: boolean) => setExpanded(e => ({ ...e, [`oauth_${app.id}`]: v }))];
          return (
            <div key={app.id} style={{ marginBottom: 8, borderRadius: 8, border: '1px solid var(--border)', padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{app.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{app.name}</span>
                <span className={`ui-badge ui-badge--${configured ? 'ok' : 'muted'}`} style={{ fontSize: 11 }}>
                  {configured ? '✅ مكوَّن' : 'غير مكوَّن'}
                </span>
                <Btn size="sm" onClick={() => setOauthOpen(!oauthOpen)}>{oauthOpen ? '▲' : '▼'}</Btn>
              </div>
              {oauthOpen && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Field label="Client ID">
                    <Input type="text" dir="ltr" value={cidVal}
                      onChange={e => setSettings(s => ({ ...s, [app.clientIdKey]: e.target.value }))} />
                  </Field>
                  <Field label="Client Secret">
                    <Input type="password" dir="ltr" value={csecVal}
                      onChange={e => setSettings(s => ({ ...s, [app.clientSecretKey]: e.target.value }))} />
                  </Field>
                  <Btn variant="primary" onClick={() => void saveOAuthApp(app)}>{t('common.save')}</Btn>
                </div>
              )}
            </div>
          );
        })}
      </Card>
      {PLATFORMS.map((plat) => {
        const open = expanded[plat.id];
        const ready = configured(plat);
        return (
          <Card key={plat.id} title={`${plat.icon} ${plat.name}`}>
            <div style={{ display: 'flex', gap: 8, marginBottom: open ? 12 : 0, alignItems: 'center' }}>
              <span className={`ui-badge ui-badge--${ready ? 'ok' : 'muted'}`}>
                {ready ? t('settings.badgeReady') : t('settings.badgeNotConfigured')}
              </span>
              <Btn size="sm" onClick={() => setExpanded((e) => ({ ...e, [plat.id]: !open }))}>
                {open ? '▲' : '▼'}
              </Btn>
            </div>
            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {plat.id === 'twitter' && (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>
                      {t('settings.twitterConnectHint')}
                    </p>
                    <Btn disabled={twitterProbing} onClick={() => void probeTwitterPublish()}>
                      {twitterProbing ? '…' : t('settings.twitterProbePublish')}
                    </Btn>
                  </>
                )}
                {plat.id === 'youtube' && (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>
                      {t('settings.youtubeConnectHint')}
                    </p>
                    <Btn
                      variant="primary"
                      disabled={youtubeConnecting}
                      onClick={() => void connectYoutubeOAuth()}
                    >
                      {youtubeConnecting ? t('settings.youtubeConnecting') : t('settings.youtubeConnectJson')}
                    </Btn>
                    <Field label={t('settings.youtubeCallbackUrl')}>
                      <Input
                        type="text"
                        value={youtubeCallbackUrl}
                        onChange={(e) => setYoutubeCallbackUrl(e.target.value)}
                        placeholder="http://127.0.0.1:53212/oauth2callback?code=..."
                        dir="ltr"
                      />
                    </Field>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.55 }}>
                      {t('settings.youtubeCallbackHint')}
                    </p>
                    <Btn
                      disabled={youtubePasting || !youtubeCallbackUrl.trim()}
                      onClick={() => void completeYoutubeFromUrl()}
                    >
                      {youtubePasting ? '…' : t('settings.youtubeCompleteFromUrl')}
                    </Btn>
                  </>
                )}
                {plat.id === 'whatsapp' && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
                    {t('settings.whatsappConnectHint')}
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                      {t('settings.whatsappBroadcastHint')}
                    </span>
                  </p>
                )}
                {plat.id === 'instagram' && (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
                      أدخل <strong>App ID</strong> و <strong>App Secret</strong> من تطبيق Meta للمطورين،
                      ثم اضغط <strong>تسجيل الدخول</strong>. يجب أن يكون الحساب Instagram Business
                      أو Creator مرتبطاً بصفحة Facebook.
                      <br />
                      <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                        Redirect URI في Meta: <code dir="ltr">https://eyespro.local/instagram-auth</code>
                        · إذا كان الاتصال قديماً، قطع الاتصال ثم سجّل الدخول مجدداً.
                      </span>
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {igConnected ? (
                        <>
                          <span className="ui-badge ui-badge--ok">✅ متصل بـ Instagram</span>
                          <Btn
                            disabled={igConnecting}
                            style={{ fontSize: 12 }}
                            onClick={() => void disconnectInstagram()}
                          >
                            {igConnecting ? '…' : '🔌 قطع الاتصال'}
                          </Btn>
                        </>
                      ) : (
                        <Btn
                          variant="primary"
                          disabled={igConnecting}
                          onClick={() => void connectInstagramOAuth()}
                        >
                          {igConnecting ? '⏳ جارٍ تسجيل الدخول…' : '🔐 تسجيل الدخول عبر Meta / Facebook'}
                        </Btn>
                      )}
                    </div>
                  </>
                )}
                {plat.fields.map((f) => (
                  <Field key={f.key} label={t(f.labelKey)}>
                    {'hintKey' in f && f.hintKey && (
                      <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--t2)' }}>{t(f.hintKey)}</p>
                    )}
                    <Input
                      type={f.key.includes('password') || f.key.includes('token') ? 'password' : 'text'}
                      value={settings[f.key] ?? ''}
                      onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
                      dir="ltr"
                    />
                  </Field>
                ))}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn variant="primary" onClick={() => void savePlatform(plat)}>{t('common.save')}</Btn>
                  {plat.id === 'instagram' ? (
                    <Btn
                      disabled={igTesting}
                      onClick={() => void testInstagram()}
                    >
                      {igTesting ? '⏳ …' : `🔍 ${t('settings.testConnection')}`}
                    </Btn>
                  ) : (
                    <Btn disabled={testing === plat.id} onClick={() => void testPlatform(plat)}>
                      {testing === plat.id ? '…' : t('settings.testConnection')}
                    </Btn>
                  )}
                </div>
                {testMsg?.id === plat.id && (
                  <Msg tone={testMsg.ok ? 'ok' : 'err'}>{testMsg.text}</Msg>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
