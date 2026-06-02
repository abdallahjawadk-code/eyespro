import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleFull } from '../../../../../shared/api-types';
import '../robot-assistant.css';

type ChatMsg =
  | { id: number; role: 'user'; content: string; time: string }
  | { id: number; role: 'thinking' }
  | { id: number; role: 'bot'; content: string; time: string; typing?: boolean };

type RobotMood = 'idle' | 'happy' | 'thinking' | 'talking';

type IdleActivity = 'roam' | 'think' | 'wave' | 'clean' | 'play';

const IDLE_SEQUENCE: IdleActivity[] = ['roam', 'think', 'wave', 'clean', 'play'];
const IDLE_DURATION_MS: Record<IdleActivity, number> = {
  roam: 5200,
  think: 4800,
  wave: 4200,
  clean: 5400,
  play: 5600,
};

function useIdleActivity(enabled: boolean): IdleActivity {
  const [activity, setActivity] = useState<IdleActivity>('roam');
  const stepRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setActivity('roam');
      stepRef.current = 0;
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = IDLE_SEQUENCE[stepRef.current % IDLE_SEQUENCE.length] ?? 'roam';
      setActivity(next);
      timer = setTimeout(() => {
        stepRef.current += 1;
        tick();
      }, IDLE_DURATION_MS[next]);
    };

    tick();
    return () => clearTimeout(timer);
  }, [enabled]);

  return activity;
}

const IDLE_BUBBLE_KEY: Record<IdleActivity, string> = {
  roam: 'articlesPage.robot.idleRoam',
  think: 'articlesPage.robot.idleThink',
  wave: 'articlesPage.robot.idleWave',
  clean: 'articlesPage.robot.idleClean',
  play: 'articlesPage.robot.idlePlay',
};

export type ArticleRobotDragProps = {
  draggingId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
};

type Props = {
  articles: ArticleFull[];
  onRefresh?: () => void;
  drag: ArticleRobotDragProps;
};

let msgId = 0;
function nextId() { return ++msgId; }

function timeNow(): string {
  return new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('• ')) {
      result.push(
        <div key={i} style={{ display: 'flex', gap: 6, paddingInlineStart: 4 }}>
          <span style={{ color: 'var(--t2)', flexShrink: 0 }}>●</span>
          <span>{rendered.map((r) =>
            typeof r === 'string' ? r.replace(/^[-•]\s*/, '') : r
          )}</span>
        </div>
      );
    } else if (line.trim() === '') {
      result.push(<div key={i} style={{ height: 6 }} />);
    } else {
      result.push(<div key={i}>{rendered}</div>);
    }
  });

  return result;
}

