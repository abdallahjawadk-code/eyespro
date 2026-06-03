import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { AssistantResult, AssistantSuggestion } from '../../../../shared/api-types';
import './assistant.css';

type RobotState = 'idle' | 'thinking' | 'executing' | 'done' | 'error';

/** Minimal Web Speech API shape (avoids `any`; not in default TS lib). */
interface SpeechRec {
  lang: string; interimResults: boolean; maxAlternatives: number;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; onstart: (() => void) | null;
}
function getSpeechRecognition(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Msg {
  who: 'user' | 'bot';
  text: string;
  err?: boolean;
  data?: unknown;
}

function DataPreview({ data }: { data: unknown }) {
  if (data == null) return null;
  const rows: string[] = [];
  if (Array.isArray(data)) {
    for (const item of data.slice(0, 6)) {
      if (item && typeof item === 'object' && 'title' in item) rows.push(`• ${String((item as { title: unknown }).title)}`);
      else rows.push(`• ${String(item)}`);
    }
  } else if (typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v != null && typeof v !== 'object') rows.push(`${k}: ${String(v)}`);
    }
  }
  if (!rows.length) return null;
  return <div className="asst-data">{rows.map((r, i) => <div key={i} className="asst-data-row">{r}</div>)}</div>;
}

export function Assistant() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RobotState>('idle');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [pending, setPending] = useState<{ command: string } | null>(null);
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>([]);
  const [greeted, setGreeted] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: 'bot', text: t('assistant.greeting', { defaultValue: 'مرحباً! أنا مساعدك الذكي. اكتب ما تريد تنفيذه.' }) },
  ]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<SpeechRec | null>(null);
  const sttAvailable = typeof window !== 'undefined' && getSpeechRecognition() !== null;

  // ── voice output (TTS) ──
  function speak(text: string) {
    if (!voiceOn || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      const clean = text.replace(/\p{Extended_Pictographic}/gu, '').replace(/[•]/g, '').replace(/ +/g, ' ').trim();
      if (!clean) return;
      const utt = new SpeechSynthesisUtterance(clean);
      utt.lang = i18n.language === 'en' ? 'en-US' : 'ar-SA';
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(utt.lang.slice(0, 2)));
      if (voice) utt.voice = voice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    } catch { /* ignore */ }
  }

  // ── voice input (STT) ──
  function startListening() {
    const SR = getSpeechRecognition();
    if (!SR || busy) return;
    const recog = new SR();
    recog.lang = i18n.language === 'en' ? 'en-US' : 'ar-SA';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onstart = () => setListening(true);
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    recog.onresult = (e) => {
      setListening(false);
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) { setSuggestions([]); void send(transcript.trim()); }
    };
    recogRef.current = recog;
    try { recog.start(); } catch { /* ignore */ }
  }
  function stopListening() { try { recogRef.current?.stop(); } catch { /* ignore */ } setListening(false); }

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, state, suggestions]);

  // Load proactive suggestions the first time the panel opens.
  useEffect(() => {
    if (!open || greeted) return;
    setGreeted(true);
    window.eyespro.assistant.suggest().then((r) => {
      if (r.ok && r.data) {
        setMsgs([{ who: 'bot', text: r.data.greeting }]);
        setSuggestions(r.data.suggestions ?? []);
      }
    }).catch(() => undefined);
  }, [open, greeted]);

  async function send(command: string, confirmed = false) {
    if (!command.trim() || busy) return;
    if (!confirmed) setMsgs((m) => [...m, { who: 'user', text: command }]);
    setBusy(true);
    setState('thinking');
    setPending(null);
    try {
      // brief "thinking" → "executing" cue
      const p = window.eyespro.assistant.command(command, confirmed);
      setTimeout(() => setState((s) => (s === 'thinking' ? 'executing' : s)), 600);
      const r = await p;
      const res = (r && r.ok ? r.data : { ok: false, reply: r?.error ?? 'خطأ', tool: 'chat', error: r?.error }) as AssistantResult;
      if (res.needsConfirm) {
        setPending({ command });
        setMsgs((m) => [...m, { who: 'bot', text: res.reply }]);
        setState('idle');
        speak(res.reply);
      } else {
        setMsgs((m) => [...m, { who: 'bot', text: res.reply, err: !res.ok, data: res.data }]);
        setState(res.ok ? 'done' : 'error');
        setTimeout(() => setState('idle'), 1600);
        if (res.navigate) { try { navigate(res.navigate); } catch { /* ignore */ } }
        speak(res.reply);
      }
    } catch (e) {
      setMsgs((m) => [...m, { who: 'bot', text: String((e as Error).message), err: true }]);
      setState('error');
      setTimeout(() => setState('idle'), 1600);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit() {
    const c = input.trim();
    if (!c) return;
    setInput('');
    setSuggestions([]);
    void send(c);
  }

  function runSuggestion(s: AssistantSuggestion) {
    if (!s.command) return;
    setSuggestions([]);
    void send(s.command);
  }

  return (
    <>
      {!open && (
        <button className="asst-fab" title={t('assistant.title', { defaultValue: 'المساعد الذكي' })} onClick={() => setOpen(true)}>
          <span style={{ fontSize: 26 }}>🤖</span>
        </button>
      )}

      {open && (
        <div className="asst-panel">
          <div className="asst-hdr">
            <div className={`asst-robot ${state}`} style={{ width: 38, height: 38 }}>
              <div className="ring" /><div className="core"><span className="face" style={{ fontSize: 15 }}>🤖</span></div>
            </div>
            <span className="asst-hdr-title">{t('assistant.title', { defaultValue: 'المساعد الذكي' })}</span>
            <span className="asst-hdr-state">
              {state === 'thinking' && t('assistant.thinking', { defaultValue: 'أفكّر…' })}
              {state === 'executing' && t('assistant.executing', { defaultValue: 'أنفّذ…' })}
            </span>
            <button className="asst-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="asst-body" ref={bodyRef}>
            {/* big robot avatar */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
              <div className={`asst-robot ${listening ? 'listening' : state}`}>
                <div className="ring" /><div className="ring2" /><div className="core"><span className="face">🤖</span></div>
                {listening && <div className="asst-wave"><span /><span /><span /><span /><span /></div>}
              </div>
            </div>
            {msgs.map((m, i) => (
              <div key={i} className={`asst-msg ${m.who === 'user' ? 'user' : 'bot'}${m.err ? ' err' : ''}`}>
                {m.text}
                {m.who === 'bot' && <DataPreview data={m.data} />}
              </div>
            ))}
            {suggestions.length > 0 && !busy && (
              <div className="asst-suggests">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className={`asst-suggest${s.command ? ' clickable' : ''}`}
                    onClick={() => runSuggestion(s)}
                    disabled={!s.command}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            )}
            {pending && (
              <div className="asst-confirm">
                <button className="asst-btn" onClick={() => void send(pending.command, true)}>
                  {t('assistant.confirm', { defaultValue: 'تأكيد التنفيذ' })}
                </button>
                <button className="asst-btn ghost" onClick={() => setPending(null)}>
                  {t('common.cancel', { defaultValue: 'إلغاء' })}
                </button>
              </div>
            )}
          </div>

          <div className="asst-input-bar">
            <button
              className={`asst-icon-btn${voiceOn ? ' on' : ''}`}
              title={voiceOn ? t('assistant.voiceOff', { defaultValue: 'كتم الصوت' }) : t('assistant.voiceOn', { defaultValue: 'تفعيل الصوت' })}
              onClick={() => { setVoiceOn((v) => !v); window.speechSynthesis?.cancel(); }}
            >
              {voiceOn ? '🔊' : '🔇'}
            </button>
            {sttAvailable && (
              <button
                className={`asst-icon-btn mic${listening ? ' listening' : ''}`}
                title={t('assistant.speak', { defaultValue: 'تكلّم' })}
                onClick={() => (listening ? stopListening() : startListening())}
                disabled={busy}
              >
                🎙️
              </button>
            )}
            <input
              className="asst-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
              placeholder={listening ? t('assistant.listening', { defaultValue: 'أستمع إليك…' }) : t('assistant.placeholder', { defaultValue: 'اكتب أو تكلّم… «اجلب الترندات»' })}
              disabled={busy}
              dir="auto"
            />
            <button className="asst-btn" onClick={onSubmit} disabled={busy || !input.trim()}>
              {t('assistant.send', { defaultValue: 'تنفيذ' })}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
