import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Msg } from '../../../ui';

interface Props {
  title: string;
  summary: string;
  sourceUrl: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

interface Platform {
  key: string;
  label: string;
  icon: string;
  bg: string;
  buildUrl: (title: string, url: string) => string;
}

const PLATFORMS: Platform[] = [
  {
    key: 'twitter',
    label: 'Twitter / X',
    icon: '𝕏',
    bg: '#000000',
    buildUrl: (title, url) =>
      `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    icon: 'f',
    bg: '#1877f2',
    buildUrl: (_, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: 'in',
    bg: '#0a66c2',
    buildUrl: (title, url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}&title=${enc(title)}`,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: '✆',
    bg: '#25d366',
    buildUrl: (title, url) =>
      `https://wa.me/?text=${enc(`${title}\n${url}`)}`,
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: '✈',
    bg: '#229ed9',
    buildUrl: (title, url) =>
      `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`,
  },
  {
    key: 'threads',
    label: 'Threads',
    icon: '@',
    bg: '#101010',
    buildUrl: (title, url) =>
      `https://www.threads.net/intent/post?text=${enc(`${title}\n${url}`)}`,
  },
];

export function WebIntentShareCard({ title, summary, sourceUrl }: Props) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const displayText = title || summary || '';
  const hasUrl = Boolean(sourceUrl?.trim());

  async function share(buildUrl: (title: string, url: string) => string) {
    if (!hasUrl) {
      setMsg({ ok: false, text: t('share.noUrl') });
      setTimeout(() => setMsg(null), 4000);
      return;
    }
    const intentUrl = buildUrl(displayText, sourceUrl);
    const clipText = `${displayText}\n${sourceUrl}`;
    const r = await window.eyespro.social.openShare(intentUrl, clipText);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? t('share.failed') });
      setTimeout(() => setMsg(null), 4000);
    }
  }

  async function copyLink() {
    if (!hasUrl) {
      setMsg({ ok: false, text: t('share.noUrl') });
      setTimeout(() => setMsg(null), 4000);
      return;
    }
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setMsg({ ok: true, text: t('share.copied') });
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setMsg({ ok: false, text: t('share.failed') });
      setTimeout(() => setMsg(null), 3000);
    }
  }

  return (
    <Card title={`🔗 ${t('share.title')}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>
          {t('share.hint')}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {PLATFORMS.map((p) => (
            <ShareButton
              key={p.key}
              icon={p.icon}
              label={p.label}
              bg={p.bg}
              onClick={() => void share(p.buildUrl)}
            />
          ))}
        </div>

        {/* Copy link row */}
        <button
          type="button"
          onClick={() => void copyLink()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
            border: '1px dashed var(--border)', background: 'transparent',
            fontSize: 12, fontWeight: 500, color: 'var(--t2)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget).style.background = 'var(--surface-2, var(--border))';
            (e.currentTarget).style.color = 'var(--t1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget).style.background = 'transparent';
            (e.currentTarget).style.color = 'var(--t2)';
          }}
        >
          🔗 {t('share.copyLink')}
        </button>

        {msg && <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>}
      </div>
    </Card>
  );
}

/* ── Platform button sub-component ─────────────────────────────── */
interface ShareButtonProps {
  icon: string;
  label: string;
  bg: string;
  onClick: () => void;
}

function ShareButton({ icon, label, bg, onClick }: ShareButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--border)', background: 'var(--surface)',
        fontSize: 12, fontWeight: 500, color: 'var(--t1)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget).style.background = `${bg}18`;
        (e.currentTarget).style.borderColor = `${bg}70`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget).style.background = 'var(--surface)';
        (e.currentTarget).style.borderColor = 'var(--border)';
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: 4, background: bg,
        color: '#fff', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
      }}>
        {icon}
      </span>
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', flex: 1,
      }}>
        {label}
      </span>
    </button>
  );
}
