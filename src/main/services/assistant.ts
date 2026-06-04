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
import { runAiChain, checkAiProviderReady, resolveEffectiveAiProvider, formatAiErrorMessage } from './ai';
import { runAiRouted, isPrivacyBlocked } from './ai-privacy';
import { generateSourceProposals, listProposals, approveProposal, rejectProposal, countPending, getAutonomyConfig, setAutonomyConfig, countAutoApprovedToday, listAutoApproved } from './copilot';
import { dashboardMetrics } from './analytics';
import { listArticles, searchArticles, createArticle, getArticle } from './articles';
import { listTrends, fetchAllSources } from './trend-radar';
import { listSources, fetchAllEnabled } from './sources';
import { listMonitors, checkAllMonitors, groupSnapshotsIntoSemanticClusters, synthesizeArticleFromSnapshots } from './competitor-monitor';
import { scrapeGoogleNews } from './scrapers/google-news-scraper';
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

/** UI language the user is currently viewing. Drives every user-facing string. */
export type Lang = 'ar' | 'en';
/** Pick the string matching the active language. */
function L(lang: Lang, ar: string, en: string): string { return lang === 'en' ? en : ar; }

interface ToolDef {
  name: string;
  desc: string;
  sensitive?: boolean;
  run: (args: Record<string, unknown>, lang: Lang) => Promise<{ summary: string; data?: unknown; navigate?: string }>;
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

const HELP_EN: Record<string, string> = {
  general: 'EyesPro is a news management & publishing platform: it fetches trends and sources, generates AI articles, publishes them across platforms, and monitors competitors. Start from the Dashboard, add your sources under Content & Sources, and enable an AI provider in Settings → AI.',
  ai: 'To enable AI: Settings → AI. Pick a local provider (Ollama, no key) or a cloud one (Gemini/OpenAI/Groq) by entering its key, then click "Set as default". You can add several providers for automatic fallback.',
  newsroom: 'Newsroom (Autopilot) fetches trends automatically, generates articles from them, then runs them through the processing pipeline. Launch it from the Newsroom section. It needs an active AI provider.',
  trends: 'The Trend Radar fetches trending topics from multiple sources. Tell the assistant "fetch trends" or open the Trends section.',
  publish: 'To publish an article: open it under Articles, choose "Publish" and pick a platform. You must configure the platform keys in Settings first.',
  sources: 'Add news sources (RSS/sites) under Content & Sources. Then "fetch sources" to update them.',
  license: 'After the trial (3 days) ends, enter your activation code (serial) on the activation screen. Your device ID is sent to the vendor to issue your license.',
  backup: 'Backup: Settings → Backup. Back up now or enable automatic backups, and export a portable copy to an external drive.',
};

function help(lang: Lang, key: string): string { return (lang === 'en' ? HELP_EN[key] : HELP[key]) ?? (lang === 'en' ? HELP_EN.general : HELP.general)!; }

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
  { name: 'get_stats', desc: 'إحصائيات لوحة التحكم (المقالات، المنشورة، المعلّقة، المصادر).', run: async (_a, lang) => {
    const m = dashboardMetrics() as { total?: number; published?: number; pending?: number; sources?: number };
    return { summary: L(lang,
      `لديك ${m.total ?? 0} مقالاً (${m.published ?? 0} منشور، ${m.pending ?? 0} معلّق) و${m.sources ?? 0} مصدراً نشطاً.`,
      `You have ${m.total ?? 0} articles (${m.published ?? 0} published, ${m.pending ?? 0} pending) and ${m.sources ?? 0} active sources.`,
    ), data: { total: m.total, published: m.published, pending: m.pending, sources: m.sources } };
  } },
  { name: 'list_articles', desc: 'عرض آخر المقالات. args:{limit?}', run: async (a, lang) => {
    const limit = Math.min(20, Math.max(1, Number(a.limit) || 5));
    const rows = listArticles({ limit }).map((x: { id: number; title: string; status: string }) => ({ id: x.id, title: x.title, status: x.status }));
    return { summary: L(lang, `أحدث ${rows.length} مقالات.`, `Latest ${rows.length} articles.`), data: rows };
  } },
  { name: 'search_articles', desc: 'البحث في المقالات. args:{query}', run: async (a, lang) => {
    const q = String(a.query ?? '').trim();
    if (!q) return { summary: L(lang, 'لم تحدّد كلمة بحث.', 'No search term provided.'), data: [] };
    const rows = searchArticles(q, 15).map((x: { id: number; title: string; status: string }) => ({ id: x.id, title: x.title, status: x.status }));
    return { summary: L(lang, `وجدتُ ${rows.length} نتيجة عن «${q}».`, `Found ${rows.length} results for "${q}".`), data: rows };
  } },
  { name: 'list_sources', desc: 'عرض مصادر الأخبار المضافة.', run: async (_a, lang) => {
    const rows = listSources().map((s: { id: number; name: string; enabled?: number }) => ({ id: s.id, title: s.name, status: s.enabled ? L(lang, 'مفعّل', 'Enabled') : L(lang, 'متوقف', 'Disabled') }));
    return { summary: L(lang, `لديك ${rows.length} مصدراً.`, `You have ${rows.length} sources.`), data: rows };
  } },
  { name: 'list_competitors', desc: 'عرض حسابات المنافسين المُراقَبة.', run: async (_a, lang) => {
    const rows = listMonitors().map((m: { id: number; name?: string; handle?: string }) => ({ id: m.id, title: m.name || m.handle || String(m.id) }));
    return { summary: L(lang, `تراقب ${rows.length} منافساً.`, `You are monitoring ${rows.length} competitors.`), data: rows };
  } },
  { name: 'list_trends', desc: 'عرض الترندات الحالية المخزّنة (بلا جلب جديد).', run: async (_a, lang) => {
    const rows = listTrends().slice(0, 12).map((t: { id?: number; title?: string }) => ({ id: t.id, title: t.title }));
    return { summary: L(lang, `لديك ${rows.length} ترنداً مخزّناً.`, `You have ${rows.length} stored trends.`), data: rows };
  } },
  { name: 'fetch_trends', desc: 'جلب أحدث الترندات من المصادر (شبكة).', run: async (_a, lang) => {
    const r = await fetchAllSources();
    const trends = listTrends();
    const top = trends.slice(0, 6).map((t: { title?: string }) => t.title).filter(Boolean);
    const topText = top.slice(0, 4).join(L(lang, '، ', ', ')) || '—';
    // Perception: let live trends corroborate (and strengthen) the user's interests.
    const perceived = perceive(trends.slice(0, 30).map((t: { title?: string }) => ({ title: t.title })), { source: 'trends' });
    const note = perceived.reinforced.length
      ? L(lang, ` وعزّزتُ اهتمامك بـ ${perceived.reinforced.length} موضوع.`, ` Reinforced ${perceived.reinforced.length} of your interests.`)
      : '';
    return { summary: L(lang,
      `جلبتُ الترندات: ${r.inserted} جديد. أبرزها: ${topText}`,
      `Fetched trends: ${r.inserted} new. Top: ${topText}`,
    ) + note, data: { ...r, top, reinforced: perceived.reinforced } };
  } },
  { name: 'fetch_sources', desc: 'تحديث/جلب كل المصادر المفعّلة (شبكة).', run: async (_a, lang) => {
    const r = await fetchAllEnabled();
    return { summary: L(lang, `حدّثتُ المصادر: ${r.total} مصدر (${r.failed} فشل).`, `Updated sources: ${r.total} sources (${r.failed} failed).`), data: r };
  } },
  { name: 'check_competitors', desc: 'فحص منشورات المنافسين الجديدة (شبكة).', run: async (_a, lang) => {
    const r = await checkAllMonitors();
    return { summary: L(lang, `فحصتُ ${r.checked} منافساً، ووجدتُ ${r.found} منشوراً جديداً.`, `Checked ${r.checked} competitors, found ${r.found} new posts.`), data: r };
  } },
  { name: 'open_screen', desc: 'فتح قسم في البرنامج. args:{screen} مثل dashboard/articles/content/newsroom/monitor/video/settings', run: async (a, lang) => {
    const key = String(a.screen ?? '').toLowerCase().trim();
    const route = SCREENS[key] ?? Object.entries(SCREENS).find(([k]) => key.includes(k))?.[1];
    if (!route) return { summary: L(lang, 'لم أتعرّف على القسم المطلوب.', "I couldn't recognize the requested section.") };
    return { summary: L(lang, 'فتحتُ القسم المطلوب.', 'Opened the requested section.'), navigate: route };
  } },
  { name: 'help', desc: 'شرح كيفية استخدام ميزة. args:{topic} مثل ai/newsroom/publish/trends/sources/license/backup/general', run: async (a, lang) => {
    const topic = String(a.topic ?? 'general').toLowerCase();
    const key = Object.keys(HELP).find((k) => topic.includes(k)) ?? 'general';
    return { summary: help(lang, key), data: { topic: key } };
  } },
  // ── sensitive (need confirmation) ──
  { name: 'create_draft', desc: 'إنشاء مسودّة مقال. args:{title, summary?}', sensitive: true, run: async (a, lang) => {
    const title = String(a.title ?? '').trim() || L(lang, 'مسودّة جديدة', 'New draft');
    const id = createArticle({ title, summary: String(a.summary ?? ''), status: 'draft', category: L(lang, 'عام', 'General') });
    return { summary: L(lang, `أنشأتُ مسودّة «${title}» (رقم ${id}).`, `Created draft "${title}" (#${id}).`), data: { id, title } };
  } },
  { name: 'run_newsroom', desc: 'تشغيل غرفة الأخبار: جلب ترندات وتوليد مقالات (يحتاج ذكاء اصطناعي).', sensitive: true, run: async (_a, lang) => {
    const r = await runAutopilotOnce();
    return { summary: L(lang,
      `اكتملت غرفة الأخبار: وُلِّد ${r.generated} مقالاً من ${r.processed} ترند${r.errors.length ? ` (${r.errors.length} خطأ)` : ''}.`,
      `Newsroom finished: generated ${r.generated} articles from ${r.processed} trends${r.errors.length ? ` (${r.errors.length} errors)` : ''}.`,
    ), data: { generated: r.generated, processed: r.processed, articleIds: r.articleIds } };
  } },
  { name: 'write_article', desc: 'كتابة مقال كامل عن موضوع بالذكاء الاصطناعي وحفظه مسودّة. args:{topic}', sensitive: true, run: async (a, lang) => {
    const topic = String(a.topic ?? '').trim();
    if (!topic) return { summary: L(lang, 'حدّد موضوع المقال الذي تريد كتابته.', 'Specify the topic of the article you want written.') };
    const r = await generateArticle(topic);
    if (!r.ok) return { summary: L(lang, `تعذّرت الكتابة: ${r.error}`, `Writing failed: ${r.error}`) };
    return { summary: L(lang,
      `كتبتُ مقالاً عن «${topic}»: «${r.title}» (رقم ${r.articleId}). تجده في المسودّات.`,
      `Wrote an article about "${topic}": "${r.title}" (#${r.articleId}). You'll find it in Drafts.`,
    ), data: { id: r.articleId, title: r.title } };
  } },
  { name: 'publish_article', desc: 'نشر مقال على منصّة. args:{platform, articleId?} — يُنشر أحدث مقال إن لم تحدّد رقماً.', sensitive: true, run: async (a, lang) => {
    const platform = String(a.platform ?? '').toLowerCase().trim();
    if (!platform) return { summary: L(lang, 'حدّد المنصّة (telegram/facebook/twitter/...).', 'Specify the platform (telegram/facebook/twitter/...).') };
    let id = Number(a.articleId) || 0;
    if (!id) id = (listArticles({ limit: 1 })[0] as { id?: number } | undefined)?.id ?? 0;
    if (!id) return { summary: L(lang, 'لا يوجد مقال للنشر.', 'There is no article to publish.') };
    const art = getArticle(id) as { title?: string; summary?: string; content?: string } | undefined;
    if (!art) return { summary: L(lang, `لم أجد المقال رقم ${id}.`, `Article #${id} not found.`) };
    const text = `${art.title ?? ''}\n\n${art.summary || art.content || ''}`.slice(0, 4000).trim();
    const out = await publishOne({ articleId: id, platform, text });
    return { summary: out.ok
      ? L(lang, `نُشِر المقال «${art.title}» على ${platform}. ${out.postUrl ?? ''}`, `Published "${art.title}" to ${platform}. ${out.postUrl ?? ''}`)
      : L(lang, `فشل النشر على ${platform}: ${out.error}`, `Publishing to ${platform} failed: ${out.error}`), data: out };
  } },
  { name: 'set_ai_provider', desc: 'تعيين مزوّد الذكاء الاصطناعي الافتراضي. args:{provider} مثل ollama/gemini/openai/groq/anthropic/off', sensitive: true, run: async (a, lang) => {
    const p = String(a.provider ?? '').toLowerCase().trim();
    if (!['ollama', 'gemini', 'openai', 'groq', 'anthropic', 'off'].includes(p)) return { summary: L(lang, 'مزوّد غير معروف. الخيارات: ollama, gemini, openai, groq, anthropic, off.', 'Unknown provider. Options: ollama, gemini, openai, groq, anthropic, off.') };
    setSetting('ai_provider', p);
    return { summary: p === 'off'
      ? L(lang, 'أوقفتُ الذكاء الاصطناعي.', 'AI turned off.')
      : L(lang, `عيّنتُ مزوّد الذكاء الاصطناعي الافتراضي إلى ${p}.`, `Set the default AI provider to ${p}.`), data: { provider: p } };
  } },
  { name: 'set_language', desc: 'تغيير لغة الواجهة. args:{lang} ar أو en', run: async (a) => {
    const l = String(a.lang ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
    setSetting('ui_language', l);
    return { summary: l === 'en' ? 'Set UI language to English (reopen to apply).' : 'غيّرتُ لغة الواجهة إلى العربية (أعد الفتح للتطبيق الكامل).', data: { lang: l } };
  } },
  { name: 'set_privacy', desc: 'ضبط وضع الخصوصية لتحليل البيانات. args:{mode} local_only (محلي بالكامل) / hybrid (هجين) / cloud (سحابي).', run: async (a, lang) => {
    const raw = String(a.mode ?? '').toLowerCase();
    const mode = raw.includes('local') || raw.includes('محل') ? 'local_only'
      : raw.includes('cloud') || raw.includes('سحاب') ? 'cloud'
      : raw.includes('hybrid') || raw.includes('هجين') || raw.includes('مختلط') ? 'hybrid' : '';
    if (!mode) return { summary: L(lang, 'حدّد الوضع: محلي / هجين / سحابي.', 'Specify the mode: local / hybrid / cloud.') };
    setSetting('privacy_mode', mode);
    const labels: Record<string, [string, string]> = {
      local_only: ['محلي بالكامل — لا شيء يغادر جهازك.', 'Fully local — nothing leaves your device.'],
      hybrid: ['هجين — بياناتك الخاصة محلية، والعام عبر السحابة.', 'Hybrid — your private data stays local, public work may use the cloud.'],
      cloud: ['سحابي — تُرسَل البيانات لمزوّد الذكاء الاصطناعي.', 'Cloud — data is sent to the AI provider.'],
    };
    return { summary: L(lang, `ضبطتُ وضع الخصوصية: ${labels[mode][0]}`, `Privacy mode set: ${labels[mode][1]}`), data: { mode } };
  } },
  // ── learning core ──
  { name: 'remember', desc: 'حفظ معلومة/تفضيل ليتذكّرها المساعد دائماً. args:{fact} مثل «أفضّل العناوين القصيرة».', run: async (a, lang) => {
    const fact = String(a.fact ?? '').trim();
    if (!fact) return { summary: L(lang, 'ماذا تريدني أن أتذكّر؟', 'What would you like me to remember?') };
    rememberFact(fact, 'fact', { source: 'user', trust: 1, observed: true }); // told directly by the user
    return { summary: L(lang, `حفظتُها وسأراعيها دائماً: «${fact}»`, `Saved — I'll always keep it in mind: "${fact}"`), data: { fact } };
  } },
  { name: 'recall_facts', desc: 'عرض ما تعلّمه المساعد عنك (تفضيلاتك ومعلوماتك) مرتّبة حسب قوّتها.', run: async (_a, lang) => {
    // Strongest synapses first; ★ count reflects effective strength (1–5).
    // Provenance is surfaced so the user can audit *where* each memory came from.
    const f = listFacts().map((x) => ({
      id: x.id,
      title: `${'★'.repeat(Math.max(1, Math.round(x.strength)))} ${x.content}${x.observed ? '' : L(lang, ' (استنتاج)', ' (inferred)')}`,
      strength: Math.round(x.strength * 100) / 100,
      trust: Math.round(x.trust * 100) / 100,
      source: x.source,
      hits: x.hits,
    }));
    return { summary: f.length
      ? L(lang, `أتذكّر ${f.length} معلومة عنك (الأقوى أولاً).`, `I remember ${f.length} things about you (strongest first).`)
      : L(lang, 'لم أتعلّم شيئاً عنك بعد — علّمني بـ «تذكّر أنني…».', "I haven't learned anything about you yet — teach me with \"remember that I…\"."), data: f };
  } },
  { name: 'forget', desc: 'إضعاف/نسيان معلومة تعلّمها المساعد. args:{fact} نصّ المعلومة أو جزء منها.', run: async (a, lang) => {
    const q = String(a.fact ?? '').trim();
    if (!q) return { summary: L(lang, 'ما المعلومة التي تريدني أن أنساها؟', 'Which fact would you like me to forget?') };
    const matches = rawFacts()
      .map((row) => ({ id: row.id, content: row.content, sim: factSimilarity(row.content, q) }))
      .filter((m) => m.sim >= 0.3 || m.content.includes(q))
      .sort((x, y) => y.sim - x.sim)
      .slice(0, 3);
    if (!matches.length) return { summary: L(lang, 'لم أجد معلومة مطابقة لأنساها.', "I couldn't find a matching fact to forget.") };
    for (const m of matches) weakenFact(m.id);
    return { summary: L(lang, `أضعفتُ ${matches.length} معلومة وسأنساها تدريجياً.`, `Weakened ${matches.length} fact(s); I'll fade them out.`), data: matches.map((m) => ({ id: m.id, title: m.content })) };
  } },
  { name: 'ask_knowledge', desc: 'سؤال يُجاب من بياناتك (مقالاتك/إحصاءاتك/تفضيلاتك). args:{question} مثل «ماذا نشرتُ عن X؟»', run: async (a, lang) => {
    const q = String(a.question ?? '').trim();
    if (!q) return { summary: L(lang, 'ما سؤالك؟', "What's your question?") };
    const ctx = retrieveContext(q);
    // Grounded on the user's private corpus → route under the privacy policy (local in hybrid).
    let routed;
    try {
      routed = await runAiRouted(L(lang,
        `أنت مساعد EyesPro. أجب عن سؤال المستخدم اعتماداً حصرياً على بياناته أدناه، بإيجاز ودقّة وبالعربية. إن لم تكفِ البيانات قل ذلك بوضوح.\n\nبيانات المستخدم:${ctx}\n\nالسؤال: ${q}`,
        `You are the EyesPro assistant. Answer the user's question relying solely on their data below, concisely and accurately in English. If the data is insufficient, say so clearly.\n\nUser data:${ctx}\n\nQuestion: ${q}`,
      ), '', { sensitive: true });
    } catch (e) {
      if (isPrivacyBlocked(e)) return { summary: L(lang,
        'هذا السؤال يمسّ بياناتك الخاصة، ووضع الخصوصية يمنع إرسالها للسحابة. فعّل نموذجاً محلياً (Ollama) أو قل «اجعل الخصوصية سحابية» للسماح.',
        'This question touches your private data, and your privacy mode blocks sending it to the cloud. Enable a local model (Ollama) or say "set privacy to cloud" to allow it.',
      ), data: { blocked: true } };
      throw e;
    }
    return { summary: routed.text.trim() || L(lang, 'لم أجد إجابة في بياناتك.', "I couldn't find an answer in your data."), data: { grounded: true, via: routed.via } };
  } },
  { name: 'get_semantic_clusters', desc: 'عرض الأخبار المتشابهة والمجمعة دلالياً للمنافسين ومقارنة الفروق بينها.', run: async (_a, lang) => {
    const clusters = await groupSnapshotsIntoSemanticClusters();
    const rows = clusters.map(c => ({
      clusterId: c.clusterId,
      mainTitle: c.main.title,
      duplicatesCount: c.duplicates.length,
      diffSummary: c.diffSummary
    }));
    return { summary: L(lang, `وجدتُ ${clusters.length} مجموعة إخبارية مجمعة دلالياً.`, `Found ${clusters.length} semantically clustered news groups.`), data: rows };
  } },
  { name: 'synthesize_news', desc: 'دمج وتوليف مقال صحفي مدمج من عدة معرّفاتsnapshots للمنافسين. args:{snapshotIds: [number, number, ...]}', sensitive: true, run: async (a, lang) => {
    let ids: number[] = [];
    if (Array.isArray(a.snapshotIds)) {
      ids = a.snapshotIds.map(Number).filter(Boolean);
    } else if (typeof a.snapshotIds === 'string') {
      ids = a.snapshotIds.split(',').map(Number).filter(Boolean);
    }
    if (!ids.length) return { summary: L(lang, 'لم يتم تحديد معرّفات اللقطات الإخبارية للدمج.', 'No news snapshot IDs were specified to merge.') };
    const articleId = await synthesizeArticleFromSnapshots(ids);
    return { summary: L(lang,
      `تم بنجاح توليف ودمج الأخبار في مسودة مقال جديدة (رقم ${articleId}) تجدها في المسودات.`,
      `Successfully synthesized and merged the news into a new draft article (#${articleId}), found in Drafts.`,
    ), data: { id: articleId } };
  } },
  { name: 'list_recommended_sources', desc: 'عرض مصادر الأخبار المقترحة تلقائياً التي اكتشفها المساعد.', run: async (_a, lang) => {
    const recs = listFacts().filter(x => x.content.includes('مصدر مقترح:')).map(x => ({ id: x.id, content: x.content }));
    return { summary: recs.length
      ? L(lang, `وجدتُ ${recs.length} مصدراً مقترحاً لك.`, `Found ${recs.length} recommended sources for you.`)
      : L(lang, 'لم يتم اكتشاف مصادر مقترحة جديدة بعد.', 'No new recommended sources discovered yet.'), data: recs };
  } },
  // ── co-pilot: review & decide on the assistant's proposed actions ──
  { name: 'review_proposals', desc: 'عرض مقترحات المساعد المعلّقة (إضافة مصادر مكتشفة، مراقبة منافسين) للموافقة أو الرفض.', run: async (_a, lang) => {
    generateSourceProposals(); // refresh from latest discoveries
    const pending = listProposals('pending');
    const rows = pending.map((p) => ({ id: p.id, title: `#${p.id} — ${p.title}`, kind: p.kind, confidence: p.confidence }));
    return { summary: pending.length
      ? L(lang, `لديك ${pending.length} مقترحاً بانتظار قرارك. قل «وافق على رقم X» أو «ارفض رقم X».`, `You have ${pending.length} proposals awaiting your decision. Say "approve #X" or "reject #X".`)
      : L(lang, 'لا توجد مقترحات معلّقة حالياً.', 'No pending proposals right now.'), data: rows };
  } },
  { name: 'approve_proposal', desc: 'الموافقة على مقترح وتنفيذه. args:{id} رقم المقترح، أو {all:true} للموافقة على الكل.', sensitive: true, run: async (a, lang) => {
    const ids = a.all === true ? listProposals('pending').map((p) => p.id) : [Number(a.id) || 0].filter(Boolean);
    if (!ids.length) return { summary: L(lang, 'حدّد رقم المقترح للموافقة عليه.', 'Specify the proposal id to approve.') };
    const done: number[] = []; const failed: string[] = [];
    for (const id of ids) { const r = approveProposal(id); if (r.ok) done.push(id); else failed.push(`#${id}: ${r.error}`); }
    return { summary: L(lang,
      `نُفِّذ ${done.length} مقترح${failed.length ? ` (تعذّر: ${failed.join('، ')})` : ''}.`,
      `Executed ${done.length} proposal(s)${failed.length ? ` (failed: ${failed.join(', ')})` : ''}.`,
    ), data: { approved: done, failed } };
  } },
  { name: 'reject_proposal', desc: 'رفض مقترح. args:{id} رقم المقترح، أو {all:true} لرفض الكل.', run: async (a, lang) => {
    const ids = a.all === true ? listProposals('pending').map((p) => p.id) : [Number(a.id) || 0].filter(Boolean);
    if (!ids.length) return { summary: L(lang, 'حدّد رقم المقترح لرفضه.', 'Specify the proposal id to reject.') };
    let n = 0; for (const id of ids) { if (rejectProposal(id).ok) n++; }
    return { summary: L(lang, `رفضتُ ${n} مقترحاً.`, `Rejected ${n} proposal(s).`), data: { rejected: n } };
  } },
  // ── guarded autonomy: configure & audit what the assistant may do on its own ──
  { name: 'set_autonomy', desc: 'ضبط الاستقلالية. args:{level} off/suggest/auto، {cap?} السقف اليومي.', sensitive: true, run: async (a, lang) => {
    const raw = `${a.level ?? ''}`.toLowerCase();
    const level = raw.includes('auto') || raw.includes('تلقائ') ? 'auto_safe'
      : raw.includes('off') || raw.includes('إيقاف') || raw.includes('ايقاف') || raw.includes('عطّل') ? 'off'
      : raw.includes('suggest') || raw.includes('اقترا') || raw.includes('اقترح') ? 'suggest' : '';
    if (!level) return { summary: L(lang, 'حدّد المستوى: إيقاف / اقتراح / تلقائي.', 'Specify the level: off / suggest / auto.') };
    const cap = Number(a.cap);
    const cfg = setAutonomyConfig({ level: level as 'off' | 'suggest' | 'auto_safe', ...(Number.isFinite(cap) && cap > 0 ? { dailyCap: cap } : {}) });
    const desc: Record<string, [string, string]> = {
      off: ['متوقّفة — لن يقترح أو ينفّذ شيئاً تلقائياً.', 'off — no automatic proposing or acting.'],
      suggest: ['اقتراح فقط — يقترح وينتظر قرارك دائماً.', 'suggest only — it proposes and always waits for you.'],
      auto_safe: [`تلقائية مضبوطة — ينفّذ الآمن فقط (${cfg.allowedKinds.join('، ')}) بثقة ≥ ${cfg.minConfidence}، حتى ${cfg.dailyCap} يومياً. كله قابل للتراجع.`, `guarded auto — only safe kinds (${cfg.allowedKinds.join(', ')}) at confidence ≥ ${cfg.minConfidence}, up to ${cfg.dailyCap}/day. All reversible.`],
    };
    return { summary: L(lang, `ضبطتُ الاستقلالية: ${desc[cfg.level][0]}`, `Autonomy set: ${desc[cfg.level][1]}`), data: cfg };
  } },
  { name: 'autonomy_status', desc: 'عرض إعداد الاستقلالية وما نفّذه المساعد تلقائياً اليوم.', run: async (_a, lang) => {
    const cfg = getAutonomyConfig();
    const today = countAutoApprovedToday();
    const recent = listAutoApproved(10).map((p) => ({ id: p.id, title: p.title, status: p.status }));
    const levelLabel = cfg.level === 'auto_safe' ? L(lang, 'تلقائية مضبوطة', 'guarded auto') : cfg.level === 'off' ? L(lang, 'متوقّفة', 'off') : L(lang, 'اقتراح فقط', 'suggest only');
    return { summary: L(lang,
      `الاستقلالية: ${levelLabel}. نُفِّذ تلقائياً اليوم ${today} من ${cfg.dailyCap}. الأنواع المسموحة: ${cfg.allowedKinds.join('، ')}.`,
      `Autonomy: ${levelLabel}. Auto-executed today ${today} of ${cfg.dailyCap}. Allowed kinds: ${cfg.allowedKinds.join(', ')}.`,
    ), data: { config: cfg, today, recent } };
  } },
];

// ── local memory (few-shot learning, on-device only) ──────────────────────────
function recordMemory(command: string, tool: string, success: boolean): void {
  try { getDb().prepare(`INSERT INTO assistant_memory (command, tool, success) VALUES (?, ?, ?)`).run(command.slice(0, 300), tool, success ? 1 : 0); } catch { /* non-fatal */ }
}

// ── adaptive synaptic memory (Hebbian, on-device only) ────────────────────────
// Each fact behaves like a neuron with a synaptic *weight*: it is potentiated
// (strengthened) when re-activated or independently re-derived, and decays with
// disuse — so the assistant naturally remembers what matters and forgets noise.
const SYN = {
  WMAX: 5,          // saturation ceiling for synaptic strength
  W0: 1,            // initial strength of a freshly-learned fact
  LEARN_RATE: 0.45, // potentiation step toward WMAX on activation
  DECAY_PER_DAY: 0.03, // forgetting rate (~23-day half-life)
  FLOOR: 0.2,       // below this effective strength a fact is dormant (not injected)
  INJECT_TOP: 12,   // max facts injected into a prompt
  SIM_THRESHOLD: 0.6, // token-overlap above which two facts are the "same synapse"
};

interface FactRow { id: number; content: string; weight: number; hits: number; last_used: string | null; created_at: string; source: string; trust: number; observed: number }

/** Tokenise for similarity — works for Arabic & English (letters/numbers only). */
function factTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
}
/** Jaccard overlap of two facts' token sets. Pure — unit-tested. */
export function factSimilarity(a: string, b: string): number {
  const A = factTokens(a), B = factTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
/** Time-decayed (effective) synaptic strength. Pure — unit-tested. */
export function decayedWeight(weight: number, daysSinceUsed: number): number {
  if (!(daysSinceUsed > 0)) return weight;
  return weight * Math.exp(-SYN.DECAY_PER_DAY * daysSinceUsed);
}
/** Saturating potentiation: strong synapses grow slower (bounded by WMAX). */
export function potentiate(w: number): number { return Math.min(SYN.WMAX, w + SYN.LEARN_RATE * (SYN.WMAX - w)); }

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

function rawFacts(): FactRow[] {
  try {
    return getDb().prepare(
      `SELECT id, content, weight, hits, last_used, created_at,
              COALESCE(source,'user') source, COALESCE(trust,1.0) trust, COALESCE(observed,1) observed
       FROM assistant_facts`
    ).all() as FactRow[];
  } catch { return []; }
}

/**
 * Reinforce a fact: consolidate decay, then potentiate, and stamp last_used.
 * Independent re-activation also corroborates the fact, nudging trust upward —
 * a memory confirmed from several angles becomes more reliable.
 */
function reinforceFact(id: number): void {
  try {
    const row = getDb().prepare(`SELECT weight, last_used, trust FROM assistant_facts WHERE id = ?`).get(id) as
      | { weight: number; last_used: string | null; trust: number } | undefined;
    if (!row) return;
    const eff = decayedWeight(row.weight ?? SYN.W0, daysSince(row.last_used));
    const trust = Math.min(1, (row.trust ?? 1) + 0.1 * (1 - (row.trust ?? 1))); // corroboration
    getDb().prepare(
      `UPDATE assistant_facts SET weight = ?, hits = hits + 1, trust = ?, last_used = datetime('now') WHERE id = ?`
    ).run(potentiate(eff), trust, id);
  } catch { /* non-fatal */ }
}

/** Weaken a fact; let it die naturally once it falls below the floor. */
export function weakenFact(id: number): void {
  try {
    const row = getDb().prepare(`SELECT weight, last_used FROM assistant_facts WHERE id = ?`).get(id) as
      | { weight: number; last_used: string | null } | undefined;
    if (!row) return;
    const eff = decayedWeight(row.weight ?? SYN.W0, daysSince(row.last_used)) * 0.5;
    if (eff < SYN.FLOOR) getDb().prepare(`DELETE FROM assistant_facts WHERE id = ?`).run(id);
    else getDb().prepare(`UPDATE assistant_facts SET weight = ?, last_used = datetime('now') WHERE id = ?`).run(eff, id);
  } catch { /* non-fatal */ }
}

/**
 * Learn a fact. If a similar synapse already exists it is *reinforced* rather
 * than duplicated (Hebbian: independent re-derivation strengthens the trace).
 * Templated facts (e.g. recommended sources) pass reinforceSimilar=false so
 * distinct entries are never fuzzily merged.
 */
export interface FactProvenance { source?: string; trust?: number; observed?: boolean; reinforceSimilar?: boolean }

export function rememberFact(content: string, kind = 'fact', opts: FactProvenance = {}): void {
  const text = content.slice(0, 500).trim();
  if (!text) return;
  try {
    if (opts.reinforceSimilar !== false) {
      const twin = rawFacts().find((f) => factSimilarity(f.content, text) >= SYN.SIM_THRESHOLD);
      if (twin) { reinforceFact(twin.id); return; }
    }
    const source = opts.source ?? 'user';
    const trust = Math.max(0, Math.min(1, opts.trust ?? 1));
    const observed = opts.observed === false ? 0 : 1;
    getDb().prepare(
      `INSERT INTO assistant_facts (kind, content, weight, hits, last_used, source, trust, observed)
       VALUES (?, ?, ?, 1, datetime('now'), ?, ?, ?)`
    ).run(kind, text, SYN.W0, source, trust, observed);
  } catch { /* non-fatal */ }
}

interface RankedFact { id: number; content: string; weight: number; strength: number; influence: number; hits: number; source: string; trust: number; observed: boolean }

/**
 * Facts ranked by *influence* = effective synaptic strength × trust, strongest
 * first. A high-confidence trace from a trusted origin outranks an equally-firing
 * but low-trust (e.g. model-inferred or shaky-source) one — the guard against
 * poisoned/hallucinated learning.
 */
export function listFacts(): RankedFact[] {
  return rawFacts()
    .map((f) => {
      const strength = decayedWeight(f.weight ?? SYN.W0, daysSince(f.last_used ?? f.created_at));
      const trust = f.trust ?? 1;
      return {
        id: f.id,
        content: f.content,
        weight: f.weight ?? SYN.W0,
        hits: f.hits ?? 0,
        strength,
        trust,
        observed: (f.observed ?? 1) === 1,
        source: f.source ?? 'user',
        influence: strength * trust,
      };
    })
    .sort((a, b) => b.influence - a.influence)
    .slice(0, 40);
}

/** Reinforce facts that "fired together" with a successful command (co-activation). */
function reinforceCoActivated(command: string): void {
  const ranked = rawFacts()
    .map((f) => ({ id: f.id, sim: factSimilarity(f.content, command) }))
    .filter((x) => x.sim > 0.12)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 2);
  for (const r of ranked) reinforceFact(r.id);
}

