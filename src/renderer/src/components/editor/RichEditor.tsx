import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import './rich-editor.css';

interface RichEditorProps {
  value: string;
  onChange: (html: string) => void;
  articleId?: number;
  placeholder?: string;
  onAiApplied?: () => void;
}

const AI_MODES = [
  { labelKey: 'richEditor.aiModes.rewrite', fallback: '✏️ إعادة صياغة', mode: 'rewrite' },
  { labelKey: 'richEditor.aiModes.summarize', fallback: '📝 تلخيص', mode: 'summarize' },
  { labelKey: 'richEditor.aiModes.translate', fallback: '🌐 ترجمة للعربية', mode: 'translate' },
  { labelKey: 'richEditor.aiModes.grammar', fallback: '✅ تصحيح نحوي', mode: 'grammar' },
] as const;

function TbBtn({ onClick, active, title, children, disabled }: {
  onClick: () => void; active?: boolean; title?: string; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function TbSep() { return <span className="tb-sep" />; }

export function RichEditor({ value, onChange, articleId, placeholder, onAiApplied }: RichEditorProps) {
  const { t } = useTranslation();
  const [autosave, setAutosave] = useState('—');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [rtlMode, setRtlMode] = useState(() => {
    const arabic = (value.match(/[\u0600-\u06FF]/g) ?? []).length;
    return arabic / Math.max(value.replace(/\s/g, '').length, 1) > 0.2;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftKey = articleId ? `eyespro-draft-${articleId}` : 'eyespro-draft-new';
  const prevValue = useRef(value);

  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles its own Link extension — disable it so our
      // explicitly-configured Link below isn't registered twice (tiptap warns
      // "Duplicate extension names found: ['link']").
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: placeholder || t('richEditor.placeholder', { defaultValue: 'اكتب المحتوى هنا…' }) }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: localStorage.getItem(draftKey) || value || '',
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      onChange(html);
      scheduleAutosave(html);
    },
  });

  // Sync external value changes (e.g. AI translate result)
  useEffect(() => {
    if (editor && value !== prevValue.current) {
      const cur = editor.getHTML();
      if (value !== cur) editor.commands.setContent(value || '', { emitUpdate: false });
      prevValue.current = value;
    }
  }, [editor, value]);

  // Apply RTL/LTR to editor content area
  useEffect(() => {
    const el = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (el) { el.dir = rtlMode ? 'rtl' : 'ltr'; el.style.textAlign = rtlMode ? 'right' : 'left'; }
  }, [rtlMode, editor]);

  const scheduleAutosave = useCallback((html: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem(draftKey, html);
      setAutosave(t('richEditor.autoSaved', { defaultValue: 'حُفظ تلقائياً: ' }) + new Date().toLocaleTimeString());
    }, 3_000);
  }, [draftKey, t]);

  async function runAi(mode: string) {
    setAiOpen(false);
    if (!articleId || !editor) {
      setAiMsg({ ok: false, text: t('ai.saveArticleFirst') });
      return;
    }
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await window.eyespro.ai.run(articleId, mode);
      if (!res.ok) {
        setAiMsg({ ok: false, text: res.error ?? t('ai.failed') });
        return;
      }
      const result = res.data?.result ?? '';
      if (mode === 'rewrite' || mode === 'grammar') {
        const html = result.includes('<')
          ? result
          : `<p>${result.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
        editor.commands.setContent(html);
        onChange(html);
        setAiMsg({ ok: true, text: t('ai.done') });
      } else {
        setAiMsg({ ok: true, text: t('ai.fieldUpdated', { mode: t(`ai.modes.${mode}`, { defaultValue: mode }) }) });
        onAiApplied?.();
      }
    } finally {
      setAiBusy(false);
    }
  }

  function insertLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('richEditor.linkPrompt', { defaultValue: 'أدخل الرابط:' }), prev ?? 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url }).run();
  }

  function insertImage() {
    if (!editor) return;
    const url = window.prompt(t('richEditor.insertImagePrompt', { defaultValue: 'رابط الصورة:' }), 'https://');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }

  // Word / char count
  const text = editor?.getText() ?? '';
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readingMin = Math.max(1, Math.ceil(wordCount / 200));

  if (!editor) return <div className="rich-editor-wrap" style={{ minHeight: 300 }} />;

  return (
    <div className={`rich-editor-wrap${fullscreen ? ' rich-fullscreen' : ''}`}>
      {/* ── Toolbar ── */}
      <div className="rich-toolbar">
        {/* History */}
        <TbBtn onClick={() => editor.chain().focus().undo().run()} title={t('richEditor.undo', { defaultValue: 'تراجع (Ctrl+Z)' })} disabled={!editor.can().undo()}>↩</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().redo().run()} title={t('richEditor.redo', { defaultValue: 'إعادة (Ctrl+Y)' })} disabled={!editor.can().redo()}>↪</TbBtn>
        <TbSep />

        {/* Headings */}
        <TbBtn onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive('paragraph')} title={t('richEditor.paragraph', { defaultValue: 'نص عادي' })}>¶</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title={t('richEditor.heading1', { defaultValue: 'عنوان 1' })}><b>H1</b></TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title={t('richEditor.heading2', { defaultValue: 'عنوان 2' })}><b>H2</b></TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title={t('richEditor.heading3', { defaultValue: 'عنوان 3' })}><b>H3</b></TbBtn>
        <TbSep />

        {/* Inline */}
        <TbBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title={t('richEditor.bold', { defaultValue: 'عريض (Ctrl+B)' })}><b>B</b></TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title={t('richEditor.italic', { defaultValue: 'مائل (Ctrl+I)' })}><i>I</i></TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title={t('richEditor.strike', { defaultValue: 'يتوسطه خط' })}><s>S</s></TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title={t('richEditor.code', { defaultValue: 'كود مضمن' })}>{'{}'}</TbBtn>
        <TbSep />

        {/* Blocks */}
        <TbBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title={t('richEditor.blockquote', { defaultValue: 'اقتباس' })}>❝</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title={t('richEditor.codeBlock', { defaultValue: 'كتلة كود' })}>&lt;/&gt;</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t('richEditor.horizontalRule', { defaultValue: 'فاصل أفقي' })}>—</TbBtn>
        <TbSep />

        {/* Lists */}
        <TbBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title={t('richEditor.bulletList', { defaultValue: 'قائمة نقطية' })}>•≡</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title={t('richEditor.orderedList', { defaultValue: 'قائمة مرقمة' })}>1≡</TbBtn>
        <TbSep />

        {/* Alignment */}
        <TbBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title={t('richEditor.alignLeft', { defaultValue: 'محاذاة يسار' })}>⬅</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title={t('richEditor.alignCenter', { defaultValue: 'توسيط' })}>⊙</TbBtn>
        <TbBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title={t('richEditor.alignRight', { defaultValue: 'محاذاة يمين' })}>➡</TbBtn>
        <TbSep />

        {/* Insert */}
        <TbBtn onClick={insertLink} active={editor.isActive('link')} title={t('richEditor.insertLink', { defaultValue: 'إدراج رابط' })}>🔗</TbBtn>
        <TbBtn onClick={insertImage} title={t('richEditor.insertImage', { defaultValue: 'إدراج صورة' })}>🖼</TbBtn>
        <TbSep />

        {/* RTL / Fullscreen */}
        <TbBtn onClick={() => setRtlMode(v => !v)} active={rtlMode} title={rtlMode ? t('richEditor.switchToLtr', { defaultValue: 'تبديل إلى LTR' }) : t('richEditor.switchToRtl', { defaultValue: 'تبديل إلى RTL' })}>
          {rtlMode ? 'RTL' : 'LTR'}
        </TbBtn>
        <TbBtn onClick={() => setFullscreen(v => !v)} title={fullscreen ? t('richEditor.exitFullscreen', { defaultValue: 'خروج من وضع ملء الشاشة' }) : t('richEditor.fullscreen', { defaultValue: 'ملء الشاشة' })}>
          {fullscreen ? '⊡' : '⛶'}
        </TbBtn>

        <span className="rich-toolbar-spacer" />

        {/* AI */}
        <div className="tb-ai-wrap">
          <TbBtn onClick={() => setAiOpen(v => !v)} active={aiOpen} disabled={aiBusy} title={t('richEditor.aiTools', { defaultValue: 'أدوات الذكاء الاصطناعي' })}>
            {aiBusy ? '⏳' : '✨ AI'}
          </TbBtn>
          {aiOpen && (
            <div className="tb-ai-menu">
              {AI_MODES.map(m => (
                <button key={m.mode} type="button" className="tb-ai-item" onClick={() => void runAi(m.mode)}>
                  {t(m.labelKey, { defaultValue: m.fallback })}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {aiMsg && (
        <p className={`rich-ai-msg${aiMsg.ok ? ' is-ok' : ' is-err'}`} style={{ margin: '6px 12px 0', fontSize: 12 }}>
          {aiMsg.text}
        </p>
      )}

      {/* ── Editor body ── */}
      <EditorContent editor={editor} className="rich-body" />

      {/* ── Status bar ── */}
      <div className="rich-statusbar">
        <span className="rich-wordcount">{t('richEditor.statusText', { defaultValue: '📝 {{wordCount}} كلمة · {{readingMin}} د قراءة', wordCount, readingMin })}</span>
        <span className="rich-autosave">{autosave}</span>
      </div>
    </div>
  );
}

export function clearEditorDraft(articleId?: number): void {
  const key = articleId ? `eyespro-draft-${articleId}` : 'eyespro-draft-new';
  localStorage.removeItem(key);
}
