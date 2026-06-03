/**
 * AI Assistant — natural-language control of EyesPro.
 *
 * The user types (or speaks) a command in plain Arabic/English. We ask the
 * configured AI provider to map it to ONE of a curated, safe set of tools and
 * return a small JSON intent. We then execute that tool against the existing
 * services. Sensitive tools (that create/modify data) require an explicit
 * confirmation round-trip from the renderer.
 *
 * Provider-agnostic: uses runAiChain (works with Gemini/OpenAI/Groq/Anthropic/
 * Ollama) and a JSON-intent prompt rather than vendor-specific function-calling.
 */
import { runAiChain, checkAiProviderReady } from './ai';
import { dashboardMetrics } from './analytics';
import { listArticles, searchArticles, createArticle } from './articles';
import { listTrends, fetchAllSources } from './trend-radar';
import { createLogger } from '../logger';

const log = createLogger('assistant');

export interface AssistantResult {
  ok: boolean;
  reply: string;            // short natural-language reply (in the user's language)
  tool: string;             // chosen tool name, or 'chat'
  data?: unknown;           // structured result of the tool, for the UI to render
  needsConfirm?: boolean;   // a sensitive tool awaits user confirmation
  pendingArgs?: Record<string, unknown>;
  error?: string;
}

interface ToolDef {
  name: string;
  desc: string;
  sensitive?: boolean;
  run: (args: Record<string, unknown>) => Promise<{ summary: string; data?: unknown }>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_stats',
    desc: 'إحصائيات لوحة التحكم: عدد المقالات والمنشورة والمعلّقة وعدد المصادر.',
    run: async () => {
      const m = dashboardMetrics() as { total?: number; published?: number; pending?: number; sources?: number };
      return {
        summary: `لديك ${m.total ?? 0} مقالاً (${m.published ?? 0} منشور، ${m.pending ?? 0} معلّق) و${m.sources ?? 0} مصدراً نشطاً.`,
        data: { total: m.total, published: m.published, pending: m.pending, sources: m.sources },
      };
    },
  },
  {
    name: 'fetch_trends',
    desc: 'جلب أحدث الترندات (المواضيع الرائجة) من المصادر.',
    run: async () => {
      const res = await fetchAllSources();
      const top = listTrends().slice(0, 8).map((t: { title?: string }) => t.title).filter(Boolean);
      return {
        summary: `جلبتُ الترندات: ${res.inserted} جديد. أبرزها: ${top.slice(0, 4).join('، ') || '—'}`,
        data: { ...res, top },
      };
    },
  },
  {
    name: 'list_articles',
    desc: 'عرض آخر المقالات. args: { limit?: number }',
    run: async (args) => {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
      const rows = listArticles({ limit }).map((a: { id: number; title: string; status: string }) => ({ id: a.id, title: a.title, status: a.status }));
      return { summary: `أحدث ${rows.length} مقالات.`, data: rows };
    },
  },
  {
    name: 'search_articles',
    desc: 'البحث في المقالات. args: { query: string }',
    run: async (args) => {
      const q = String(args.query ?? '').trim();
      if (!q) return { summary: 'لم تحدّد كلمة بحث.', data: [] };
      const rows = searchArticles(q, 15).map((a: { id: number; title: string; status: string }) => ({ id: a.id, title: a.title, status: a.status }));
      return { summary: `وجدتُ ${rows.length} نتيجة عن «${q}».`, data: rows };
    },
  },
  {
    name: 'create_draft',
    desc: 'إنشاء مسودّة مقال جديدة. args: { title: string, summary?: string }',
    sensitive: true,
    run: async (args) => {
      const title = String(args.title ?? '').trim() || 'مسودّة جديدة';
      const id = createArticle({ title, summary: String(args.summary ?? ''), status: 'draft', category: 'عام' });
      return { summary: `أنشأتُ مسودّة المقال «${title}» (رقم ${id}).`, data: { id, title } };
    },
  },
];

function buildIntentPrompt(command: string): string {
  const toolList = TOOLS.map((t) => `- ${t.name}: ${t.desc}${t.sensitive ? ' (حسّاس — يحتاج تأكيداً)' : ''}`).join('\n');
  return `أنت مساعد ذكي داخل برنامج EyesPro لإدارة ونشر الأخبار. حوّل أمر المستخدم إلى أداة واحدة من القائمة.

الأدوات المتاحة:
${toolList}
- chat: إذا كان الأمر مجرد سؤال أو محادثة عامة لا تطابق أداة.

أمر المستخدم: "${command}"

أعد حصراً JSON بهذا الشكل بلا أي نص أو علامات إضافية:
{"tool":"<اسم الأداة>","args":{...},"reply":"<ردّ عربي قصير ودود يشرح ما ستفعله أو إجابتك>"}`;
}

function parseIntent(raw: string): { tool: string; args: Record<string, unknown>; reply: string } | null {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const obj = tryParse(cleaned) ?? tryParse((cleaned.match(/\{[\s\S]*\}/) ?? [''])[0]);
  if (!obj || typeof obj.tool !== 'string') return null;
  return { tool: obj.tool, args: (obj.args && typeof obj.args === 'object') ? obj.args : {}, reply: String(obj.reply ?? '') };
}

/**
 * Run a natural-language command. When a sensitive tool is selected and not yet
 * confirmed, returns needsConfirm so the renderer can ask the user first.
 */
export async function runAssistant(command: string, confirmed = false): Promise<AssistantResult> {
  const text = String(command ?? '').trim();
  if (!text) return { ok: false, reply: 'لم أتلقَّ أمراً.', tool: 'chat', error: 'empty' };

  const health = await checkAiProviderReady();
  if (!health.ok) return { ok: false, reply: health.error ?? 'الذكاء الاصطناعي غير مُعدّ.', tool: 'chat', error: 'ai_unconfigured' };

  let intent: { tool: string; args: Record<string, unknown>; reply: string } | null = null;
  try {
    const raw = await runAiChain(buildIntentPrompt(text), '');
    intent = parseIntent(raw);
  } catch (e) {
    return { ok: false, reply: 'تعذّر فهم الأمر عبر الذكاء الاصطناعي.', tool: 'chat', error: (e as Error).message };
  }
  if (!intent) return { ok: false, reply: 'لم أفهم الأمر — أعد صياغته بطريقة أوضح.', tool: 'chat', error: 'parse_failed' };

  // Plain chat — no tool to run.
  if (intent.tool === 'chat' || intent.tool === 'none') {
    return { ok: true, reply: intent.reply || 'تم.', tool: 'chat' };
  }

  const tool = TOOLS.find((t) => t.name === intent!.tool);
  if (!tool) return { ok: true, reply: intent.reply || 'لم أجد أداة مناسبة.', tool: 'chat' };

  // Sensitive tools need an explicit confirmation first.
  if (tool.sensitive && !confirmed) {
    return { ok: true, reply: intent.reply || `هل تريد تنفيذ «${tool.name}»؟`, tool: tool.name, needsConfirm: true, pendingArgs: intent.args };
  }

  try {
    const r = await tool.run(intent.args);
    log.info('assistant tool executed', { tool: tool.name });
    return { ok: true, reply: intent.reply ? `${intent.reply}\n${r.summary}` : r.summary, tool: tool.name, data: r.data };
  } catch (e) {
    return { ok: false, reply: `فشل تنفيذ «${tool.name}».`, tool: tool.name, error: (e as Error).message };
  }
}