// ── perception loop: live fetched content feeds the adaptive memory ───────────
const PERCEIVE = { SIM: 0.12, MIN_MATCHES: 2 };

export interface PerceivedItem { title?: string; summary?: string }

/**
 * Feed freshly fetched content (trends, competitor posts, web results) into the
 * memory: any learned interest the incoming batch *corroborates* is reinforced.
 * We require the topic to recur across ≥2 items so a one-off coincidence (or an
 * unrelated style-preference fact sharing a token) never strengthens an interest —
 * only genuine, repeated real-world signal does. Reinforced once per perceive call.
 */
export function perceive(items: PerceivedItem[], opts: { source: string }): { reinforced: { id: number; content: string; matches: number }[] } {
  const reinforced: { id: number; content: string; matches: number }[] = [];
  const facts = rawFacts();
  if (!facts.length || !items.length) return { reinforced };
  for (const f of facts) {
    let matches = 0;
    for (const it of items) {
      if (factSimilarity(f.content, `${it.title ?? ''} ${it.summary ?? ''}`) >= PERCEIVE.SIM) matches++;
    }
    if (matches >= PERCEIVE.MIN_MATCHES) {
      reinforceFact(f.id);
      reinforced.push({ id: f.id, content: f.content, matches });
    }
  }
  if (reinforced.length) log.info('perception reinforced interests', { source: opts.source, count: reinforced.length });
  return { reinforced };
}

