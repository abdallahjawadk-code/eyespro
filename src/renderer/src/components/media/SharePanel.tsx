/**
 * SharePanel — مشاركة عبر Web Intent
 *
 * يفتح روابط المشاركة الرسمية في متصفح النظام.
 * لا يحتاج API ولا مفاتيح — فقط رابط المصدر.
 */
import { useState } from 'react';

interface SharePanelProps {
  url: string;     // رابط الفيديو الأصلي للمشاركة (لمشاركة الرابط عبر المنصات)
  title: string;   // عنوان الفيديو
  onClose: () => void;
}

interface Platform {
  id: string;
  label: string;
  icon: string;
  buildUrl: (url: string, title: string) => string;
}

const PLATFORMS: Platform[] = [
  {
    id: 'twitter',
    label: 'تويتر / X',
    icon: '𝕏',
    buildUrl: (u, t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`,
  },
  {
    id: 'facebook',
    label: 'فيسبوك',
    icon: '📘',
    buildUrl: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
  {
    id: 'whatsapp',
    label: 'واتساب',
    icon: '💬',
    buildUrl: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t}\n${u}`)}`,
  },
  {
    id: 'telegram',
    label: 'تيليغرام',
    icon: '✈️',
    buildUrl: (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`,
  },
  {
    id: 'linkedin',
    label: 'لينكدإن',
    icon: '💼',
    buildUrl: (u, t) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`,
  },
  {
    id: 'pinterest',
    label: 'بينتريست',
    icon: '📌',
    buildUrl: (u, t) => `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(u)}&description=${encodeURIComponent(t)}`,
  },
  {
    id: 'reddit',
    label: 'ريديت',
    icon: '🔴',
    buildUrl: (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`,
  },
  {
    id: 'email',
    label: 'بريد إلكتروني',
    icon: '📧',
    buildUrl: (u, t) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(`${t}\n\n${u}`)}`,
  },
];

export function SharePanel({ url, title, onClose }: SharePanelProps) {
  const [editUrl, setEditUrl]     = useState(url);
  const [editTitle, setEditTitle] = useState(title);
  const [copied, setCopied]       = useState(false);

  function openShare(platform: Platform) {
    const shareUrl = platform.buildUrl(editUrl.trim(), editTitle.trim());
    void window.eyespro.social.openShare(shareUrl);
  }

  function copyLink() {
    void navigator.clipboard.writeText(editUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: 'var(--bg1)', borderRadius: 14,
        border: '1px solid var(--border2)',
        padding: 24, width: '100%', maxWidth: 460,
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>🔗 مشاركة الفيديو</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--t2)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Editable title */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 4 }}>العنوان</div>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="عنوان الفيديو"
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg2)',
              color: 'var(--t1)', fontSize: 12, boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Editable URL + copy */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 4 }}>رابط الفيديو</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              dir="ltr"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg2)',
                color: 'var(--t1)', fontSize: 11, boxSizing: 'border-box',
              }}
            />
            <button
              onClick={copyLink}
              style={{
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, flexShrink: 0,
                border: `1px solid ${copied ? 'var(--ok)' : 'var(--border)'}`,
                background: copied ? 'var(--ok-soft)' : 'var(--bg3)',
                color: copied ? 'var(--ok)' : 'var(--t1)',
              }}
            >
              {copied ? '✅ تم' : '📋 نسخ'}
            </button>
          </div>
        </div>

        {/* Platform grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}>
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => openShare(p)}
              disabled={!editUrl.trim()}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '12px 6px', borderRadius: 10, cursor: editUrl.trim() ? 'pointer' : 'not-allowed',
                border: '1px solid var(--border)', background: 'var(--bg2)',
                color: 'var(--t1)', fontSize: 10, fontWeight: 600,
                opacity: editUrl.trim() ? 1 : 0.4,
              }}
            >
              <span style={{ fontSize: 24, lineHeight: 1 }}>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {!editUrl.trim() && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--warn)', textAlign: 'center' }}>
            أدخل رابط الفيديو أعلاه لتفعيل المشاركة
          </div>
        )}
      </div>
    </div>
  );
}
