/**
 * Social sharing via Web Intents — opens system browser with content pre-filled.
 * No OAuth, no API keys, no setup required.
 * Premium, interactive redesign — v2 with scheduling, hashtags, analytics, emoji toolbar.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './social.css';
import { PLATFORM_ICON_MAP } from './PlatformIcons';

const openShare = (url: string, clipboardText?: string) =>
  (window as unknown as { eyespro: import('../../../../shared/api-types').EyesProApi })
    .eyespro.social.openShare(url, clipboardText);

// Helper to extract domain from URL
const getDomain = (url: string) => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'eyespro.app';
  }
};

/** Reject search/knowledge-graph URLs — they produce ugly Facebook previews. */
function isUsableShareUrl(raw: string): boolean {
  if (!raw?.trim()) return false;
  try {
    const u = new URL(raw.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'google.com' || host.endsWith('.google.com')) return false;
    if (/search|knowledgegraph/i.test(`${u.pathname}${u.search}`)) return false;
    return true;
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildInitialPostText(title: string, summary: string, content?: string): string {
  const body = summary.trim() || stripHtml(content ?? '').slice(0, 2800);
  const t = title.trim();
  if (!body) return t;
  return body.startsWith(t) ? body : `${t}\n\n${body}`;
}

function finalizePostText(text: string, url: string, includeLink: boolean): string {
  let out = text.trim();
  if (includeLink && isUsableShareUrl(url)) {
    const link = url.trim();
    if (!out.includes(link)) out += `\n\n${link}`;
  }
  return out;
}

interface ShareIntent {
  openUrl: string;
  clipboard: string;
  needsPaste: boolean;
}

function resolveShareIntent(platform: Platform, postText: string, url: string, includeLink: boolean): ShareIntent {
  const usableLink = includeLink && isUsableShareUrl(url);
  const clip = finalizePostText(postText, url, includeLink);

  switch (platform.id) {
    case 'facebook':
      return usableLink
        ? {
            openUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url.trim())}`,
            clipboard: clip,
            needsPaste: false,
          }
        : {
            openUrl: 'https://www.facebook.com/',
            clipboard: clip,
            needsPaste: true,
          };
    case 'linkedin':
      return usableLink
        ? {
            openUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url.trim())}`,
            clipboard: clip,
            needsPaste: false,
          }
        : {
            openUrl: 'https://www.linkedin.com/feed/',
            clipboard: clip,
            needsPaste: true,
          };
    case 'twitter': {
      const tweet = usableLink
        ? `${clip.slice(0, 240).trim()}\n${url.trim()}`.slice(0, 280)
        : clip.slice(0, 280);
      return {
        openUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`,
        clipboard: clip,
        needsPaste: false,
      };
    }
    case 'whatsapp': {
      const msg = usableLink ? clip : postText.trim();
      return {
        openUrl: `https://wa.me/?text=${encodeURIComponent(msg)}`,
        clipboard: clip,
        needsPaste: false,
      };
    }
    case 'telegram':
      return usableLink
        ? {
            openUrl: `https://t.me/share/url?url=${encodeURIComponent(url.trim())}&text=${encodeURIComponent(postText.trim())}`,
            clipboard: clip,
            needsPaste: false,
          }
        : {
            openUrl: `https://t.me/share/url?url=${encodeURIComponent('https://eyespro.app')}&text=${encodeURIComponent(clip)}`,
            clipboard: clip,
            needsPaste: false,
          };
    case 'threads': {
      const threadsText = clip.slice(0, 500);
      return {
        openUrl: `https://www.threads.net/intent/post?text=${encodeURIComponent(threadsText)}`,
        clipboard: clip,
        needsPaste: false,
      };
    }
    default:
      return { openUrl: 'https://www.facebook.com/', clipboard: clip, needsPaste: true };
  }
}

// Highlight hashtags and links
const highlightText = (text: string, color: string = '#1d9bf0') => {
  if (!text) return '';
  const parts = text.split(/(\s+)/);
  return parts.map((part, i) => {
    if (part.startsWith('#') || part.startsWith('@')) {
      return (
        <span key={i} style={{ color, fontWeight: 600, cursor: 'pointer' }}>
          {part}
        </span>
      );
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <span key={i} style={{ color, textDecoration: 'underline', cursor: 'pointer' }}>
          {part}
        </span>
      );
    }
    return part;
  });
};

// ─── Platform definitions ─────────────────────────────────────────────────────

interface Platform {
  id:       string;
  nameAr:   string;
  nameEn:   string;
  icon:     string;
  color:    string;
  grad:     string;
  maxChars: number;
  formatPreview: (title: string, text: string, url: string) => string;
}

const PLATFORMS: Platform[] = [
  {
    id: 'facebook', nameAr: 'فيسبوك', nameEn: 'Facebook', icon: '📘',
    color: '#1877F2', grad: 'linear-gradient(135deg,#1877F2,#0d6ef3)',
    maxChars: 63206,
    formatPreview: (_title, text, _url) => text,
  },
  {
    id: 'twitter', nameAr: 'X / تويتر', nameEn: 'X / Twitter', icon: '✕',
    color: '#1d9bf0', grad: 'linear-gradient(135deg,#1a1a1a,#383838)',
    maxChars: 280,
    formatPreview: (_title, text, _url) => text,
  },
  {
    id: 'linkedin', nameAr: 'لينكدإن', nameEn: 'LinkedIn', icon: '🔗',
    color: '#0A66C2', grad: 'linear-gradient(135deg,#0A66C2,#084f99)',
    maxChars: 3000,
    formatPreview: (_title, text, _url) => text,
  },
  {
    id: 'whatsapp', nameAr: 'واتساب', nameEn: 'WhatsApp', icon: '💬',
    color: '#25D366', grad: 'linear-gradient(135deg,#25D366,#128C7E)',
    maxChars: 65536,
    formatPreview: (_title, text, _url) => text,
  },
  {
    id: 'telegram', nameAr: 'تيليغرام', nameEn: 'Telegram', icon: '✈️',
    color: '#2AABEE', grad: 'linear-gradient(135deg,#2AABEE,#1a8cc9)',
    maxChars: 4096,
    formatPreview: (_title, text, _url) => text,
  },
  {
    id: 'threads', nameAr: 'ثريدز', nameEn: 'Threads', icon: '🧵',
    color: '#101010', grad: 'linear-gradient(135deg,#1a1a1a,#444)',
    maxChars: 500,
    formatPreview: (_title, text, _url) => text,
  },
];

// ─── Schedule types & hooks ────────────────────────────────────────────────────

interface ScheduledPost {
  id:         string;
  platformId: string;
  text:       string;
  url:        string;
  scheduledAt: number;
  articleKey: string;
}

