import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Msg, Select } from '../../../ui';
import type { WhisperInfo } from '../../../../../shared/api-types';

export function VoicePanel() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<WhisperInfo | null>(null);
  const [engine, setEngine] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([
      window.eyespro.whisper.status().catch(() => ({ ok: false }) as never),
      window.eyespro.settings.get('stt_engine').catch(() => ({ ok: false }) as never),
    ]);
    if (w.ok) setInfo(w.data as WhisperInfo);
    if (s.ok && s.data) setEngine(String(s.data));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function download() {
    setBusy(true); setMsg({ ok: true, text: t('voice.downloading', { defaultValue: 'جارٍ تنزيل محرّك Whisper المحلّي (~160 ميغا)… قد يستغرق دقائق.' }) });
    const r = await window.eyespro.whisper.update();
    setBusy(false);
    setMsg({ ok: !!r.ok, text: r.ok ? t('voice.ready', { defaultValue: 'تم — الذكاء الصوتي المحلّي جاهز ✅' }) : (r.error || 'فشل التنزيل') });
    void load();
  }

  async function onEngine(v: string) {
    setEngine(v);
    await window.eyespro.settings.set('stt_engine', v);
  }

  return (
    <Card title={t('voice.title', { defaultValue: 'الإدخال الصوتي (Whisper)' })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--t2)' }}>
          {t('voice.desc', { defaultValue: 'يحوّل كلامك إلى أوامر للمساعد الذكي. المحلّي يعمل أوفلاين ولا يرسل صوتك لأي جهة؛ السحابي يستخدم مفتاح OpenAI/Groq الخاص بك (أعلى دقّة).' })}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: 'var(--t2)' }}>{t('voice.local', { defaultValue: 'المحرّك المحلّي:' })}</span>
          <Badge tone={info?.ready ? 'ok' : 'muted'}>
            {info?.ready ? t('voice.installed', { defaultValue: 'مثبّت وجاهز' }) : t('voice.notInstalled', { defaultValue: 'غير مثبّت' })}
          </Badge>
          {!info?.ready && (
            <Btn size="sm" variant="primary" onClick={() => void download()} disabled={busy}>
              ⬇️ {t('voice.install', { defaultValue: 'تثبيت الذكاء الصوتي المحلّي' })}
            </Btn>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{t('voice.engine', { defaultValue: 'المحرّك المفضّل:' })}</span>
          <Select value={engine} onChange={(e) => void onEngine(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="auto">{t('voice.auto', { defaultValue: 'تلقائي (محلّي إن توفّر، وإلا سحابي)' })}</option>
            <option value="local">{t('voice.localOnly', { defaultValue: 'محلّي فقط (خصوصية كاملة)' })}</option>
            <option value="cloud">{t('voice.cloudOnly', { defaultValue: 'سحابي فقط (مزوّدك)' })}</option>
          </Select>
        </div>

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.6 }}>
          {t('voice.note', { defaultValue: 'النموذج يُحدَّث تلقائياً من سيرفراته الرسمية. اضغط 🎙️ في المساعد الذكي لتتكلّم.' })}
        </p>
      </div>
    </Card>
  );
}
