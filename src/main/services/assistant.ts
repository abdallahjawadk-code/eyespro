/**
 * AI Assistant — natural-language control of EyesPro.
 *
 * The user types/speaks a command; we ask the user's configured AI provider to
 * map it to ONE curated, safe tool and return a small JSON intent, then execute
 * it against the existing services. Sensitive tools require an explicit
 * confirmation round-trip.
 *
 * Privacy: the ONLY data sent off-device is the prompt to the user's own chosen
 * AI provider. Command history ("memory") is stored locally in the encrypted DB
 * and used purely on-device for few-shot learning + proactive suggestions — it
 * never leaves the machine.
 */
import { runAiChain, checkAiProviderReady, resolveEffectiveAiProvider } from './ai';
import { dashboardMetrics } from './analytics';
import { listArticles, searchArticles, createArticle, getArticle } from './articles';
import { listTrends, fetchAllSources } from './trend-radar';
import { listSources, fetchAllEnabled } from './sources';
import { listMonitors, checkAllMonitors } from './competitor-monitor';
import { runAutopilotOnce } from './autopilot-loop';
import { generateArticle } from './ai-generator';
import { publishOne } from './publish';
import { setSetting } from './settings';
import { getDb } from '../db/database';
import { createLogger } from '../logger';

const log = createLogger('assistant');

export interface AssistantResult {
  ok: boolean;
  reply: string;
  tool: string;
  data?: unknown;
  navigate?: string;        // a route the UI should navigate to
  needsConfirm?: boolean;
  pendingArgs?: Record<string, unknown>;
  error?: string;
}

export interface AssistantSuggestion { text: string; command?: string }

interface ToolDef {
  name: string;
  desc: string;
  sensitive?: boolean;
  run: (args: Record<string, unknown>) => Promise<{ summary: string; data?: unknown; navigate?: string }>;
}

// ── Built-in help knowledge base (on-device, no AI needed) ────────────────────
const HELP: Record<string, string> = {
  general: 'EyesPro منصّة لإدارة ونشر الأخبار: تجلب الترندات والمصادر، تولّد المقالات بالذكاء الاصطناعي، تنشرها على المنصّات، وترصد المنافسين. ابدأ من «لوحة التحكم»، أضِف مصادرك من «المحتوى والمصادر»، وفعّل مزوّد ذكاء من «الإعدادات ← الذكاء الاصطناعي».',
  ai: 'لتفعيل الذكاء الاصطناعي: الإعدادات ← الذكاء الاصطناعي. اختر مزوّداً محلّياً (Ollama، بلا مفتاح) أو سحابياً (Gemini/OpenAI/Groq) بإدخال مفتاحه، ثم اضغط «تعيين كافتراضي». يمكنك إضافة عدة مزوّدين للدمج التلقائي.',
  newsroom: 'غرفة الأخبار (Autopilot): تجلب الترندات تلقائياً وتولّد مقالات منها ثم تمرّرها بخطّ المعالجة. شغّلها من قسم «غرفة الأخبار». تحتاج مزوّد ذكاء اصطناعي مُفعّلاً.',
  trends: 'رادار الترندات يجلب المواضيع الرائجة من مصادر متعددة. قل للمساعد «اجلب الترندات» أو افتح قسم الترندات.',
  publish: 'لنشر مقال: افتحه من «المقالات»، ثم اختر «نشر» وحدّد المنصّة. تحتاج ضبط مفاتيح المنصّة من الإعدادات أولاً.',
  sources: 'أضِف مصادر الأخبار (RSS/مواقع) من قسم «المحتوى والمصادر». ثم «اجلب المصادر» لتحديثها.',
  license: 'بعد انتهاء التجربة (3 أيام) أدخل رمز التفعيل (السيريال) في شاشة التفعيل. معرّف جهازك يُرسَل للبائع لإنشاء ترخيصك.',
  backup: 'النسخ الاحتياطي: الإعدادات ← نسخ احتياطي. انسخ الآن أو فعّل النسخ التلقائي، وصدّر نسخة محمولة لقرص خارجي.',
};