function spawnParticles(x: number, y: number) {
  const colors = ['#94a3b8', '#64748b', '#78909c', '#90a4ae'];
  for (let i = 0; i < 14; i++) {
    const el = document.createElement('div');
    el.className = 'snt-particle';
    const size = 2 + Math.random() * 5;
    const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.5;
    const dist = 30 + Math.random() * 50;
    el.style.cssText = `
      left:${x}px; top:${y}px;
      width:${size}px; height:${size}px;
      background:${colors[i % colors.length]};
      --dx:${Math.cos(angle) * dist}px;
      --dy:${Math.sin(angle) * dist}px;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}

const SUGGESTION_SETS = {
  initial: [
    'ما هي مشاعر هذا المقال؟',
    'لخّص المقال بإيجاز',
    'ما نقاط القوة في المقال؟',
    'اقترح تحسينات للمقال',
  ],
  afterSentiment: [
    'لماذا تم تصنيف المشاعر بهذا الشكل؟',
    'ما هي الكلمات المؤثرة في المشاعر؟',
    'كيف يمكن تحسين نبرة المقال؟',
    'هل المقال متوازن في طرحه؟',
  ],
  afterSummary: [
    'ما التفاصيل المهمة التي لم يذكرها الملخص؟',
    'قارن هذا المقال بأسلوب المقالات المشابهة',
    'ما رأيك بأسلوب الكاتب؟',
    'اقترح عنواناً بديلاً للمقال',
  ],
  afterAnalysis: [
    'ما الجمهور المستهدف لهذا المقال؟',
    'هل المقال يحتوي على تحيز؟',
    'ما مصداقية المصادر المذكورة؟',
    'اكتب نسخة محسّنة من المقدمة',
  ],
  general: [
    'ما الفكرة الرئيسية للمقال؟',
    'هل المقال مناسب للنشر؟',
    'ما تقييمك العام للمقال؟',
    'اقترح وسوماً مناسبة للمقال',
  ],
};

function getSuggestions(msgs: ChatMsg[]): string[] {
  if (msgs.length <= 1) return SUGGESTION_SETS.initial;

  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  if (!lastUserMsg || lastUserMsg.role !== 'user') return SUGGESTION_SETS.general;

  const q = lastUserMsg.content.toLowerCase();
  if (q.includes('مشاعر') || q.includes('sentiment') || q.includes('إيجاب') || q.includes('سلب'))
    return SUGGESTION_SETS.afterSentiment;
  if (q.includes('لخص') || q.includes('ملخص') || q.includes('summary'))
    return SUGGESTION_SETS.afterSummary;
  if (q.includes('تحليل') || q.includes('تحسين') || q.includes('تقييم'))
    return SUGGESTION_SETS.afterAnalysis;

  const setKeys = Object.keys(SUGGESTION_SETS) as (keyof typeof SUGGESTION_SETS)[];
  const idx = msgs.length % setKeys.length;
  return SUGGESTION_SETS[setKeys[idx]];
}

function FloatingRobot({
  isOver,
  isActive,
  mood,
  eyeOffset,
  idleActivity = 'roam',
}: {
  isOver: boolean;
  isActive: boolean;
  mood: RobotMood;
  eyeOffset: { x: number; y: number };
  idleActivity?: IdleActivity;
}) {
  const showThinkFx = mood === 'thinking' || isActive || (mood === 'idle' && idleActivity === 'think');
  const idleClass = mood === 'idle' ? ` idle-${idleActivity}` : '';

  return (
    <div className={`snt-bot mood-${mood}${idleClass}${isActive ? ' is-active' : ''}${isOver ? ' is-over' : ''}`}>
      <div className="snt-holo-shimmer" aria-hidden />

      {showThinkFx && (
        <div className="snt-think-sparkles" aria-hidden>
          <span className="snt-spark snt-spark--q">?</span>
          <span className="snt-spark snt-spark--d1">·</span>
          <span className="snt-spark snt-spark--d2">·</span>
        </div>
      )}

      {mood === 'idle' && idleActivity === 'play' && (
        <div className="snt-prop-ball" aria-hidden />
      )}

      {mood === 'idle' && idleActivity === 'clean' && (
        <div className="snt-prop-cloth" aria-hidden />
      )}

      {mood === 'idle' && idleActivity === 'wave' && (
        <div className="snt-idle-wave-fx" aria-hidden>👋</div>
      )}

      <div className="snt-ant">
        <div className="snt-ant-pole" />
        <div className="snt-ant-ball" />
      </div>

      <div className="snt-head">
        <div className="snt-ear-l" />
        <div className="snt-ear-r" />
        <div className="snt-eyes">
          <div className="snt-eye">
            <div
              className="snt-pupil"
              style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)` }}
            />
          </div>
          <div className="snt-eye">
            <div
              className="snt-pupil"
              style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)` }}
            />
          </div>
        </div>
        <div className="snt-mouth">
          <div className="snt-mouth-bar" />
          <div className="snt-mouth-bar" />
          <div className="snt-mouth-bar" />
          <div className="snt-mouth-bar" />
          <div className="snt-mouth-bar" />
        </div>
      </div>

      <div className="snt-shoulders">
        <div className="snt-limb snt-arm-l">
          <div className="snt-upper-arm">
            <div className="snt-forearm">
              <div className="snt-hand" />
            </div>
          </div>
        </div>

        <div className="snt-body">
          <div className="snt-chest" />
          <div className="snt-core-ring" />
          <div className="snt-body-drop">
            {isOver ? '⬇ أفلت' : isActive ? '⚙️' : '📥'}
          </div>
        </div>

        <div className="snt-limb snt-arm-r">
          <div className="snt-upper-arm">
            <div className="snt-forearm">
              <div className="snt-hand" />
            </div>
          </div>
        </div>
      </div>

      <div className="snt-legs">
        <div className="snt-limb snt-leg-l">
          <div className="snt-thigh">
            <div className="snt-shin">
              <div className="snt-foot" />
            </div>
          </div>
        </div>
        <div className="snt-limb snt-leg-r">
          <div className="snt-thigh">
            <div className="snt-shin">
              <div className="snt-foot" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniRobotAvatar({ thinking }: { thinking: boolean }) {
  return <div className={`snt-chat-hdr-mini-bot${thinking ? ' is-thinking' : ''}`} />;
}

function useTypewriter(text: string, speed = 12): { displayed: string; done: boolean } {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    indexRef.current = 0;

    if (!text) { setDone(true); return; }

    const interval = setInterval(() => {
      indexRef.current += 1;
      const step = text.length > 200 ? 4 : text.length > 100 ? 3 : 2;
      indexRef.current = Math.min(indexRef.current + step - 1, text.length);
      setDisplayed(text.slice(0, indexRef.current));

      if (indexRef.current >= text.length) {
        setDone(true);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

function BotMessage({ msg, isLatest }: { msg: ChatMsg & { role: 'bot' }; isLatest: boolean }) {
  const { t } = useTranslation();
  const shouldType = isLatest && msg.typing;
  const { displayed, done } = useTypewriter(shouldType ? msg.content : '', 10);
  const [copied, setCopied] = useState(false);

  const content = shouldType ? displayed : msg.content;
  const showCursor = shouldType && !done;

  function copyToClipboard() {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="snt-msg snt-msg--bot snt-msg-enter">
      <div className="snt-msg-av">
        <MiniRobotAvatar thinking={false} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '82%', gap: 2 }}>
        <div className={`snt-msg-bubble${showCursor ? ' snt-typewriter' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>
          {renderMarkdown(content)}
          <button type="button" className="snt-msg-copy" onClick={copyToClipboard} title={t('common.copy', { defaultValue: 'Copy' })}>
            {copied ? '✓' : '⎘'}
          </button>
        </div>
        {'time' in msg && <span className="snt-msg-time">{msg.time}</span>}
      </div>
    </div>
  );
}