function useScheduleQueue() {
  const [queue, setQueue] = useState<ScheduledPost[]>(() => {
    try { return JSON.parse(localStorage.getItem('social_schedule_queue') ?? '[]'); }
    catch { return []; }
  });

  const save = (next: ScheduledPost[]) => {
    setQueue(next);
    localStorage.setItem('social_schedule_queue', JSON.stringify(next));
  };

  const addScheduled = (post: Omit<ScheduledPost, 'id'>) => {
    const next = [...queue, { ...post, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` }];
    save(next);
  };

  const removeScheduled = (id: string) => save(queue.filter(p => p.id !== id));

  return { queue, addScheduled, removeScheduled };
}

// ─── Analytics hook ────────────────────────────────────────────────────────────

interface ShareEvent { platformId: string; ts: number; }

function useShareAnalytics() {
  const [events, setEvents] = useState<ShareEvent[]>(() => {
    try { return JSON.parse(localStorage.getItem('social_analytics') ?? '[]'); }
    catch { return []; }
  });

  const recordEvent = (platformId: string) => {
    const next = [...events.slice(-500), { platformId, ts: Date.now() }];
    setEvents(next);
    localStorage.setItem('social_analytics', JSON.stringify(next));
  };

  const weeklyStats = (): Record<string, number> => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const counts: Record<string, number> = {};
    for (const e of events) {
      if (e.ts >= since) counts[e.platformId] = (counts[e.platformId] ?? 0) + 1;
    }
    return counts;
  };

  const totalThisWeek = () => Object.values(weeklyStats()).reduce((a, b) => a + b, 0);

  return { recordEvent, weeklyStats, totalThisWeek };
}

// ─── Hashtag extractor ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'في','من','على','إلى','عن','مع','هذا','هذه','التي','الذي','وهو','وهي','كان',
  'يكون','كما','لكن','أو','إن','أن','قد','ما','لا','هو','هي','هم','نحن','أنا',
  'the','a','an','in','on','at','to','for','of','and','or','but','is','are','was',
]);

function extractHashtags(text: string, title: string): string[] {
  const combined = `${title} ${text}`;
  const words = combined
    .replace(/<[^>]+>/g, ' ')
    .split(/[\s,.،؛؟!؟\-–—()[\]{}"']+/)
    .map(w => w.replace(/^[#@]+/, '').trim())
    .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const freq: Record<string, number> = {};
  for (const w of words) {
    const key = w.toLowerCase();
    freq[key] = (freq[key] ?? 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => `#${w}`);
}

// ─── Emoji palette ─────────────────────────────────────────────────────────────

const EMOJI_PALETTE = [
  '🔥','⚡','🎯','💡','📰','🌍','🚀','💎','✅','❗','📊','🗞️',
  '💬','🤝','👁️','🔗','⭐','📢','🎤','🏆','🌟','💪','👀','🎉',
  '📱','💻','🖥️','📈','📉','🔴','🟢','🔵','⚠️','🛡️','🔑','🧠',
];

type ComposerTab = 'edit' | 'ai' | 'hashtags' | 'emoji' | 'schedule' | 'stats' | 'tips';

function PlatformIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = PLATFORM_ICON_MAP[id];
  return Icon ? <Icon size={size} /> : <span>{PLATFORMS.find(p => p.id === id)?.icon}</span>;
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useShareHistory() {
  const [history, setHistory] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('share_history') ?? '{}'); }
    catch { return {}; }
  });
  const record = (platformId: string, articleKey: string) => {
    const key = `${platformId}:${articleKey}`;
    const next = { ...history, [key]: Date.now() };
    setHistory(next);
    localStorage.setItem('share_history', JSON.stringify(next));
  };
  const lastShared = (platformId: string, articleKey: string) =>
    history[`${platformId}:${articleKey}`] ?? null;
  return { record, lastShared };
}

function useClipboard() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  };
  return { copied, copy };
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function VerifiedBadge() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="x-verified">
      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.99-3.818-3.99-.48 0-.94.1-1.348.27C14.825 2.515 13.512 1.5 12 1.5s-2.825 1.015-3.422 2.28c-.406-.17-.866-.27-1.348-.27-2.108 0-3.818 1.78-3.818 3.99 0 .495.084.965.238 1.4-1.273.65-2.148 2.02-2.148 3.6 0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.71 3.99 3.818 3.99.48 0 .94-.1 1.348-.27.597 1.265 1.91 2.28 3.422 2.28s2.825-1.015 3.422-2.28c.406.17.866.27 1.348.27 2.108 0 3.818-1.78 3.818-3.99 0-.495-.084-.965-.238-1.4 1.273-.65 2.148-2.02 2.148-3.6zm-12.72 4.19l-3.28-3.28 1.42-1.42 1.86 1.86 5.37-5.37 1.42 1.42-6.79 6.79z" />
    </svg>
  );
}

// ─── Circular Progress ────────────────────────────────────────────────────────

function CircularProgress({ count, max }: { count: number; max: number }) {
  const pct = count / max;
  const progressPct = Math.min(pct, 1);
  const strokeDash = 2 * Math.PI * 15; // r=15 -> circumference ~ 94.2
  const offset = strokeDash * (1 - progressPct);
  
  let color = '#7c6cf8';
  if (pct > 1) color = '#fb7185';
  else if (pct > 0.85) color = '#f59e0b';
  
  return (
    <div className="circular-progress-wrap">
      <svg className="circular-progress-svg" viewBox="0 0 36 36">
        <circle className="circular-bg" cx="18" cy="18" r="15" />
        <circle
          className="circular-fg"
          cx="18"
          cy="18"
          r="15"
          stroke={color}
          strokeDasharray={strokeDash}
          strokeDashoffset={offset}
        />
      </svg>
      <span style={{ 
        position: 'absolute', 
        fontSize: pct > 1 ? '8px' : '9px', 
        fontWeight: 'bold', 
        color: pct > 1 ? '#fb7185' : 'var(--t2)' 
      }}>
        {max - count}
      </span>
    </div>
  );
}

// ─── Realistic Social Mockup Previews ──────────────────────────────────────────

interface PreviewProps {
  platform: Platform;
  title: string;
  text: string;
  url: string;
  imageUrl?: string;
  includeLink?: boolean;
}