function factsBlock(): string {
  // Inject by influence (strength × trust); mark model-inferred facts as tentative
  // so the model treats them with appropriate caution rather than as ground truth.
  const f = listFacts().filter((x) => x.influence >= SYN.FLOOR).slice(0, SYN.INJECT_TOP);
  return f.length ? '\nما تعلّمتُه عنك (راعِه دائماً):\n' + f.map((x) => `• ${x.content}${x.observed ? '' : ' (استنتاج مبدئي)'}`).join('\n') : '';
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

function buildIntentPrompt(command: string, lang: Lang): string {
  const toolList = TOOLS.map((t) => `- ${t.name}: ${t.desc}${t.sensitive ? ' (حسّاس)' : ''}`).join('\n');
  if (lang === 'en') {
    return `You are an AI assistant inside EyesPro, a news management & publishing app. Map the user's command to exactly one tool.

Tools:
${toolList}
- chat: a general question/conversation that matches no tool.
${factsBlock()}${fewShotExamples()}

User command: "${command}"
(If it's a question about the user's own data — their articles or publishing — use ask_knowledge.)

Return ONLY JSON with no extra text:
{"tool":"<name>","args":{...},"reply":"<short friendly reply in English>"}`;
  }
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

function tryLocalMatch(command: string, lang: Lang): { tool: string; args: Record<string, unknown>; reply: string } | null {
  const text = command.toLowerCase().trim();

  // 1. Help commands
  if (text === 'مساعدة' || text === 'help' || text === 'ماذا تستطيع أن تفعل' || text === 'ماذا تستطيع ان تفعل' || text === 'ماذا تفعل' || text === 'what can you do') {
    return { tool: 'help', args: { topic: 'general' }, reply: L(lang, 'مرحباً بك في المساعدة!', 'Welcome to help!') };
  }
  if (text.startsWith('مساعدة عن') || text.startsWith('كيفية استخدام') || text.startsWith('help with') || text.startsWith('how to use')) {
    const topic = text.replace(/^(مساعدة عن|كيفية استخدام|help with|how to use)\s+/, '').trim();
    return { tool: 'help', args: { topic }, reply: L(lang, `إليك معلومات عن ${topic}:`, `Here's information about ${topic}:`) };
  }

  // Forget a learned fact — "انسَ كذا" / "forget that …"
  const forgetMatch = /^(انسَ?ى?|انسي|forget(?: that)?)\s+(.+)$/u.exec(command.trim());
  if (forgetMatch) {
    return { tool: 'forget', args: { fact: forgetMatch[2].trim() }, reply: L(lang, 'حسناً، سأنسى ذلك...', "Okay, I'll forget that...") };
  }

  // Privacy mode — "اجعل الخصوصية محلية/هجين/سحابية" / "set privacy to local/hybrid/cloud"
  if (/خصوصي|privacy/.test(text) && /(محل|هجين|مختلط|سحاب|local|hybrid|cloud)/.test(text)) {
    return { tool: 'set_privacy', args: { mode: text }, reply: L(lang, 'جاري ضبط وضع الخصوصية...', 'Setting privacy mode...') };
  }

  // Co-pilot: approve / reject proposals — "وافق على رقم 3" / "approve #3" / "reject all"
  const decideMatch = /^(وافق|اقبل|approve|reject|ارفض|رفض)\b(.*)$/u.exec(command.trim());
  if (decideMatch) {
    const isApprove = /^(وافق|اقبل|approve)/u.test(decideMatch[1]);
    const rest = decideMatch[2];
    const all = /(الكل|all|الجميع)/u.test(rest);
    const idMatch = /(\d+)/.exec(rest);
    if (all || idMatch) {
      const args = all ? { all: true } : { id: Number(idMatch![1]) };
      return isApprove
        ? { tool: 'approve_proposal', args, reply: L(lang, 'جاري تنفيذ المقترح...', 'Executing the proposal...') }
        : { tool: 'reject_proposal', args, reply: L(lang, 'جاري رفض المقترح...', 'Rejecting the proposal...') };
    }
  }
  // Review pending proposals — "المقترحات" / "اعرض المقترحات" / "proposals"
  if (text === 'المقترحات' || text === 'اعرض المقترحات' || text === 'عرض المقترحات' || text === 'proposals' || text === 'review proposals' || text === 'show proposals') {
    return { tool: 'review_proposals', args: {}, reply: L(lang, 'جاري جلب المقترحات...', 'Fetching proposals...') };
  }

  // Autonomy: status — "حالة الاستقلالية" / "autonomy status"
  if (/استقلالي|autonomy/.test(text) && /(حالة|وضع|status|عرض|show)/.test(text)) {
    return { tool: 'autonomy_status', args: {}, reply: L(lang, 'جاري عرض حالة الاستقلالية...', 'Showing autonomy status...') };
  }
  // Autonomy: set level — "فعّل الاستقلالية التلقائية" / "set autonomy to auto/suggest/off"
  if (/استقلالي|autonomy/.test(text) && /(تلقائ|اقترا|اقترح|إيقاف|ايقاف|عطّل|off|suggest|auto|فعّل|فعل)/.test(text)) {
    return { tool: 'set_autonomy', args: { level: text }, reply: L(lang, 'جاري ضبط الاستقلالية...', 'Setting autonomy...') };
  }

  // 2. Articles list
  if (
    text === 'اعرض آخر المقالات' ||
    text === 'اعرض المقالات' ||
    text === 'آخر المقالات' ||
    text === 'المقالات' ||
    text === 'عرض المقالات' ||
    text === 'list articles' ||
    text === 'show articles'
  ) {
    return { tool: 'list_articles', args: { limit: 5 }, reply: L(lang, 'جاري جلب أحدث المقالات...', 'Fetching the latest articles...') };
  }

  // 3. Statistics
  if (
    text === 'عرض الاحصائيات' ||
    text === 'عرض الإحصائيات' ||
    text === 'الاحصائيات' ||
    text === 'الإحصائيات' ||
    text === 'احصائيات لوحة التحكم' ||
    text === 'إحصائيات لوحة التحكم' ||
    text === 'get stats' ||
    text === 'show stats' ||
    text === 'عرض احصائيات' ||
    text === 'عرض إحصائيات'
  ) {
    return { tool: 'get_stats', args: {}, reply: L(lang, 'إليك إحصائيات النظام:', "Here are your system stats:") };
  }

  // 4. Fetch trends
  if (
    text === 'اجلب الترندات' ||
    text === 'تحديث الترندات' ||
    text === 'جلب الترندات' ||
    text === 'fetch trends' ||
    text === 'get trends'
  ) {
    return { tool: 'fetch_trends', args: {}, reply: L(lang, 'جاري جلب أحدث الترندات من الشبكة...', 'Fetching the latest trends from the network...') };
  }

  // 5. Fetch sources
  if (
    text === 'اجلب المصادر' ||
    text === 'تحديث المصادر' ||
    text === 'جلب المصادر' ||
    text === 'fetch sources' ||
    text === 'get sources'
  ) {
    return { tool: 'fetch_sources', args: {}, reply: L(lang, 'جاري تحديث كافة مصادر الأخبار...', 'Updating all news sources...') };
  }

  // 6. Check competitors
  if (
    text === 'افحص المنافسين' ||
    text === 'راقب المنافسين' ||
    text === 'تحديث المنافسين' ||
    text === 'check competitors' ||
    text === 'فحص المنافسين'
  ) {
    return { tool: 'check_competitors', args: {}, reply: L(lang, 'جاري فحص منشورات المنافسين الجديدة...', 'Checking for new competitor posts...') };
  }

  // 7. Run autopilot (newsroom)
  if (
    text === 'شغل غرفة الأخبار' ||
    text === 'شغل غرفة الاخبار' ||
    text === 'تشغيل غرفة الأخبار' ||
    text === 'تشغيل غرفة الاخبار' ||
    text === 'run newsroom'
  ) {
    return { tool: 'run_newsroom', args: {}, reply: L(lang, 'هل تريد تشغيل غرفة الأخبار (Autopilot) لتوليد ونشر المقالات تلقائياً؟', 'Do you want to run the Newsroom (Autopilot) to generate and publish articles automatically?') };
  }

  // 8. Navigation / Screen opening
  // Match commands like: افتح الإعدادات, اذهب إلى لوحة التحكم, شاشة المقالات, etc.
  const openKeywords = ['افتح', 'اذهب إلى', 'اذهب الى', 'انتقل إلى', 'انتقل الى', 'شاشة', 'عرض', 'open', 'goto', 'show'];
  for (const kw of openKeywords) {
    if (text.startsWith(kw + ' ')) {
      const screenArg = text.slice(kw.length).trim();
      
      const dashboardMatches = ['لوحة', 'احصائيات', 'إحصائيات', 'dashboard', 'stats'];
      const articlesMatches = ['مقالات', 'المقالات', 'articles'];
      const contentMatches = ['محتوى', 'المتوى', 'مصادر', 'المصادر', 'sources', 'content'];
      const newsroomMatches = ['غرفة', 'autopilot', 'newsroom', 'الأخبار', 'الاخبار'];
      const monitorMatches = ['رقابة', 'الرقابة', 'منافسين', 'المنافسين', 'monitor', 'competitors'];
      const videoMatches = ['فيديو', 'الفيديو', 'video', 'وسائط', 'الوسائط'];
      const scheduleMatches = ['جدولة', 'الجدولة', 'schedule'];
      const settingsMatches = ['إعدادات', 'اعدادات', 'الإعدادات', 'الاعدادات', 'settings'];

      let matchedScreen: string | null = null;
      if (settingsMatches.some(k => screenArg.includes(k))) matchedScreen = 'settings';
      else if (dashboardMatches.some(k => screenArg.includes(k))) matchedScreen = 'dashboard';
      else if (articlesMatches.some(k => screenArg.includes(k))) matchedScreen = 'articles';
      else if (contentMatches.some(k => screenArg.includes(k))) matchedScreen = 'content';
      else if (newsroomMatches.some(k => screenArg.includes(k))) matchedScreen = 'newsroom';
      else if (monitorMatches.some(k => screenArg.includes(k))) matchedScreen = 'monitor';
      else if (videoMatches.some(k => screenArg.includes(k))) matchedScreen = 'video';
      else if (scheduleMatches.some(k => screenArg.includes(k))) matchedScreen = 'schedule';

      if (matchedScreen) {
        return { tool: 'open_screen', args: { screen: matchedScreen }, reply: L(lang, 'جاري فتح القسم المطلوب...', 'Opening the requested section...') };
      }
    }
  }

  // Also support direct screen names as commands: e.g. "الإعدادات" -> open settings
  const settingsDirect = ['إعدادات', 'اعدادات', 'الإعدادات', 'الاعدادات', 'settings'];
  const dashboardDirect = ['لوحة التحكم', 'الرئيسية', 'dashboard'];
  const articlesDirect = ['معرض المقالات', 'مسودات', 'المسودات'];
  const monitorDirect = ['مراقبة المنافسين', 'رصد المنافسين'];
  
  if (settingsDirect.includes(text)) return { tool: 'open_screen', args: { screen: 'settings' }, reply: L(lang, 'جاري فتح الإعدادات...', 'Opening Settings...') };
  if (dashboardDirect.includes(text)) return { tool: 'open_screen', args: { screen: 'dashboard' }, reply: L(lang, 'جاري فتح لوحة التحكم...', 'Opening the Dashboard...') };
  if (articlesDirect.includes(text)) return { tool: 'open_screen', args: { screen: 'articles' }, reply: L(lang, 'جاري فتح قسم المقالات...', 'Opening the Articles section...') };
  if (monitorDirect.includes(text)) return { tool: 'open_screen', args: { screen: 'monitor' }, reply: L(lang, 'جاري فتح قسم مراقبة المنافسين...', 'Opening the competitor monitoring section...') };

  return null;
}

export async function runAssistant(command: string, confirmed = false, lang: Lang = 'ar'): Promise<AssistantResult> {
  const text = String(command ?? '').trim();
  if (!text) return { ok: false, reply: L(lang, 'لم أتلقَّ أمراً.', "I didn't receive a command."), tool: 'chat', error: 'empty' };

  let intent = tryLocalMatch(text, lang);

  if (!intent) {
    const health = await checkAiProviderReady();
    if (!health.ok) {
      return { ok: false, tool: 'chat', error: 'ai_unconfigured',
        reply: `${health.error ?? L(lang, 'الذكاء الاصطناعي غير مُعدّ.', 'AI is not configured.')}\n💡 ${help(lang, 'ai')}` };
    }

    try {
      intent = parseIntent(await runAiChain(buildIntentPrompt(text, lang), ''));
    } catch (e) {
      const formattedErr = formatAiErrorMessage((e as Error).message);
      return { ok: false, reply: L(lang,
        `تعذّر فهم الأمر عبر الذكاء الاصطناعي.\n💡 التفاصيل: ${formattedErr}`,
        `Couldn't understand the command via AI.\n💡 Details: ${formattedErr}`,
      ), tool: 'chat', error: (e as Error).message };
    }
  }

  if (!intent) return { ok: false, reply: L(lang,
    'لم أفهم الأمر — أعد صياغته بطريقة أوضح، أو قل «ماذا تستطيع أن تفعل؟».',
    'I didn\'t understand the command — rephrase it more clearly, or ask "what can you do?".',
  ), tool: 'chat', error: 'parse_failed' };

  if (intent.tool === 'chat' || intent.tool === 'none') return { ok: true, reply: intent.reply || L(lang, 'تم.', 'Done.'), tool: 'chat' };

  const tool = TOOLS.find((t) => t.name === intent!.tool);
  if (!tool) return { ok: true, reply: intent.reply || L(lang, 'لم أجد أداة مناسبة.', "I couldn't find a suitable tool."), tool: 'chat' };

  if (tool.sensitive && !confirmed) {
    return { ok: true, reply: intent.reply || L(lang, `هل تريد تنفيذ «${tool.name}»؟`, `Do you want to run "${tool.name}"?`), tool: tool.name, needsConfirm: true, pendingArgs: intent.args };
  }

  try {
    const r = await tool.run(intent.args, lang);
    recordMemory(text, tool.name, true);
    reinforceCoActivated(text); // facts that fired with a successful action strengthen
    log.info('assistant tool executed', { tool: tool.name });
    return { ok: true, reply: intent.reply ? `${intent.reply}\n${r.summary}` : r.summary, tool: tool.name, data: r.data, navigate: r.navigate };
  } catch (e) {
    recordMemory(text, tool.name, false);
    return { ok: false, reply: L(lang, `فشل تنفيذ «${tool.name}»: ${(e as Error).message}`, `Failed to run "${tool.name}": ${(e as Error).message}`), tool: tool.name, error: (e as Error).message };
  }
}

/**
 * Proactive suggestions based on the current app state — shown when the robot
 * opens, even if the user hasn't asked. Pure on-device heuristics.
 */
export function getSuggestions(lang: Lang = 'ar'): { greeting: string; suggestions: AssistantSuggestion[] } {
  const s: AssistantSuggestion[] = [];
  try {
    const provider = resolveEffectiveAiProvider();
    if (provider === 'unconfigured' || provider === 'off') {
      s.push({ text: L(lang, '⚙️ لم تُفعّل الذكاء الاصطناعي بعد — لنفعّله من الإعدادات.', "⚙️ AI isn't enabled yet — let's enable it in Settings."), command: L(lang, 'افتح الإعدادات', 'open settings') });
    }
    const pendingProposals = countPending();
    if (pendingProposals > 0) s.push({ text: L(lang, `🧭 لديّ ${pendingProposals} مقترحاً بانتظار قرارك.`, `🧭 I have ${pendingProposals} proposals awaiting your decision.`), command: L(lang, 'اعرض المقترحات', 'review proposals') });
    const m = dashboardMetrics() as { sources?: number; pending?: number };
    if (!m.sources) s.push({ text: L(lang, '📡 لا توجد مصادر بعد — أضِف مصادر أخبار لتبدأ.', '📡 No sources yet — add news sources to get started.'), command: L(lang, 'افتح المحتوى والمصادر', 'open content') });
    else s.push({ text: L(lang, '🔥 هل أجلب لك آخر الترندات الآن؟', '🔥 Shall I fetch the latest trends now?'), command: L(lang, 'اجلب الترندات', 'fetch trends') });
    if ((m.pending ?? 0) > 0) s.push({ text: L(lang, `📝 لديك ${m.pending} مقالاً معلّقاً — هل تريد عرضها؟`, `📝 You have ${m.pending} pending articles — want to see them?`), command: L(lang, 'اعرض آخر المقالات', 'list articles') });
    s.push({ text: L(lang, '🤖 جرّب: «شغّل غرفة الأخبار» أو «كم عدد المقالات» أو «ماذا تستطيع أن تفعل؟».', '🤖 Try: "run newsroom", "how many articles", or "what can you do?".') });
  } catch { /* ignore */ }
  return {
    greeting: L(lang,
      'مرحباً! أنا مساعدك الذكي 🤖 — مرّر أوامرك بالكلام وسأنفّذها. هذه بعض الاقتراحات:',
      "Hi! I'm your smart assistant 🤖 — speak or type your commands and I'll run them. Here are a few suggestions:"),
    suggestions: s.slice(0, 4),
  };
}

export async function triggerSelfLearning(
  oldTitle: string,
  oldContent: string,
  newTitle: string,
  newContent: string
): Promise<void> {
  const provider = resolveEffectiveAiProvider();
  if (provider === 'unconfigured' || provider === 'off') return;

  // Only reflect if there is a substantial edit (different titles, or content changes)
  if (oldTitle === newTitle && oldContent.trim() === newContent.trim()) return;

  try {
    const prompt = `أنت خبير في فهم تفضيلات الكتابة وصناعة المحتوى. قام الكاتب بتعديل عنوان المقال ونصه. قارن بين النسخة القديمة والجديدة واستخلص تفضيلاً محدداً وصغيراً جداً عن أسلوب صياغة الكاتب المفضل باللغة العربية (مثال: 'يفضل العناوين المباشرة والموجزة' أو 'يتجنب تكرار الكلمات الطويلة' أو 'يفضل النبرة الرسمية'). أعد فقط التفضيل كجملة واحدة باللغة العربية تبدأ بـ 'يفضل...'، وإذا لم يكن هناك نمط واضح أعد 'لا يوجد':
    
القديم:
العنوان: ${oldTitle}
النص: ${oldContent.slice(0, 1000)}

الجديد:
العنوان: ${newTitle}
النص: ${newContent.slice(0, 1000)}`;

    log.info('Triggering autonomous self-learning from user edit...');
    // The user's draft content is private → keep it local under hybrid/local_only.
    let result: string;
    try { result = (await runAiRouted(prompt, '', { sensitive: true })).text; }
    catch (e) { if (isPrivacyBlocked(e)) { log.info('[Self-Learning] skipped — privacy mode keeps drafts local and no local model is available'); return; } throw e; }
    const preference = result.trim();
    if (preference && preference.length > 5 && !preference.includes('لا يوجد') && preference.startsWith('يفضل')) {
      // Inferred from the user's edits (not directly stated) → lower trust, not "observed".
      rememberFact(preference, 'auto_learned', { source: 'inferred:edit', trust: 0.6, observed: false });
      log.info(`[Self-Learning] Reinforced/learned preference: ${preference}`);
    }
  } catch (err) {
    log.warn(`Self-learning failed: ${(err as Error).message}`);
  }
}

export async function runAutonomousReflection(): Promise<void> {
  const provider = resolveEffectiveAiProvider();
  if (provider === 'unconfigured' || provider === 'off') return;

  try {
    const db = getDb();
    
    // Get stats about categories
    type CatRow = { category: string; cnt: number };
    const catRows = db.prepare(`
      SELECT category, COUNT(*) as cnt FROM articles 
      WHERE category IS NOT NULL AND category != '' 
      GROUP BY category ORDER BY cnt DESC LIMIT 5
    `).all() as CatRow[];
    
    if (catRows.length === 0) return;

    const categoriesText = catRows.map(r => `${r.category} (${r.cnt} مقال)`).join('، ');

    // Get recent commands from memory
    type MemRow = { command: string };
    const memRows = db.prepare(`
      SELECT command FROM assistant_memory 
      WHERE success = 1 ORDER BY created_at DESC LIMIT 10
    `).all() as MemRow[];
    const commandsText = memRows.map(r => r.command).join(' | ');

    const prompt = `أنت العقل المفكر لبرنامج EyesPro الإخباري. قم بتحليل إحصائيات النشاط التالية للمستخدم واستخلص استنتاجاً واحداً وموجزاً عن مجال اهتمام المستخدم الحالي في العمل الإعلامي (مثال: 'يركز المستخدم بشكل مكثف على المقالات السياسية حالياً' أو 'يركز اهتمام المستخدم على متابعة الترندات والبحث فيها'). أعد فقط الاستنتاج في جملة واحدة تبدأ بـ 'يركز المستخدم...' أو 'يهتم المستخدم...':

تصنيفات المقالات النشطة: ${categoriesText}
آخر أوامر المساعد: ${commandsText}`;

    log.info('Triggering autonomous periodic reflection loop...');
    // Reflects over the user's own activity (categories + command history) → keep local.
    let result: string;
    try { result = (await runAiRouted(prompt, '', { sensitive: true })).text; }
    catch (e) { if (isPrivacyBlocked(e)) { log.info('[Reflection] skipped — privacy mode keeps activity local and no local model is available'); return; } throw e; }
    const reflection = result.trim();
    if (reflection && reflection.length > 5 && (reflection.startsWith('يركز') || reflection.startsWith('يهتم'))) {
      // Inferred from activity patterns → low trust, not directly observed.
      rememberFact(reflection, 'reflection', { source: 'inferred:reflection', trust: 0.5, observed: false });
      log.info(`[Autonomous Reflection] Reinforced/added insight: ${reflection}`);
    }
  } catch (err) {
    log.warn(`Autonomous reflection loop failed: ${(err as Error).message}`);
  }
}

export async function runAutonomousSourceDiscovery(): Promise<void> {
  const provider = resolveEffectiveAiProvider();
  if (provider === 'unconfigured' || provider === 'off') return;

  try {
    const db = getDb();
    
    // Retrieve user's interests from assistant_facts
    const facts = listFacts();
    const reflections = facts.filter(f => f.content.includes('يركز المستخدم') || f.content.includes('يهتم المستخدم'));
    if (reflections.length === 0) return;

    // Use the latest reflection to extract query keywords
    const latestReflection = reflections[0].content;
    const prompt = `أنت خبير إعلامي. اقرأ جملة الاهتمام التالية للمستخدم واستخلص منها كلمة بحث أو كلمتين مفتاحيتين رئيسيتين باللغة العربية للبحث عن مقالات أخبار مشابهة في محرك البحث (مثال: 'الذكاء الاصطناعي' أو 'التغير المناخي'). أعد الكلمات المفتاحية فقط بدون أي فواصل أو علامات ترقيم:`;
    
    log.info('Running AI keyword extraction for source discovery...');
    const keywordsResult = await runAiChain(prompt, latestReflection);
    const query = keywordsResult.trim();
    if (!query || query.length < 2) return;

    log.info(`Querying Google News for source discovery using keywords: "${query}"`);
    const articles = await scrapeGoogleNews({ query, maxResults: 15 });
    if (articles.length === 0) return;

    // Count source frequency
    const sourceCounts: Record<string, { count: number; sampleLink: string }> = {};
    for (const art of articles) {
      if (!art.source) continue;
      const cleanSource = art.source.trim();
      if (!sourceCounts[cleanSource]) {
        sourceCounts[cleanSource] = { count: 0, sampleLink: art.link };
      }
      sourceCounts[cleanSource]!.count++;
    }

    // Get list of existing sources to avoid duplicates
    type SrcRow = { name: string };
    const existingSources = db.prepare(`SELECT name FROM sources`).all() as SrcRow[];
    const existingNames = new Set(existingSources.map(s => s.name.toLowerCase().trim()));

    // Recommend top sources
    for (const [sourceName, info] of Object.entries(sourceCounts)) {
      if (info.count >= 2 && !existingNames.has(sourceName.toLowerCase().trim())) {
        const factText = `مصدر مقترح: ${sourceName} - يغطي اهتماماتك بـ "${query}" (عينة مقال: ${info.sampleLink})`;
        // Templated facts must match exactly (never fuzzily merge two distinct sources).
        if (!facts.some(f => f.content.includes(`مصدر مقترح: ${sourceName}`))) {
          // Observed from a public web search — moderate trust, real origin recorded.
          rememberFact(factText, 'recommended_source', { reinforceSimilar: false, source: 'web:google-news', trust: 0.7, observed: true });
          log.info(`[Autonomous Discovery] Discovered and recommended new source: ${sourceName}`);
        }
      }
    }
  } catch (err) {
    log.warn(`Autonomous source discovery failed: ${(err as Error).message}`);
  }
}