export function ArticleRobotAssistant({ articles, onRefresh, drag }: Props) {
  const { t } = useTranslation();

  const [isOver, setIsOver] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const [botPos, setBotPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 });
  const [mood, setMood] = useState<RobotMood>('idle');
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const botDragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number } | null>(null);
  const botRef = useRef<HTMLDivElement>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatArticle, setChatArticle] = useState<ArticleFull | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!botRef.current) return;
      const rect = botRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.35;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxOffset = 2.5;
      const factor = Math.min(maxOffset / Math.max(dist * 0.01, 1), maxOffset);
      setEyeOffset({
        x: Math.round((dx / Math.max(dist, 1)) * factor * 10) / 10,
        y: Math.round((dy / Math.max(dist, 1)) * factor * 10) / 10,
      });
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  useEffect(() => {
    if (isAnalyzing) setMood('thinking');
    else if (thinking) setMood('thinking');
    else if (chatOpen && msgs.length > 0) setMood('happy');
    else setMood('idle');
  }, [isAnalyzing, thinking, chatOpen, msgs.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const suggestions = useMemo(() => getSuggestions(msgs), [msgs]);

  const idlePlay = mood === 'idle' && !isOver && !isAnalyzing && !thinking;
  const idleActivity = useIdleActivity(idlePlay);

  function onBotMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.snt-float-drop')) return;
    e.preventDefault();
    botDragRef.current = { startX: e.clientX, startY: e.clientY, startRight: botPos.right, startBottom: botPos.bottom };
    function onMove(ev: MouseEvent) {
      if (!botDragRef.current) return;
      const dx = ev.clientX - botDragRef.current.startX;
      const dy = ev.clientY - botDragRef.current.startY;
      setBotPos({
        right: Math.max(8, botDragRef.current.startRight - dx),
        bottom: Math.max(8, botDragRef.current.startBottom - dy),
      });
    }
    function onUp() {
      botDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onDropZoneDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsOver(true);
  }

  function onDropZoneDragLeave(e: React.DragEvent) {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setIsOver(false);
  }

  const analyzeArticle = useCallback(async (artId: number) => {
    const article = articles.find((r) => r.id === artId);
    if (!article) return;

    const rect = dropRef.current?.getBoundingClientRect();
    if (rect) spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);

    setChatArticle(article);
    setMsgs([]);
    historyRef.current = [];
    setChatOpen(true);
    setIsAnalyzing(true);
    setMood('thinking');

    await window.eyespro.pipeline.runStep(artId, 'tag_sentiment').catch(() => ({ ok: false }));

    const fresh = await window.eyespro.articles.get(artId).catch(() => ({ ok: false, data: null }));
    const art = (fresh.ok && fresh.data ? fresh.data : article) as ArticleFull;
    setChatArticle(art);

    const lines: string[] = [];
    lines.push(`مرحباً! لقد حللت المقال:\n**"${art.title ?? `#${artId}`}"**\n`);

    if (art.sentiment) {
      const emoji = art.sentiment === 'positive' ? '😊' : art.sentiment === 'negative' ? '😟' : '😐';
      const label = art.sentiment === 'positive' ? 'إيجابية' : art.sentiment === 'negative' ? 'سلبية' : 'محايدة';
      lines.push(`${emoji} **المشاعر**: ${label}`);
    }
    if (art.sentiment_score != null) {
      lines.push(`📊 **درجة المشاعر**: ${Number(art.sentiment_score).toFixed(3)}`);
    }
    if (art.category) lines.push(`🏷️ **التصنيف**: ${art.category}`);
    if (art.source) lines.push(`🔗 **المصدر**: ${art.source}`);
    if (art.summary) {
      const s = art.summary.slice(0, 200);
      lines.push(`\n📝 **الملخص**: ${s}${art.summary.length > 200 ? '…' : ''}`);
    }
    lines.push('\n\nيمكنك سؤالي عن أي تفاصيل تخص هذا المقال!');

    const greeting = lines.join('\n');
    const botId = nextId();
    setMsgs([{ id: botId, role: 'bot', content: greeting, time: timeNow(), typing: true }]);
    historyRef.current = [{ role: 'assistant', content: greeting }];
    setIsAnalyzing(false);
    setMood('happy');
    onRefresh?.();
  }, [articles, onRefresh]);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsOver(false);
    drag.onDragEnd();
    const artId = Number(e.dataTransfer.getData('articleId'));
    if (!artId) return;
    await analyzeArticle(artId);
  }

  async function sendMessage(question: string) {
    const q = question.trim();
    if (!q || !chatArticle || thinking || isAnalyzing) return;

    setInput('');

    const userMsgId = nextId();
    setMsgs((prev) => [
      ...prev.map(m => m.role === 'bot' ? { ...m, typing: false } : m),
      { id: userMsgId, role: 'user', content: q, time: timeNow() },
    ]);
    historyRef.current = [...historyRef.current, { role: 'user', content: q }];

    const thinkId = nextId();
    setMsgs((prev) => [...prev, { id: thinkId, role: 'thinking' }]);
    setThinking(true);
    setMood('thinking');

    try {
      const statusCheck = await window.eyespro.ai.status().catch(() => ({ ok: false, data: null }));
      const aiReady = statusCheck.ok && (statusCheck as { ok: boolean; data?: { ready?: boolean } }).data?.ready !== false;

      if (!aiReady) {
        const noAiMsg = '⚠️ **مزود الذكاء الاصطناعي غير مُهيأ**\n\nيرجى إعداد مزود AI من الإعدادات أولاً:\n- Gemini أو OpenAI أو Groq أو Anthropic أو Ollama\n\nانتقل إلى: **الإعدادات** ← **الذكاء الاصطناعي**';
        historyRef.current = [...historyRef.current, { role: 'assistant', content: noAiMsg }];
        setMsgs((prev) =>
          prev.map((m) => m.id === thinkId
            ? { id: thinkId, role: 'bot' as const, content: noAiMsg, time: timeNow(), typing: true }
            : m
          )
        );
        setMood('idle');
        setThinking(false);
        return;
      }

      const res = await window.eyespro.ai.chat(
        chatArticle.id,
        historyRef.current.slice(-10),
        q,
      );

      let response: string;
      if (res.ok && res.data) {
        response = res.data.response;
      } else {
        const errDetail = (res as { error?: string }).error || 'خطأ غير معروف';
        response = errDetail.startsWith('تم ') || errDetail.includes('الإعدادات')
          ? `⚠️ **لم أتمكن من الإجابة**\n\n${errDetail}`
          : `⚠️ **لم أتمكن من الإجابة**\n\n${errDetail}\n\nراجع **الإعدادات** ← **الذكاء الاصطناعي**.`;
      }

      historyRef.current = [...historyRef.current, { role: 'assistant', content: response }];
      setMsgs((prev) =>
        prev.map((m) => m.id === thinkId
          ? { id: thinkId, role: 'bot' as const, content: response, time: timeNow(), typing: true }
          : m
        )
      );
      setMood('talking');
      setTimeout(() => setMood('happy'), 3000);
    } catch {
      setMsgs((prev) =>
        prev.map((m) => m.id === thinkId
          ? { id: thinkId, role: 'bot' as const, content: 'حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.', time: timeNow() }
          : m
        )
      );
    }
    setThinking(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  function closeChat() {
    setChatOpen(false);
  }

  return (
    <>
      <div
        className="snt-float"
        style={{ right: botPos.right, bottom: botPos.bottom, cursor: 'move' }}
        onMouseDown={onBotMouseDown}
        ref={botRef}
      >
        <div className="snt-float-handle">⠿⠿</div>

        {!isAnalyzing && !chatArticle && !isOver && (
          <div className="snt-thought" key={idlePlay ? idleActivity : 'hint'}>
            <div className="snt-thought-bubble">
              {idlePlay
                ? t(IDLE_BUBBLE_KEY[idleActivity], {
                    defaultValue:
                      idleActivity === 'think' ? 'هممم…'
                      : idleActivity === 'wave' ? 'مرحباً! 👋'
                      : idleActivity === 'clean' ? 'لمّاع! ✨'
                      : idleActivity === 'play' ? 'يلعب… 🎾'
                      : t('articlesPage.robot.dragHint', { defaultValue: 'اسحب مقالاً وأفلته على الروبوت' }),
                  })
                : t('articlesPage.robot.dragHint', { defaultValue: 'اسحب مقالاً وأفلته على الروبوت' })}
            </div>
          </div>
        )}

        <div
          ref={dropRef}
          className={`snt-float-drop${isOver ? ' is-over' : ''}${isAnalyzing ? ' is-active' : ''}`}
          onDragOver={onDropZoneDragOver}
          onDragLeave={onDropZoneDragLeave}
          onDrop={(e) => void onDrop(e)}
          onClick={() => chatArticle && setChatOpen(true)}
          title={t('articlesPage.robot.dragHintShort', { defaultValue: 'اسحب مقالاً وأفلته هنا' })}
        >
          <div className={`snt-3d${idlePlay && idleActivity === 'roam' ? ' is-roaming' : ''}`}>
            <div className={`snt-orbit${idlePlay && idleActivity === 'roam' ? ' is-roaming' : ''}${idlePlay && idleActivity === 'play' ? ' is-playing' : ''}`}>
              <FloatingRobot
                isOver={isOver}
                isActive={isAnalyzing}
                mood={mood}
                eyeOffset={eyeOffset}
                idleActivity={idleActivity}
              />
            </div>
          </div>
        </div>
        <div className="snt-shadow" />
      </div>

      {chatOpen && chatArticle && (
        <div
          className="snt-chat-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) closeChat(); }}
        >
          <div className="snt-chat-modal">
            <div className="snt-chat-hdr">
              <MiniRobotAvatar thinking={thinking || isAnalyzing} />
              <div className="snt-chat-hdr-info">
                <div className="snt-chat-hdr-name">
                  {t('articlesPage.robot.chatTitle', { defaultValue: 'مساعد المقالات' })}
                </div>
                <div className="snt-chat-hdr-status">
                  <div className="snt-chat-hdr-dot" />
                  {thinking || isAnalyzing
                    ? t('articlesPage.robot.analyzing', { defaultValue: 'يفكر…' })
                    : 'متصل'}
                </div>
              </div>
              <div className="snt-chat-hdr-art" title={chatArticle.title ?? ''}>
                📄 {chatArticle.title ?? `#${chatArticle.id}`}
              </div>
              <button type="button" className="snt-chat-close" onClick={closeChat}>✕</button>
            </div>

            {(thinking || isAnalyzing) && <div className="snt-progress" />}

            <div className="snt-chat-msgs">
              {msgs.length === 0 ? (
                <div className="snt-chat-empty">
                  <div className="snt-chat-empty-icon">{isAnalyzing ? '⚙️' : '🤖'}</div>
                  <div>
                    {isAnalyzing
                      ? t('articlesPage.robot.analyzingArticle', { defaultValue: 'جاري تحليل المقال…' })
                      : t('articlesPage.robot.chatEmpty', { defaultValue: 'اسأل الروبوت عن المقال' })}
                  </div>
                </div>
              ) : (
                msgs.map((m, idx) => {
                  if (m.role === 'thinking') {
                    return (
                      <div key={m.id} className="snt-msg snt-msg--bot snt-msg-enter">
                        <div className="snt-msg-av">
                          <MiniRobotAvatar thinking />
                        </div>
                        <div className="snt-msg-bubble">
                          <div className="snt-thinking">
                            <span /><span /><span />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (m.role === 'user') {
                    return (
                      <div key={m.id} className="snt-msg snt-msg--user snt-msg-enter">
                        <div className="snt-msg-av">👤</div>
                        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '82%', gap: 2 }}>
                          <div className="snt-msg-bubble">{m.content}</div>
                          <span className="snt-msg-time">{m.time}</span>
                        </div>
                      </div>
                    );
                  }
                  const isLatest = idx === msgs.length - 1;
                  return <BotMessage key={m.id} msg={m} isLatest={isLatest} />;
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {!thinking && !isAnalyzing && msgs.length > 0 && (
              <div className="snt-suggestions">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className="snt-suggestion"
                    style={{ animationDelay: `${i * 60}ms` }}
                    onClick={() => void sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="snt-chat-input">
              <textarea
                className="snt-chat-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="اسأل عن المقال… (Enter للإرسال)"
                rows={1}
                disabled={thinking || isAnalyzing}
              />
              <button
                type="button"
                className="snt-send-btn"
                disabled={!input.trim() || thinking || isAnalyzing}
                onClick={() => void sendMessage(input)}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