function PreviewPanel({ platform, title, text, url, imageUrl, includeLink = true }: PreviewProps) {
  const previewText = platform.formatPreview(title, text, url);
  const domain = getDomain(url);
  const [liked, setLiked] = useState(false);
  const showLink = includeLink && isUsableShareUrl(url);

  // Reset liked state on platform switch
  useEffect(() => {
    setLiked(false);
  }, [platform.id]);

  const renderLinkCard = () => {
    if (!showLink) return null;
    return (
      <div className="mockup-link-card">
        {imageUrl ? (
          <img className="mockup-link-img" src={imageUrl} alt="" />
        ) : (
          <div className="mockup-link-img">
            <span>📰</span>
          </div>
        )}
        <div className="mockup-link-info">
          <span className="mockup-link-domain">{domain}</span>
          <span className="mockup-link-title">{title}</span>
          <span className="mockup-link-desc">{text.slice(0, 140)}...</span>
        </div>
      </div>
    );
  };

  switch (platform.id) {
    case 'facebook':
      return (
        <div className="mockup-card fb-mockup">
          <div className="mockup-header">
            <div className="mockup-avatar" style={{ background: '#1877F2', color: '#fff' }}>E</div>
            <div className="mockup-user-info">
              <span className="mockup-username">EyesPro User</span>
              <span className="mockup-meta">الآن • 🌐</span>
            </div>
          </div>
          <div className="mockup-text">{highlightText(previewText, '#1877F2')}</div>
          {renderLinkCard()}
          <div className="mockup-actions">
            <button 
              className={`mockup-action-btn ${liked ? 'active-like' : ''}`}
              onClick={() => setLiked(!liked)}
            >
              <span>👍</span> أعجبني
            </button>
            <button className="mockup-action-btn">
              <span>💬</span> تعليق
            </button>
            <button className="mockup-action-btn">
              <span>🔄</span> مشاركة
            </button>
          </div>
        </div>
      );

    case 'twitter':
      return (
        <div className="mockup-card x-mockup">
          <div className="mockup-header">
            <div className="mockup-avatar" style={{ background: '#383838', color: '#fff' }}>𝕏</div>
            <div className="mockup-user-info">
              <span className="mockup-username">
                EyesPro App <VerifiedBadge />
              </span>
              <span className="mockup-meta" style={{ direction: 'ltr' }}>@eyespro_app · 1s</span>
            </div>
          </div>
          <div className="mockup-text">{highlightText(previewText, '#1d9bf0')}</div>
          {renderLinkCard()}
          <div className="mockup-actions">
            <button className="mockup-action-btn">💬 <span style={{ fontSize: 10 }}>0</span></button>
            <button className="mockup-action-btn">🔁 <span style={{ fontSize: 10 }}>0</span></button>
            <button 
              className={`mockup-action-btn ${liked ? 'active-like' : ''}`}
              onClick={() => setLiked(!liked)}
            >
              ❤️ <span style={{ fontSize: 10 }}>{liked ? 1 : 0}</span>
            </button>
            <button className="mockup-action-btn">👁️ <span style={{ fontSize: 10 }}>12</span></button>
            <button className="mockup-action-btn">📤</button>
          </div>
        </div>
      );

    case 'linkedin':
      return (
        <div className="mockup-card linkedin-mockup">
          <div className="mockup-header">
            <div className="mockup-avatar" style={{ background: '#0a66c2', color: '#fff' }}>L</div>
            <div className="mockup-user-info">
              <span className="mockup-username">EyesPro Professional</span>
              <span className="mockup-meta">تم النشر بواسطة تطبيق المراقبة والتحرير • الآن • 🌐</span>
            </div>
          </div>
          <div className="mockup-text">{highlightText(previewText, '#0a66c2')}</div>
          {renderLinkCard()}
          <div style={{ padding: '4px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
            👍 ❤️ 12 تفاعلاً
          </div>
          <div className="mockup-actions">
            <button 
              className={`mockup-action-btn ${liked ? 'active-like' : ''}`}
              onClick={() => setLiked(!liked)}
            >
              <span>👍</span> أعجبني
            </button>
            <button className="mockup-action-btn">
              <span>💬</span> تعليق
            </button>
            <button className="mockup-action-btn">
              <span>🔁</span> إعادة نشر
            </button>
            <button className="mockup-action-btn">
              <span>✈️</span> إرسال
            </button>
          </div>
        </div>
      );

    case 'whatsapp':
      return (
        <div className="mockup-card whatsapp-mockup" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="wa-bubble">
            <div style={{ fontWeight: 'bold', marginBottom: 4, color: '#128c7e' }}>{title}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{previewText}</div>
            {url && (
              <div style={{ 
                marginTop: 6, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 6, 
                overflow: 'hidden', background: 'rgba(0,0,0,0.03)' 
              }}>
                {imageUrl && <img src={imageUrl} style={{ width: '100%', height: 100, objectFit: 'cover' }} alt="" />}
                <div style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 11, fontWeight: 'bold' }}>{title}</div>
                  <div style={{ fontSize: 10, color: '#667781', textDecoration: 'underline' }}>{domain}</div>
                </div>
              </div>
            )}
            <div className="wa-bubble-time">
              <span>{new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ color: '#53bdeb' }}>✓✓</span>
            </div>
          </div>
        </div>
      );

    case 'telegram':
      return (
        <div className="mockup-card telegram-mockup" style={{ padding: 12 }}>
          <div style={{ 
            background: 'var(--bg-primary)', borderRadius: 10, 
            boxShadow: '0 1px 2px rgba(0,0,0,0.07)', overflow: 'hidden'
          }}>
            <div style={{ padding: '8px 12px', fontWeight: 'bold', color: '#2481cc', fontSize: 12 }}>
              قناة النشر التلقائي (Telegram Channel)
            </div>
            <div className="mockup-text" style={{ padding: '4px 12px 10px', fontSize: 13.5 }}>
              {highlightText(previewText, '#2481cc')}
            </div>
            {url && (
              <div style={{ 
                margin: '0 12px 10px', borderLeft: '3px solid #2481cc', 
                background: 'rgba(36, 129, 204, 0.04)', padding: '6px 10px' 
              }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#2481cc' }}>{domain}</div>
                <div style={{ fontSize: 13, fontWeight: 'bold', margin: '2px 0' }}>{title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{text.slice(0, 120)}...</div>
              </div>
            )}
            <div style={{ padding: '4px 12px 8px', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}>
              <span>👁️ 1.2K</span>
              <span>{new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      );

    case 'threads':
      return (
        <div className="mockup-card threads-mockup">
          <div style={{ display: 'flex', padding: '12px 16px', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className="mockup-avatar" style={{ background: '#101010', color: '#fff', width: 36, height: 36 }}>T</div>
              <div style={{ width: 2, flex: 1, background: 'var(--border2)', margin: '4px 0' }} />
              <div style={{ position: 'relative', width: 16, height: 16 }}>
                <div className="mockup-avatar" style={{ position: 'absolute', width: 14, height: 14, fontSize: 8 }}>u</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span className="mockup-username">
                  eyespro_editor <VerifiedBadge />
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>1ث</span>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 8 }}>
                {highlightText(previewText, '#101010')}
              </div>
              {renderLinkCard()}
              <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 14, color: 'var(--t2)' }}>
                <span style={{ cursor: 'pointer' }} onClick={() => setLiked(!liked)}>{liked ? '❤️' : '🤍'}</span>
                <span style={{ cursor: 'pointer' }}>💬</span>
                <span style={{ cursor: 'pointer' }}>🔁</span>
                <span style={{ cursor: 'pointer' }}>✈️</span>
              </div>
            </div>
          </div>
        </div>
      );

    case 'instagram':
      return (
        <div className="mockup-card instagram-mockup">
          <div className="mockup-header" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div className="mockup-avatar" style={{
              background: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
              color: '#fff', fontSize: 18
            }}>📸</div>
            <div className="mockup-user-info">
              <span className="mockup-username" style={{ fontSize: 13 }}>eyespro_editor</span>
              <span className="mockup-meta">الجمهور</span>
            </div>
            <span style={{ marginRight: 'auto', fontSize: 20, cursor: 'pointer', paddingRight: 8 }}>···</span>
          </div>
          {imageUrl ? (
            <img src={imageUrl} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} alt="" />
          ) : (
            <div style={{
              width: '100%', aspectRatio: '1/1', background: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48
            }}>📸</div>
          )}
          <div style={{ padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 12, fontSize: 20 }}>
                <span style={{ cursor: 'pointer' }} onClick={() => setLiked(!liked)}>{liked ? '❤️' : '🤍'}</span>
                <span style={{ cursor: 'pointer' }}>💬</span>
                <span style={{ cursor: 'pointer' }}>📤</span>
              </div>
              <span style={{ cursor: 'pointer', fontSize: 20 }}>🔖</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 4 }}>{liked ? 1 : 0} إعجاب</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <strong style={{ marginLeft: 4 }}>eyespro_editor</strong>
              {highlightText(previewText.slice(0, 300), '#E1306C')}
            </div>
          </div>
        </div>
      );

    case 'tiktok':
      return (
        <div className="mockup-card tiktok-mockup">
          <div style={{ position: 'relative' }}>
            {imageUrl ? (
              <img src={imageUrl} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', maxHeight: 220 }} alt="" />
            ) : (
              <div style={{
                width: '100%', height: 200, background: 'linear-gradient(135deg,#010101 30%,#69C9D0 65%,#EE1D52)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52
              }}>🎵</div>
            )}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.7) 40%, transparent 100%)',
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '10px 12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, maxWidth: '80%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div className="mockup-avatar" style={{ width: 28, height: 28, background: '#EE1D52', color: '#fff', fontSize: 12 }}>T</div>
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>@eyespro</span>
                  </div>
                  <div style={{ color: '#fff', fontSize: 12, lineHeight: 1.4 }}>
                    {highlightText(previewText.slice(0, 150), '#69C9D0')}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4 }}>🎵 أغنية أصلية - eyespro</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginRight: 4 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ cursor: 'pointer', fontSize: 22 }} onClick={() => setLiked(!liked)}>{liked ? '❤️' : '🤍'}</span>
                    <span style={{ color: '#fff', fontSize: 10 }}>{liked ? '1' : '0'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: 22 }}>💬</span>
                    <span style={{ color: '#fff', fontSize: 10 }}>0</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: 22 }}>↪️</span>
                    <span style={{ color: '#fff', fontSize: 10 }}>0</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );

    case 'snapchat':
      return (
        <div className="mockup-card snapchat-mockup">
          <div style={{ background: '#FFFC00', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="mockup-avatar" style={{ width: 28, height: 28, background: '#000', fontSize: 14 }}>👻</div>
            <span style={{ fontWeight: 'bold', fontSize: 12, color: '#000' }}>eyespro</span>
          </div>
          <div style={{ background: '#000', padding: 16, minHeight: 180, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
            <div style={{
              background: 'rgba(255,252,0,0.12)', borderRadius: 12, padding: '10px 14px',
              border: '1px solid rgba(255,252,0,0.3)', maxWidth: '100%'
            }}>
              <div style={{ color: '#fff', fontSize: 13, lineHeight: 1.5, textAlign: 'center' }}>
                {previewText.slice(0, 250)}
              </div>
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>انتهت صلاحية هذا السناب · الآن</div>
          </div>
          <div style={{
            background: '#1a1a1a', padding: '8px 16px',
            display: 'flex', justifyContent: 'space-around'
          }}>
            <span style={{ color: '#fff', fontSize: 20, cursor: 'pointer' }}>↩️</span>
            <span style={{ color: '#FFFC00', fontSize: 20, cursor: 'pointer' }}>📤</span>
            <span style={{ color: '#fff', fontSize: 20, cursor: 'pointer' }}>😊</span>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

interface ShareProps {
  articleId?: number;
  title:     string;
  summary:   string;
  content?:  string;
  sourceUrl: string;
  imageUrl?: string;
  onClose:   () => void;
}

export function ShareModal({ articleId, title, summary, content, sourceUrl, imageUrl, onClose }: ShareProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const pName = (p: Platform) => isAr ? p.nameAr : p.nameEn;
  const usableSourceUrl = isUsableShareUrl(sourceUrl);
  const [activePlatform, setActivePlatform] = useState<Platform>(PLATFORMS[0]);
  const [sharing, setSharing]           = useState<string | null>(null);
  const [sharedSet, setSharedSet]       = useState<Set<string>>(new Set());
  const [includeLink, setIncludeLink]   = useState(usableSourceUrl);
  const [customText, setCustomText]     = useState(() => buildInitialPostText(title, summary, content));
  const [composerTab, setComposerTab]   = useState<ComposerTab>('edit');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [customTone, setCustomTone]     = useState('');
  const [pasteHint, setPasteHint]       = useState<string | null>(null);
  const [shareError, setShareError]     = useState<string | null>(null);
  const [aiError, setAiError]           = useState<string | null>(null);
  const [confetti, setConfetti]         = useState<Array<{ id: number; x: number; color: string; delay: number }>>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; provider: string; error?: string } | null>(null);
  const [now, setNow]                   = useState(Date.now());
  const { record, lastShared }          = useShareHistory();
  const { copied, copy }                = useClipboard();
  const { queue, addScheduled, removeScheduled } = useScheduleQueue();
  const { recordEvent, weeklyStats, totalThisWeek } = useShareAnalytics();
  const articleKey                      = title.slice(0, 40);
  const backdropRef                     = useRef<HTMLDivElement>(null);
  const textareaRef                     = useRef<HTMLTextAreaElement>(null);
  const confettiTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shareTimerRef    = useRef<NodeJS.Timeout | null>(null);
  const clockRef         = useRef<NodeJS.Timeout | null>(null);

  const suggestedHashtags = extractHashtags(customText, title);
  const myQueue = queue.filter(p => p.articleKey === articleKey);

  const triggerConfetti = useCallback(() => {
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6'];
    const nextParticles = Array.from({ length: 40 }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      delay: Math.random() * 0.4,
    }));
    setConfetti(nextParticles);
    if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
    confettiTimerRef.current = setTimeout(() => setConfetti([]), 1600);
  }, []);

  useEffect(() => {
    clockRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, []);

  // Clear AI error when switching away from AI tab
  useEffect(() => {
    if (composerTab !== 'ai') {
      setAiError(null);
    }
  }, [composerTab]);

  // Check AI status when entering AI tab
  useEffect(() => {
    if (composerTab === 'ai') {
      void window.eyespro.ai.status().then(res => {
        if (res.ok && res.data) {
          setAiStatus(res.data);
        } else {
          setAiStatus({ ok: false, provider: 'unknown', error: res.error ?? 'Unknown error' });
        }
      }).catch(() => {
        setAiStatus({ ok: false, provider: 'unknown', error: isAr ? 'فشل الاتصال بالخادم' : 'Failed to connect to server' });
      });
    }
  }, [composerTab, isAr]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= 9 && idx <= PLATFORMS.length && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
        setActivePlatform(PLATFORMS[idx - 1]!);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const hasUrl = usableSourceUrl;
  const url    = hasUrl ? sourceUrl.trim() : '';
  const charPct = customText.length / activePlatform.maxChars;
  const studioStep = sharedSet.has(activePlatform.id) ? 3 : customText.trim() ? 2 : 1;
  const linkOnlyPlatform = activePlatform.id === 'facebook' || activePlatform.id === 'linkedin';
  const activeIntent = resolveShareIntent(activePlatform, customText, url, includeLink);

  async function doShare(platform: Platform): Promise<void> {
    const intent = resolveShareIntent(platform, customText, url, includeLink);
    const clip = intent.clipboard;
    setSharing(platform.id);
    setPasteHint(null);
    setShareError(null);

    // Always copy text to clipboard first so user can paste immediately
    try {
      await navigator.clipboard.writeText(clip);
    } catch {
      // clipboard may fail in some contexts, continue anyway
    }

    const finishSuccess = (hint?: string) => {
      if (hint) setPasteHint(hint);
      return new Promise<void>((resolve) => {
        if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
        shareTimerRef.current = setTimeout(() => {
          setSharing(null);
          setSharedSet(prev => new Set([...prev, platform.id]));
          record(platform.id, articleKey);
          triggerConfetti();
          resolve();
        }, 700);
      });
    };

    try {
      const res = await openShare(intent.openUrl, clip);
      if (!res.ok) {
        setShareError(res.error ?? 'تعذّر فتح رابط المشاركة');
        setSharing(null);
        return;
      }
      recordEvent(platform.id);
      if (intent.needsPaste) {
        await finishSuccess(isAr ? `📋 النص منسوخ ✓ — الصقه (Ctrl+V) في ${pName(platform)}` : `📋 Text copied ✓ — Paste (Ctrl+V) in ${pName(platform)}`);
        return;
      }
      await finishSuccess(`🔗 فُتح المتصفح · النص منسوخ ✓ — الصق (Ctrl+V) إن لزم`);
    } catch (e) {
      setShareError((e as Error).message || 'تعذّر إتمام المشاركة');
      setSharing(null);
    }
  }

  function handleSchedule() {
    if (!scheduleDate || !scheduleTime) return;
    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
    if (isNaN(scheduledAt) || scheduledAt <= Date.now()) return;
    addScheduled({
      platformId: activePlatform.id,
      text: finalizePostText(customText, url, includeLink),
      url,
      scheduledAt,
      articleKey,
    });
    setScheduleSuccess(true);
    setScheduleDate('');
    setScheduleTime('');
    triggerConfetti();
    setTimeout(() => setScheduleSuccess(false), 3000);
  }

  function insertAtCursor(insert: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setCustomText(t => t + insert);
      return;
    }
    const start = ta.selectionStart ?? customText.length;
    const end   = ta.selectionEnd ?? customText.length;
    const next = customText.slice(0, start) + insert + customText.slice(end);
    setCustomText(next);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      ta.focus();
    }, 0);
  }

  async function publishAllRemaining() {
    const pending = PLATFORMS.filter(p => !sharedSet.has(p.id));
    for (const p of pending) {
      setActivePlatform(p);
      await doShare(p);
    }
  }

  const runAiRephrase = async (tone: string) => {
    if (!articleId) return;
    const effectiveTone = tone || customTone.trim() || 'مهني واحترافي';
    setAiGenerating(true);
    setAiError(null);
    try {
      const maxLen = activePlatform.maxChars < 500 ? activePlatform.maxChars : 2200;
      const prompt = `أنت خبير محتوى تسويقي رقمي متميز. أعد كتابة هذا الملخص ليكون منشوراً جذاباً جداً وتفاعلياً ومناسباً للنشر على منصة ${activePlatform.nameAr} بأسلوب ${effectiveTone}. استخدم لغة طبيعية واجعل السطر الأول قوياً جداً وضع 3-5 أوسمة (Hashtags) مخصصة لهذه المنصة في النهاية. لا تتجاوز ${maxLen} حرفاً. النص الأصلي: ${summary || title}`;
      const res = await window.eyespro.ai.chat(articleId, [], prompt);
      if (res.ok && res.data?.response) {
        setCustomText(res.data.response.trim());
        setComposerTab('edit');
        triggerConfetti();
      } else {
        const errorMsg = res.error ?? (isAr ? 'فشل الذكاء الاصطناعي — تحقق من إعدادات المزود' : 'AI failed — check provider settings');
        setAiError(errorMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('AI sharing optimizer failure', err);
      setAiError(isAr ? `خطأ: ${msg}` : `Error: ${msg}`);
    } finally {
      setAiGenerating(false);
    }
  };

  const remainingCount = PLATFORMS.length - sharedSet.size;

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      className="social-modal-backdrop"
    >
      <div
        dir="rtl"
        className="social-modal-container"
        style={{ ['--studio-accent' as string]: activePlatform.color }}
      >
        {confetti.length > 0 && (
          <div className="confetti-container">
            {confetti.map(p => (
              <div
                key={p.id}
                className="confetti-particle"
                style={{ left: `${p.x}%`, background: p.color, animationDelay: `${p.delay}s` }}
              />
            ))}
          </div>
        )}

        {/* Header */}
        <header className="social-studio-header">
          <div className="social-studio-header-bg" aria-hidden />
          <div className="social-studio-header-inner">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="social-studio-badge">
                <span className="social-preview-label-dot" style={{ width: 6, height: 6 }} />
                {isAr ? 'استوديو النشر الاجتماعي' : 'Social Publishing Studio'}
              </div>
              <h2 className="social-studio-title">{isAr ? 'نشر تفاعلي احترافي' : 'Professional Interactive Publishing'}</h2>
              <p className="social-studio-subtitle" title={title}>{title}</p>
              {!usableSourceUrl && sourceUrl.trim() && (
                <div className="social-studio-warn">
                  {isAr ? '⚠️ رابط المقال غير مناسب للمشاركة (Google/بحث) — سيُنشر النص كاملاً بدون رابط' : '⚠️ Article URL is not shareable (Google/search) — text will be posted without a link'}
                </div>
              )}
              {!sourceUrl.trim() && (
                <div className="social-studio-warn">{isAr ? 'ℹ️ لا يوجد رابط — المنشور سيكون نص المقال فقط' : 'ℹ️ No URL — post will contain article text only'}</div>
              )}
            </div>
            <button type="button" className="social-studio-close" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'}>
              <IconClose />
            </button>
          </div>
        </header>

        {/* Steps */}
        <div className="social-studio-steps">
          <div className={`social-step ${studioStep >= 1 ? 'is-active' : ''} ${studioStep > 1 ? 'is-done' : ''}`}>
            <span className="social-step-num">{studioStep > 1 ? '✓' : '1'}</span>
            <span>{isAr ? 'اختر المنصة' : 'Choose Platform'}</span>
          </div>
          <div className={`social-step ${studioStep >= 2 ? 'is-active' : ''} ${studioStep > 2 ? 'is-done' : ''}`}>
            <span className="social-step-num">{studioStep > 2 ? '✓' : '2'}</span>
            <span>{isAr ? 'صِغ المحتوى' : 'Compose'}</span>
          </div>
          <div className={`social-step ${studioStep >= 3 ? 'is-active is-done' : ''}`}>
            <span className="social-step-num">{studioStep >= 3 ? '✓' : '3'}</span>
            <span>{isAr ? 'انشر' : 'Publish'}</span>
          </div>
        </div>

        {/* Body */}
        <div className="social-studio-body">
          {/* Platform rail */}
          <nav className="social-platform-rail" aria-label={isAr ? 'المنصات' : 'Platforms'}>
            <div className="social-rail-label">{isAr ? 'المنصات · 1–6' : 'Platforms · 1–6'}</div>
            {PLATFORMS.map((p, i) => {
              const isActive  = activePlatform.id === p.id;
              const isDone    = sharedSet.has(p.id);
              const isSharing = sharing === p.id;
              const ts        = lastShared(p.id, articleKey);

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePlatform(p)}
                  className={`platform-btn ${isActive ? 'active' : ''}`}
                  style={{
                    background: isActive ? p.grad : undefined,
                    ['--studio-accent' as string]: p.color,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      className="platform-icon-wrap"
                      style={{
                        background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--bg1)',
                        color: isActive ? '#fff' : p.color,
                        boxShadow: isActive ? 'none' : '0 2px 8px rgba(0,0,0,0.06)',
                      }}
                    >
                      {isSharing ? <span className="spin-icon">⏳</span> : <PlatformIcon id={p.id} size={16} />}
                    </div>
                    <div className="platform-btn-meta">
                      <div className="platform-btn-name">{pName(p)}</div>
                      {ts && (
                        <div className="platform-btn-date">
                          {new Date(ts).toLocaleDateString('ar', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </div>
                    {isDone && (
                      <span
                        className="platform-done-badge"
                        style={{
                          background: isActive ? 'rgba(255,255,255,.28)' : 'var(--ok-soft)',
                          color: isActive ? '#fff' : 'var(--ok)',
                        }}
                      >
                        ✓
                      </span>
                    )}
                    <span style={{ fontSize: 9, opacity: 0.45, fontWeight: 700 }}>{i + 1}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Preview stage */}
          <section className="social-preview-stage">
            <div className="social-preview-toolbar">
              <span className="social-preview-label">
                <span className="social-preview-label-dot" />
                {isAr ? `معاينة حية · ${pName(activePlatform)}` : `Live Preview · ${pName(activePlatform)}`}
              </span>
              <CircularProgress count={customText.length} max={activePlatform.maxChars} />
            </div>

            <div className="phone-frame">
              <div className="phone-frame-notch" aria-hidden />
              <div className="phone-frame-screen">
                <PreviewPanel
                  platform={activePlatform}
                  title={title}
                  text={customText}
                  url={url}
                  imageUrl={imageUrl}
                  includeLink={includeLink}
                />
              </div>
            </div>
            <p className="phone-frame-label">{isAr ? 'محاكاة شاشة الجوال' : 'Mobile screen preview'}</p>

            {charPct > 0.9 && (
              <div className="social-studio-warn" style={{ background: 'var(--err-soft)', color: 'var(--err)', margin: '0 auto', maxWidth: 340 }}>
                {isAr ? `⚠️ اقتربت من حد الأحرف (${activePlatform.maxChars.toLocaleString('ar')})` : `⚠️ Approaching character limit (${activePlatform.maxChars.toLocaleString()})`}
              </div>
            )}

            {sharedSet.size > 0 && (
              <div className="social-shared-strip">
                <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700 }}>{isAr ? 'نُشر على:' : 'Published to:'}</span>
                {[...sharedSet].map(id => {
                  const p = PLATFORMS.find(x => x.id === id);
                  return p ? (
                    <span key={id} className="social-shared-chip" style={{ background: p.grad }}>
                      <PlatformIcon id={p.id} size={12} /> {pName(p)}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </section>

          {/* Composer */}
          <aside className="social-composer">
            <div className="social-composer-tabs" role="tablist">
              {([
                ['edit',     '✏️'],
                ['ai',       '🤖'],
                ['hashtags', '#️⃣'],
                ['emoji',    '😊'],
                ['schedule', '🕐'],
                ['stats',    '📊'],
                ['tips',     '💡'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={composerTab === tab}
                  className={`social-tab-btn ${composerTab === tab ? 'is-active' : ''}`}
                  onClick={() => setComposerTab(tab)}
                  title={tab === 'edit' ? (isAr ? 'تحرير' : 'Edit') : tab === 'ai' ? (isAr ? 'ذكاء اصطناعي' : 'AI') : tab === 'hashtags' ? (isAr ? 'هاشتاق' : 'Hashtags') : tab === 'emoji' ? (isAr ? 'إيموجي' : 'Emoji') : tab === 'schedule' ? (isAr ? 'جدولة' : 'Schedule') : tab === 'stats' ? (isAr ? 'إحصاءات' : 'Stats') : (isAr ? 'نصائح' : 'Tips')}
                >
                  {label}
                </button>
              ))}
            </div>

            {composerTab === 'edit' && (
              <>
                <textarea
                  ref={textareaRef}
                  className="social-composer-textarea"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  rows={9}
                  placeholder={isAr ? 'عنوان المقال + المحتوى…' : 'Article title + content…'}
                />
                {hasUrl && (
                  <label className="autopilot-toggle-row" style={{ marginBottom: 8, cursor: 'pointer' }}>
                    <div>
                      <div className="autopilot-toggle-label">{isAr ? '🔗 إرفاق الرابط في المنشور' : '🔗 Attach link to post'}</div>
                      <div className="autopilot-toggle-hint">
                        {linkOnlyPlatform && !includeLink
                          ? (isAr ? 'فيسبوك/لينكدإن: بدون رابط يُنسخ المقال للصق يدوياً' : 'Facebook/LinkedIn: without link, text will be copied for manual paste')
                          : (isAr ? 'عطّل لنشر النص فقط بدون رابط' : 'Disable to post text only without a link')}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={includeLink}
                      onChange={e => setIncludeLink(e.target.checked)}
                    />
                  </label>
                )}
                <div className="social-tool-row">
                  <button
                    type="button"
                    className={`social-tool-btn ${copied ? 'is-success' : ''}`}
                    onClick={() => { copy(finalizePostText(customText, url, includeLink)); triggerConfetti(); }}
                  >
                    {copied ? (isAr ? '✓ نُسخ' : '✓ Copied') : (isAr ? '📋 نسخ' : '📋 Copy')}
                  </button>
                  <button
                    type="button"
                    className="social-tool-btn"
                    onClick={() => setCustomText(buildInitialPostText(title, summary, content))}
                  >
                    {isAr ? '↺ استعادة' : '↺ Reset'}
                  </button>
                </div>
              </>
            )}

            {composerTab === 'ai' && articleId && aiStatus && !aiStatus.ok && (
              <div style={{
                padding: '12px 14px',
                background: 'var(--err-soft, #fef2f2)',
                border: '1px solid var(--err, #ef4444)',
                borderRadius: 10,
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--err, #dc2626)', marginBottom: 6 }}>
                  ⚠️ {isAr ? 'الذكاء الاصطناعي غير مُهيأ' : 'AI Not Configured'}
                </div>
                <p style={{ fontSize: 12, color: 'var(--err, #dc2626)', margin: 0, lineHeight: 1.6 }}>
                  {aiStatus.error ?? (isAr ? 'تحقق من إعدادات الذكاء الاصطناعي في الإعدادات' : 'Check AI settings in Settings')}
                </p>
              </div>
            )}

            {composerTab === 'ai' && articleId && (
              <div className="ai-optimize-card" style={{ opacity: aiStatus?.ok ? 1 : 0.5, pointerEvents: aiStatus?.ok ? 'auto' : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
                  {isAr ? `تحسين لـ ${pName(activePlatform)}` : `Optimize for ${pName(activePlatform)}`}
                </div>
                <p style={{ fontSize: 11, color: 'var(--t3)', margin: '0 0 8px', lineHeight: 1.5 }}>
                  {isAr ? 'اختر أسلوباً أو أدخل نبرة مخصصة.' : 'Choose a tone or enter a custom one.'}
                </p>
                <div className="ai-preset-grid">
                  <button type="button" className="ai-preset-btn" disabled={aiGenerating} onClick={() => void runAiRephrase('مهني واحترافي')}>
                    {isAr ? '💼 مهني ورسمي' : '💼 Professional'}
                  </button>
                  <button type="button" className="ai-preset-btn" disabled={aiGenerating} onClick={() => void runAiRephrase('مقتضب ومثير')}>
                    {isAr ? '⚡ سريع ومثير' : '⚡ Punchy'}
                  </button>
                  <button type="button" className="ai-preset-btn" disabled={aiGenerating} onClick={() => void runAiRephrase('ودود وتفاعلي')}>
                    {isAr ? '💬 ودود وتفاعلي' : '💬 Engaging'}
                  </button>
                  <button type="button" className="ai-preset-btn" disabled={aiGenerating} onClick={() => void runAiRephrase('إخباري ومحايد')}>
                    {isAr ? '📰 إخباري ومحايد' : '📰 Newsroom'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <input
                    className="social-custom-tone-input"
                    placeholder={isAr ? 'نبرة مخصصة…' : 'Custom tone…'}
                    value={customTone}
                    onChange={e => setCustomTone(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && customTone.trim()) void runAiRephrase(customTone.trim()); }}
                  />
                  <button
                    type="button"
                    className="ai-preset-btn"
                    style={{ flex: '0 0 auto', padding: '8px 12px' }}
                    disabled={aiGenerating || !customTone.trim()}
                    onClick={() => void runAiRephrase(customTone.trim())}
                  >
                    ✨
                  </button>
                </div>
                {aiGenerating && (
                  <div className="ai-loading-overlay">
                    <span className="spin-icon" style={{ marginLeft: 6 }}>⏳</span>
                    {isAr ? 'جاري الصياغة…' : 'Generating…'}
                  </div>
                )}
                {aiError && (
                  <div className="ai-error-message" style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    background: 'var(--err-soft, #fef2f2)',
                    border: '1px solid var(--err, #ef4444)',
                    borderRadius: 8,
                    color: 'var(--err, #dc2626)',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}>
                    <strong style={{ display: 'block', marginBottom: 4 }}>
                      {isAr ? '⚠️ خطأ في الذكاء الاصطناعي' : '⚠️ AI Error'}
                    </strong>
                    {aiError}
                  </div>
                )}
              </div>
            )}

            {composerTab === 'ai' && !articleId && (
              <p style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, margin: 0 }}>
                {isAr ? 'احفظ المقال أولاً لتفعيل تحسين الذكاء الاصطناعي.' : 'Save the article first to enable AI optimization.'}
              </p>
            )}

            {composerTab === 'hashtags' && (
              <div className="hashtag-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 8 }}>
                  {isAr ? '🏷️ أوسمة مقترحة من المحتوى' : '🏷️ Suggested hashtags from content'}
                </div>
                {suggestedHashtags.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--t3)' }}>{isAr ? 'أدخل نصاً لاستخراج الأوسمة' : 'Enter text to extract hashtags'}</p>
                ) : (
                  <div className="hashtag-grid">
                    {suggestedHashtags.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className="hashtag-chip"
                        onClick={() => insertAtCursor(` ${tag}`)}
                        title={isAr ? 'انقر للإضافة' : 'Click to add'}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10, lineHeight: 1.5 }}>
                  {isAr ? 'انقر على أي وسم لإضافته في موضع المؤشر' : 'Click any tag to insert at cursor position'}
                </div>
              </div>
            )}

            {composerTab === 'emoji' && (
              <div className="emoji-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 8 }}>
                  {isAr ? '😊 أدرج إيموجي في النص' : '😊 Insert emoji into text'}
                </div>
                <div className="emoji-grid">
                  {EMOJI_PALETTE.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className="emoji-chip"
                      onClick={() => insertAtCursor(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {composerTab === 'schedule' && (
              <div className="schedule-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 8 }}>
                  {isAr ? `🕐 جدولة النشر على ${pName(activePlatform)}` : `🕐 Schedule post on ${pName(activePlatform)}`}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="date"
                    className="social-schedule-input"
                    value={scheduleDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => setScheduleDate(e.target.value)}
                  />
                  <input
                    type="time"
                    className="social-schedule-input"
                    value={scheduleTime}
                    onChange={e => setScheduleTime(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`social-tool-btn ${scheduleSuccess ? 'is-success' : ''}`}
                    disabled={!scheduleDate || !scheduleTime}
                    onClick={handleSchedule}
                    style={{ background: scheduleSuccess ? undefined : 'var(--bg1)' }}
                  >
                    {scheduleSuccess ? (isAr ? '✓ تمت الجدولة!' : '✓ Scheduled!') : (isAr ? '📅 جدولة المنشور' : '📅 Schedule Post')}
                  </button>
                </div>
                {myQueue.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', marginBottom: 6 }}>
                      {isAr ? `قائمة الانتظار (${myQueue.length})` : `Queue (${myQueue.length})`}
                    </div>
                    {myQueue.map(item => {
                      const p = PLATFORMS.find(x => x.id === item.platformId);
                      const diff = item.scheduledAt - now;
                      const mins = Math.floor(diff / 60000);
                      const hrs  = Math.floor(mins / 60);
                      const countdown = diff <= 0 ? (isAr ? '⏰ حان الوقت!' : '⏰ Time!') : hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                      return (
                        <div key={item.id} className="schedule-item">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                            {p && <div style={{ color: p.color, flexShrink: 0 }}><PlatformIcon id={p.id} size={13} /></div>}
                            <div style={{ fontSize: 10, color: 'var(--t2)', flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{p ? pName(p) : ''}</div>
                              <div style={{ color: diff <= 0 ? 'var(--ok)' : 'var(--t3)' }}>⏱ {countdown}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="schedule-remove-btn"
                            onClick={() => removeScheduled(item.id)}
                            title="حذف"
                          >✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {composerTab === 'stats' && (
              <div className="stats-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10 }}>
                  {isAr ? '📊 إحصاءات المشاركة (آخر 7 أيام)' : '📊 Share stats (last 7 days)'}
                </div>
                <div className="stats-total-badge">
                  <span style={{ fontSize: 22, fontWeight: 900 }}>{totalThisWeek()}</span>
                  <span style={{ fontSize: 10, color: 'var(--t3)' }}>{isAr ? 'مشاركة هذا الأسبوع' : 'shares this week'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
                  {PLATFORMS.map(p => {
                    const count = weeklyStats()[p.id] ?? 0;
                    const maxCount = Math.max(...PLATFORMS.map(x => weeklyStats()[x.id] ?? 0), 1);
                    const pct = (count / maxCount) * 100;
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ color: p.color, flexShrink: 0, width: 16 }}><PlatformIcon id={p.id} size={13} /></div>
                        <div style={{ flex: 1, fontSize: 10, color: 'var(--t2)', minWidth: 50 }}>{pName(p)}</div>
                        <div className="stats-bar-wrap">
                          <div className="stats-bar-fill" style={{ width: `${pct}%`, background: p.grad }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t1)', minWidth: 16, textAlign: 'left' }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {composerTab === 'tips' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--t2)', lineHeight: 1.65 }}>
                <p style={{ margin: 0 }}>{isAr ? <>⌨️ اضغط <strong>1–9</strong> للتبديل بين المنصات · <strong>Esc</strong> للإغلاق</> : <>⌨️ Press <strong>1–9</strong> to switch platforms · <strong>Esc</strong> to close</>}</p>
                <p style={{ margin: 0 }}>{isAr ? '📋 يُنسخ المقال للحافظة تلقائياً — في فيسبوك/لينكدإن الصق (Ctrl+V)' : '📋 Text is auto-copied to clipboard — on Facebook/LinkedIn paste with Ctrl+V'}</p>
                <p style={{ margin: 0 }}>{isAr ? '🔗 بطاقة الرابط تظهر فقط لروابط حقيقية (ليست Google)' : '🔗 Link card only appears for real URLs (not Google)'}</p>
                <p style={{ margin: 0 }}>{isAr ? '🕐 الجدولة تحفظ القائمة محلياً مع عداد تنازلي' : '🕐 Schedule saves locally with a countdown timer'}</p>
                <p style={{ margin: 0 }}>{isAr ? `🎯 الحد الأقصى: ${activePlatform.maxChars.toLocaleString('ar')} حرف على ${pName(activePlatform)}` : `🎯 Max: ${activePlatform.maxChars.toLocaleString()} chars on ${pName(activePlatform)}`}</p>
              </div>
            )}

            {sharedSet.size === 0 && composerTab === 'edit' && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, fontWeight: 700 }}>
                  {isAr ? '⚡ مشاركة سريعة' : '⚡ Quick share'}
                </div>
                <div className="social-quick-grid">
                  {PLATFORMS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="social-quick-chip"
                      title={pName(p)}
                      style={{ background: p.grad, opacity: sharedSet.has(p.id) ? 0.4 : 1 }}
                      onClick={() => { setActivePlatform(p); void doShare(p); }}
                    >
                      <PlatformIcon id={p.id} size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Action dock */}
        <footer className="social-action-dock">
          <p className={`social-action-hint${shareError ? ' is-error' : ''}`}>
            <span>{shareError ? '⚠️' : '💡'}</span>
            {shareError ?? pasteHint ?? (
              activeIntent.needsPaste
                ? (isAr ? `📋 سيُنسخ النص تلقائياً · سيفتح ${pName(activePlatform)} · الصق بـ Ctrl+V` : `📋 Text will be auto-copied · ${pName(activePlatform)} will open · Paste with Ctrl+V`)
                : (isAr ? '📋 سيُنسخ النص تلقائياً · سيُفتح المتصفح مباشرةً' : '📋 Text will be auto-copied · Browser will open directly')
            )}
          </p>
          <button type="button" className="social-cancel-btn" onClick={onClose}>
            {sharedSet.size > 0 ? (isAr ? 'إغلاق' : 'Close') : (isAr ? 'إلغاء' : 'Cancel')}
          </button>
          {remainingCount > 1 && sharedSet.size > 0 && (
            <button
              type="button"
              className="social-publish-all-btn"
              disabled={!!sharing}
              onClick={() => void publishAllRemaining()}
            >
              {isAr ? `نشر الباقي (${remainingCount})` : `Publish remaining (${remainingCount})`}
            </button>
          )}
          <button
            type="button"
            className={`social-publish-btn ${sharedSet.has(activePlatform.id) ? 'is-done' : ''}`}
            disabled={sharing === activePlatform.id}
            style={{
              background: sharedSet.has(activePlatform.id) ? undefined : activePlatform.grad,
            }}
            onClick={() => void doShare(activePlatform)}
          >
            {sharing === activePlatform.id ? (
              <><span className="spin-icon">⏳</span> {isAr ? 'جاري التحضير…' : 'Preparing…'}</>
            ) : sharedSet.has(activePlatform.id) ? (
              <>{isAr ? `✓ نُشر — إعادة على ${pName(activePlatform)}` : `✓ Published — Reshare on ${pName(activePlatform)}`}</>
            ) : (
              <><IconShare /> {isAr ? `نشر على ${pName(activePlatform)}` : `Share on ${pName(activePlatform)}`}</>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Quick share bar (article list / detail panel) ────────────────────────────

export function QuickShareBar({ articleId, title, summary, content, sourceUrl, imageUrl }: {
  articleId?: number; title: string; summary: string; content?: string; sourceUrl: string; imageUrl?: string;
}) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="quick-share-btn" onClick={() => setOpen(true)}>
        <span className="quick-share-btn-icon">📤</span>
        {isAr ? 'مشاركة سريعة' : 'Quick Share'}
      </button>
      {open && (
        <ShareModal
          articleId={articleId} title={title} summary={summary} content={content} sourceUrl={sourceUrl} imageUrl={imageUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Sidebar card (article editor) ───────────────────────────────────────────

export function SocialPublishCard({ articleId, title, summary, content, sourceUrl, imageUrl }: {
  articleId?: number; title: string; summary: string; content?: string; sourceUrl: string; imageUrl?: string;
}) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const pName = (p: Platform) => isAr ? p.nameAr : p.nameEn;
  const [open, setOpen]       = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <>
      <div className="sidebar-social-card">
        <div className="sidebar-social-header" onClick={() => setOpen(true)} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(true); }}
        >
          <div className="sidebar-social-header-inner">
            <div className="sidebar-social-icon">📲</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 className="sidebar-social-title">{isAr ? 'استوديو النشر الاجتماعي' : 'Social Publishing Studio'}</h3>
              <p className="sidebar-social-desc">{isAr ? 'معاينة حية · منصات · ذكاء اصطناعي · جدولة' : 'Live preview · Platforms · AI · Schedule'}</p>
            </div>
          </div>
          <div className="sidebar-social-stats">
            <div className="sidebar-stat">
              <div className="sidebar-stat-val">{PLATFORMS.length}</div>
              <div className="sidebar-stat-label">{isAr ? 'منصات' : 'Platforms'}</div>
            </div>
            <div className="sidebar-stat">
              <div className="sidebar-stat-val">{summary ? '✓' : '—'}</div>
              <div className="sidebar-stat-label">{isAr ? 'ملخص' : 'Summary'}</div>
            </div>
            <div className="sidebar-stat">
              <div className="sidebar-stat-val">{isUsableShareUrl(sourceUrl) ? '✓' : '—'}</div>
              <div className="sidebar-stat-label">{isAr ? 'رابط' : 'URL'}</div>
            </div>
          </div>
        </div>

        <div className="quick-launch-grid">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              type="button"
              title={pName(p)}
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setOpen(true)}
              className="quick-launch-item"
              style={{
                background: hovered === p.id ? p.grad : undefined,
                color: hovered === p.id ? '#fff' : p.color,
                borderColor: hovered === p.id ? 'transparent' : undefined,
              }}
            >
              <PlatformIcon id={p.id} size={15} />
            </button>
          ))}
        </div>

        <div className="sidebar-social-cta">
          <button type="button" className="sidebar-social-cta-btn" onClick={() => setOpen(true)}>
            <IconShare />
            {isAr ? 'فتح استوديو النشر' : 'Open Publishing Studio'}
          </button>
        </div>
      </div>

      {open && (
        <ShareModal
          articleId={articleId} title={title} summary={summary} content={content} sourceUrl={sourceUrl} imageUrl={imageUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