const SCREENS: Record<string, string> = {
  dashboard: '/dashboard', 'لوحة': '/dashboard', stats: '/dashboard',
  articles: '/articles', 'مقالات': '/articles',
  content: '/content', sources: '/content', 'مصادر': '/content',
  newsroom: '/autopilot', autopilot: '/autopilot', 'اخبار': '/autopilot',
  monitor: '/monitor', competitors: '/monitor', 'منافسين': '/monitor', 'رقابة': '/monitor',
  video: '/social-video', 'فيديو': '/social-video',
  schedule: '/schedule', 'جدولة': '/schedule',
  settings: '/settings', 'اعدادات': '/settings',
};

const TOOLS: ToolDef[] = [
  { name: 'get_stats', desc: 'إحصائيات لوحة التحكم (المقالات، المنشورة، المعلّقة، المصادر).', run: async () => {
    const m = dashboardMetrics() as { total?: number; published?: number; pending?: number; sources?: number };
    return { summary: `لديك ${m.total ?? 0} مقالاً (${m.published ?? 0} منشور، ${m.pending ?? 0} معلّق) و${m.sources ?? 0} مصدراً نشطاً.`, data: { total: m.total, published: m.published, pending: m.pending, sources: m.sources } };
  } },
  { name: 'list_articles', desc: 'عرض آخر المقالات. args:{limit?}', run: async (a) => {
    const limit = Math.min(20, Math.max(1, Number(a.limit) || 5));
    const rows = listArticles({ limit }).map((x: { id: number; title: string; status: string }) => ({ id: x.id, title: x.title, status: x.status }));
    return { summary: `أحدث ${rows.length} مقالات.`, data: rows };
  } },
  { name: 'search_articles', desc: 'البحث في المقالات. args:{query}', run: async (a) => {
    const q = String(a.query ?? '').trim();
    if (!q) return { summary: 'لم تحدّد كلمة بحث.', data: [] };
    const rows = searchArticles(q, 15).map((x: { id: number; title: string; status: string }) => ({ id: x.id, title: x.title, status: x.status }));
    return { summary: `وجدتُ ${rows.length} نتيجة عن «${q}».`, data: rows };
  } },
  { name: 'list_sources', desc: 'عرض مصادر الأخبار المضافة.', run: async () => {
    const rows = listSources().map((s: { id: number; name: string; enabled?: number }) => ({ id: s.id, title: s.name, status: s.enabled ? 'مفعّل' : 'متوقف' }));
    return { summary: `لديك ${rows.length} مصدراً.`, data: rows };
  } },
  { name: 'list_competitors', desc: 'عرض حسابات المنافسين المُراقَبة.', run: async () => {
    const rows = listMonitors().map((m: { id: number; name?: string; handle?: string }) => ({ id: m.id, title: m.name || m.handle || String(m.id) }));
    return { summary: `تراقب ${rows.length} منافساً.`, data: rows };
  } },
  { name: 'list_trends', desc: 'عرض الترندات الحالية المخزّنة (بلا جلب جديد).', run: async () => {
    const rows = listTrends().slice(0, 12).map((t: { id?: number; title?: string }) => ({ id: t.id, title: t.title }));
    return { summary: `لديك ${rows.length} ترنداً مخزّناً.`, data: rows };
  } },
  { name: 'fetch_trends', desc: 'جلب أحدث الترندات من المصادر (شبكة).', run: async () => {
    const r = await fetchAllSources();
    const top = listTrends().slice(0, 6).map((t: { title?: string }) => t.title).filter(Boolean);
    return { summary: `جلبتُ الترندات: ${r.inserted} جديد. أبرزها: ${top.slice(0, 4).join('، ') || '—'}`, data: { ...r, top } };
  } },
  { name: 'fetch_sources', desc: 'تحديث/جلب كل المصادر المفعّلة (شبكة).', run: async () => {
    const r = await fetchAllEnabled();
    return { summary: `حدّثتُ المصادر: ${r.total} مصدر (${r.failed} فشل).`, data: r };
  } },
  { name: 'check_competitors', desc: 'فحص منشورات المنافسين الجديدة (شبكة).', run: async () => {
    const r = await checkAllMonitors();
    return { summary: `فحصتُ ${r.checked} منافساً، ووجدتُ ${r.found} منشوراً جديداً.`, data: r };
  } },
  { name: 'open_screen', desc: 'فتح قسم في البرنامج. args:{screen} مثل dashboard/articles/content/newsroom/monitor/video/settings', run: async (a) => {
    const key = String(a.screen ?? '').toLowerCase().trim();
    const route = SCREENS[key] ?? Object.entries(SCREENS).find(([k]) => key.includes(k))?.[1];
    if (!route) return { summary: 'لم أتعرّف على القسم المطلوب.' };
    return { summary: 'فتحتُ القسم المطلوب.', navigate: route };
  } },
  { name: 'help', desc: 'شرح كيفية استخدام ميزة. args:{topic} مثل ai/newsroom/publish/trends/sources/license/backup/general', run: async (a) => {
    const topic = String(a.topic ?? 'general').toLowerCase();
    const key = Object.keys(HELP).find((k) => topic.includes(k)) ?? 'general';
    return { summary: HELP[key]!, data: { topic: key } };
  } },
  // ── sensitive (need confirmation) ──
  { name: 'create_draft', desc: 'إنشاء مسودّة مقال. args:{title, summary?}', sensitive: true, run: async (a) => {
    const title = String(a.title ?? '').trim() || 'مسودّة جديدة';
    const id = createArticle({ title, summary: String(a.summary ?? ''), status: 'draft', category: 'عام' });
    return { summary: `أنشأتُ مسودّة «${title}» (رقم ${id}).`, data: { id, title } };
  } },
  { name: 'run_newsroom', desc: 'تشغيل غرفة الأخبار: جلب ترندات وتوليد مقالات (يحتاج ذكاء اصطناعي).', sensitive: true, run: async () => {
    const r = await runAutopilotOnce();
    return { summary: `اكتملت غرفة الأخبار: وُلِّد ${r.generated} مقالاً من ${r.processed} ترند${r.errors.length ? ` (${r.errors.length} خطأ)` : ''}.`, data: { generated: r.generated, processed: r.processed, articleIds: r.articleIds } };
  } },
  { name: 'write_article', desc: 'كتابة مقال كامل عن موضوع بالذكاء الاصطناعي وحفظه مسودّة. args:{topic}', sensitive: true, run: async (a) => {
    const topic = String(a.topic ?? '').trim();
    if (!topic) return { summary: 'حدّد موضوع المقال الذي تريد كتابته.' };
    const r = await generateArticle(topic);
    if (!r.ok) return { summary: `تعذّرت الكتابة: ${r.error}` };
    return { summary: `كتبتُ مقالاً عن «${topic}»: «${r.title}» (رقم ${r.articleId}). تجده في المسودّات.`, data: { id: r.articleId, title: r.title } };
  } },
  { name: 'publish_article', desc: 'نشر مقال على منصّة. args:{platform, articleId?} — يُنشر أحدث مقال إن لم تحدّد رقماً.', sensitive: true, run: async (a) => {
    const platform = String(a.platform ?? '').toLowerCase().trim();
    if (!platform) return { summary: 'حدّد المنصّة (telegram/facebook/twitter/...).' };
    let id = Number(a.articleId) || 0;
    if (!id) id = (listArticles({ limit: 1 })[0] as { id?: number } | undefined)?.id ?? 0;
    if (!id) return { summary: 'لا يوجد مقال للنشر.' };
    const art = getArticle(id) as { title?: string; summary?: string; content?: string } | undefined;
    if (!art) return { summary: `لم أجد المقال رقم ${id}.` };
    const text = `${art.title ?? ''}\n\n${art.summary || art.content || ''}`.slice(0, 4000).trim();
    const out = await publishOne({ articleId: id, platform, text });
    return { summary: out.ok ? `نُشِر المقال «${art.title}» على ${platform}. ${out.postUrl ?? ''}` : `فشل النشر على ${platform}: ${out.error}`, data: out };
  } },
  { name: 'set_ai_provider', desc: 'تعيين مزوّد الذكاء الاصطناعي الافتراضي. args:{provider} مثل ollama/gemini/openai/groq/anthropic/off', sensitive: true, run: async (a) => {
    const p = String(a.provider ?? '').toLowerCase().trim();
    if (!['ollama', 'gemini', 'openai', 'groq', 'anthropic', 'off'].includes(p)) return { summary: 'مزوّد غير معروف. الخيارات: ollama, gemini, openai, groq, anthropic, off.' };
    setSetting('ai_provider', p);
    return { summary: p === 'off' ? 'أوقفتُ الذكاء الاصطناعي.' : `عيّنتُ مزوّد الذكاء الاصطناعي الافتراضي إلى ${p}.`, data: { provider: p } };
  } },
  { name: 'set_language', desc: 'تغيير لغة الواجهة. args:{lang} ar أو en', run: async (a) => {
    const l = String(a.lang ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
    setSetting('ui_language', l);
    return { summary: l === 'en' ? 'Set UI language to English (reopen to apply).' : 'غيّرتُ لغة الواجهة إلى العربية (أعد الفتح للتطبيق الكامل).', data: { lang: l } };
  } },
  // ── learning core ──
  { name: 'remember', desc: 'حفظ معلومة/تفضيل ليتذكّرها المساعد دائماً. args:{fact} مثل «أفضّل العناوين القصيرة».', run: async (a) => {
    const fact = String(a.fact ?? '').trim();
    if (!fact) return { summary: 'ماذا تريدني أن أتذكّر؟' };
    rememberFact(fact);
    return { summary: `حفظتُها وسأراعيها دائماً: «${fact}»`, data: { fact } };
  } },
  { name: 'recall_facts', desc: 'عرض ما تعلّمه المساعد عنك (تفضيلاتك ومعلوماتك).', run: async () => {
    const f = listFacts().map((x) => ({ id: x.id, title: x.content }));
    return { summary: f.length ? `أتذكّر ${f.length} معلومة عنك.` : 'لم أتعلّم شيئاً عنك بعد — علّمني بـ «تذكّر أنني…».', data: f };
  } },
  { name: 'ask_knowledge', desc: 'سؤال يُجاب من بياناتك (مقالاتك/إحصاءاتك/تفضيلاتك). args:{question} مثل «ماذا نشرتُ عن X؟»', run: async (a) => {
    const q = String(a.question ?? '').trim();
    if (!q) return { summary: 'ما سؤالك؟' };
    const ctx = retrieveContext(q);
    const answer = await runAiChain(
      `أنت مساعد EyesPro. أجب عن سؤال المستخدم اعتماداً حصرياً على بياناته أدناه، بإيجاز ودقّة وبالعربية. إن لم تكفِ البيانات قل ذلك بوضوح.\n\nبيانات المستخدم:${ctx}\n\nالسؤال: ${q}`,
      '',
    );
    return { summary: answer.trim() || 'لم أجد إجابة في بياناتك.', data: { grounded: true } };
  } },
];

// ── local memory (few-shot learning, on-device only) ──────────────────────────
function recordMemory(command: string, tool: string, success: boolean): void {
  try { getDb().prepare(`INSERT INTO assistant_memory (command, tool, success) VALUES (?, ?, ?)`).run(command.slice(0, 300), tool, success ? 1 : 0); } catch { /* non-fatal */ }
}

// ── learning core: facts/preferences the user teaches the assistant ───────────
function rememberFact(content: string, kind = 'fact'): void {
  try { getDb().prepare(`INSERT INTO assistant_facts (kind, content) VALUES (?, ?)`).run(kind, content.slice(0, 500)); } catch { /* non-fatal */ }
}
function listFacts(): { id: number; content: string }[] {
  try { return getDb().prepare(`SELECT id, content FROM assistant_facts ORDER BY created_at DESC LIMIT 40`).all() as { id: number; content: string }[]; } catch { return []; }
}
function factsBlock(): string {
  const f = listFacts();
  return f.length ? '\nما تعلّمتُه عنك (راعِه دائماً):\n' + f.map((x) => `• ${x.content}`).join('\n') : '';
}

/**
 * RAG: gather the user's own data relevant to a question (their articles + facts +
 * live stats) so the AI answers grounded in the program's data — never leaves the
 * device except as prompt context to the user's chosen provider.
 */
function retrieveContext(question: string): string {
  const parts: string[] = [];
  const words = question.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  const seen = new Set<number>();
  for (const w of words) {
    for (const a of searchArticles(w, 4) as { id: number; title: string; summary?: string; status: string }[]) {
      if (seen.has(a.id)) continue; seen.add(a.id);
      parts.push(`- [${a.status}] ${a.title}${a.summary ? ` — ${a.summary.slice(0, 120)}` : ''}`);
      if (seen.size >= 8) break;
    }
    if (seen.size >= 8) break;
  }
  const m = dashboardMetrics() as { total?: number; published?: number; pending?: number; sources?: number };
  const facts = listFacts();
  let ctx = '';
  if (parts.length) ctx += `\nمقالات ذات صلة من بياناتك:\n${parts.join('\n')}`;
  ctx += `\nأرقام عامة: ${m.total ?? 0} مقال، ${m.published ?? 0} منشور، ${m.sources ?? 0} مصدر.`;
  if (facts.length) ctx += `\nتفضيلاتك: ${facts.map((f) => f.content).join('؛ ')}`;
  return ctx;
}

/** Recent successful command→tool pairs, to teach the model this user's phrasing. */
function fewShotExamples(): string {
  try {
    const rows = getDb().prepare(
      `SELECT command, tool FROM assistant_memory WHERE success=1 AND tool NOT IN ('chat','help')
       GROUP BY tool ORDER BY MAX(created_at) DESC LIMIT 6`
    ).all() as { command: string; tool: string }[];
    if (!rows.length) return '';
    return '\nأمثلة من استخدامك السابق (تعلّمها):\n' + rows.map((r) => `«${r.command}» → ${r.tool}`).join('\n');
  } catch { return ''; }
}

function buildIntentPrompt(command: string): string {
  const toolList = TOOLS.map((t) => `- ${t.name}: ${t.desc}${t.sensitive ? ' (حسّاس)' : ''}`).join('\n');
  return `أنت مساعد ذكي داخل برنامج EyesPro لإدارة ونشر الأخبار. حوّل أمر المستخدم إلى أداة واحدة.

الأدوات:
${toolList}
- chat: سؤال/محادثة عامة لا تطابق أداة.
${factsBlock()}${fewShotExamples()}

أمر المستخدم: "${command}"
(إن كان سؤالاً عن بيانات المستخدم نفسه — مقالاته أو نشره — فاستخدم ask_knowledge.)

أعد حصراً JSON بلا أي نص إضافي:
{"tool":"<اسم>","args":{...},"reply":"<ردّ عربي قصير ودود>"}`;
}

function parseIntent(raw: string): { tool: string; args: Record<string, unknown>; reply: string } | null {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const obj = tryParse(cleaned) ?? tryParse((cleaned.match(/\{[\s\S]*\}/) ?? [''])[0]);
  if (!obj || typeof obj.tool !== 'string') return null;
  return { tool: obj.tool, args: (obj.args && typeof obj.args === 'object') ? obj.args : {}, reply: String(obj.reply ?? '') };
}

export async function runAssistant(command: string, confirmed = false): Promise<AssistantResult> {
  const text = String(command ?? '').trim();
  if (!text) return { ok: false, reply: 'لم أتلقَّ أمراً.', tool: 'chat', error: 'empty' };

  const health = await checkAiProviderReady();
  if (!health.ok) {
    return { ok: false, tool: 'chat', error: 'ai_unconfigured',
      reply: `${health.error ?? 'الذكاء الاصطناعي غير مُعدّ.'}\n💡 ${HELP.ai}` };
  }

  let intent: { tool: string; args: Record<string, unknown>; reply: string } | null = null;
  try {
    intent = parseIntent(await runAiChain(buildIntentPrompt(text), ''));
  } catch (e) {
    return { ok: false, reply: 'تعذّر فهم الأمر عبر الذكاء الاصطناعي.', tool: 'chat', error: (e as Error).message };
  }
  if (!intent) return { ok: false, reply: 'لم أفهم الأمر — أعد صياغته بطريقة أوضح، أو قل «ماذا تستطيع أن تفعل؟».', tool: 'chat', error: 'parse_failed' };

  if (intent.tool === 'chat' || intent.tool === 'none') return { ok: true, reply: intent.reply || 'تم.', tool: 'chat' };

  const tool = TOOLS.find((t) => t.name === intent!.tool);
  if (!tool) return { ok: true, reply: intent.reply || 'لم أجد أداة مناسبة.', tool: 'chat' };

  if (tool.sensitive && !confirmed) {
    return { ok: true, reply: intent.reply || `هل تريد تنفيذ «${tool.name}»؟`, tool: tool.name, needsConfirm: true, pendingArgs: intent.args };
  }

  try {
    const r = await tool.run(intent.args);
    recordMemory(text, tool.name, true);
    log.info('assistant tool executed', { tool: tool.name });
    return { ok: true, reply: intent.reply ? `${intent.reply}\n${r.summary}` : r.summary, tool: tool.name, data: r.data, navigate: r.navigate };
  } catch (e) {
    recordMemory(text, tool.name, false);
    return { ok: false, reply: `فشل تنفيذ «${tool.name}»: ${(e as Error).message}`, tool: tool.name, error: (e as Error).message };
  }
}

/**
 * Proactive suggestions based on the current app state — shown when the robot
 * opens, even if the user hasn't asked. Pure on-device heuristics.
 */
export function getSuggestions(): { greeting: string; suggestions: AssistantSuggestion[] } {
  const s: AssistantSuggestion[] = [];
  try {
    const provider = resolveEffectiveAiProvider();
    if (provider === 'unconfigured' || provider === 'off') {
      s.push({ text: '⚙️ لم تُفعّل الذكاء الاصطناعي بعد — لنفعّله من الإعدادات.', command: 'افتح الإعدادات' });
    }
    const m = dashboardMetrics() as { sources?: number; pending?: number };
    if (!m.sources) s.push({ text: '📡 لا توجد مصادر بعد — أضِف مصادر أخبار لتبدأ.', command: 'افتح المحتوى والمصادر' });
    else s.push({ text: '🔥 هل أجلب لك آخر الترندات الآن؟', command: 'اجلب الترندات' });
    if ((m.pending ?? 0) > 0) s.push({ text: `📝 لديك ${m.pending} مقالاً معلّقاً — هل تريد عرضها؟`, command: 'اعرض آخر المقالات' });
    s.push({ text: '🤖 جرّب: «شغّل غرفة الأخبار» أو «كم عدد المقالات» أو «ماذا تستطيع أن تفعل؟».' });
  } catch { /* ignore */ }
  return {
    greeting: 'مرحباً! أنا مساعدك الذكي 🤖 — مرّر أوامرك بالكلام وسأنفّذها. هذه بعض الاقتراحات:',
    suggestions: s.slice(0, 4),
  };
}
