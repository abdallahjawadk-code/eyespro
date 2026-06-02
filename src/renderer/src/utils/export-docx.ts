import {
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from 'docx';

// ── Typography (Word OOXML best practices) ───────────────────────────────────
// Sizes are in half-points (24 = 12pt). Spacing in twips (240 = single line).

const FONT_LATIN = 'Calibri';
const FONT_ARABIC = 'Arial';
const FONT_CODE = 'Consolas';

const SIZE_BODY = 24;
const SIZE_SMALL = 20;
const SIZE_H1 = 32;
const SIZE_H2 = 28;
const SIZE_H3 = 26;
const SIZE_TITLE = 40;
const SIZE_CODE = 20;

const LINE_BODY = 276; // ~1.15 line spacing
const COLOR_BODY = '1F2937';
const COLOR_MUTED = '6B7280';
const COLOR_LINK = '0563C1';
const COLOR_ACCENT = '7C3AED';

const PAGE_MARGIN = convertInchesToTwip(1);
const MAX_IMAGE_BYTES = 4_000_000;

const BULLET_REF = 'eyespro-bullet';
const NUMBER_REF = 'eyespro-number';

// ── RTL detection ─────────────────────────────────────────────────────────────

function isArabic(text: string): boolean {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\u0620-\u063F]/g) ?? []).length;
  const clean = text.replace(/[\s\d\W]/g, '').length;
  return clean > 4 && arabic / clean > 0.25;
}

function pickFont(rtl: boolean): string {
  return rtl ? FONT_ARABIC : FONT_LATIN;
}

// ── Inline run options ────────────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: boolean;
  sub?: boolean;
  super?: boolean;
  rtl: boolean;
  color?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function makeRun(text: string, opts: RunOpts, font: string): TextRun {
  return new TextRun({
    text: decodeEntities(text),
    bold: opts.bold,
    italics: opts.italics,
    underline: opts.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: opts.strike,
    subScript: opts.sub,
    superScript: opts.super,
    font: opts.code ? FONT_CODE : font,
    size: opts.code ? SIZE_CODE : SIZE_BODY,
    color: opts.highlight ? COLOR_BODY : opts.color ?? COLOR_BODY,
    shading: opts.highlight
      ? { type: ShadingType.SOLID, color: 'FEF08A', fill: 'FEF08A' }
      : undefined,
    rightToLeft: opts.rtl,
  });
}

type InlineChild = TextRun | ExternalHyperlink | ImageRun;

function parseInline(node: Node, opts: RunOpts, font: string): InlineChild[] {
  const out: InlineChild[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) out.push(makeRun(text, opts, font));
    return out;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return out;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    out.push(new TextRun({ text: '', break: 1 }));
    return out;
  }

  const next: RunOpts = {
    ...opts,
    bold: opts.bold || ['b', 'strong'].includes(tag),
    italics: opts.italics || ['i', 'em'].includes(tag),
    underline: opts.underline || tag === 'u',
    strike: opts.strike || ['s', 'del', 'strike'].includes(tag),
    code: opts.code || tag === 'code',
    highlight: opts.highlight || tag === 'mark',
    sub: opts.sub || tag === 'sub',
    super: opts.super || tag === 'sup',
  };

  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const inner: TextRun[] = [];
    el.childNodes.forEach(c => {
      parseInline(c, { ...next, color: COLOR_LINK, underline: true }, font).forEach(r => {
        if (r instanceof TextRun) inner.push(r);
      });
    });
    if (href && inner.length > 0) {
      out.push(new ExternalHyperlink({ link: href, children: inner }));
    } else {
      out.push(...inner);
    }
    return out;
  }

  el.childNodes.forEach(c => out.push(...parseInline(c, next, font)));
  return out;
}

// ── Images ──────────────────────────────────────────────────────────────────────

type ImagePayload = { data: Uint8Array; type: 'png' | 'jpg' | 'gif' };

async function fetchImagePayload(url: string): Promise<ImagePayload | null> {
  try {
    if (url.startsWith('data:image/')) {
      const m = url.match(/^data:image\/([\w+]+);base64,(.+)$/i);
      if (!m) return null;
      const raw = m[2];
      const bin = atob(raw);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const fmt = m[1].toLowerCase();
      const type: ImagePayload['type'] =
        fmt.includes('jpeg') || fmt === 'jpg' ? 'jpg' : fmt.includes('gif') ? 'gif' : 'png';
      return data.byteLength <= MAX_IMAGE_BYTES ? { data, type } : null;
    }
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const type: ImagePayload['type'] =
      ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : ct.includes('gif') ? 'gif' : 'png';
    return { data: new Uint8Array(buf), type };
  } catch {
    return null;
  }
}

function imageParagraph(
  payload: ImagePayload,
  alt: string,
  rtl: boolean
): Paragraph {
  const maxW = convertInchesToTwip(5.5);
  return new Paragraph({
    bidirectional: rtl,
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [
      new ImageRun({
        type: payload.type,
        data: payload.data,
        transformation: { width: maxW, height: Math.round(maxW * 0.5625) },
        altText: { name: alt.slice(0, 80) || 'image', title: alt, description: alt },
      }),
    ],
  });
}

// ── Block parser ──────────────────────────────────────────────────────────────

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

function getAlign(el: Element, rtl: boolean) {
  const style = el.getAttribute('style') ?? '';
  if (/text-align:\s*center/i.test(style)) return AlignmentType.CENTER;
  if (/text-align:\s*right/i.test(style)) return AlignmentType.RIGHT;
  if (/text-align:\s*left/i.test(style)) return AlignmentType.LEFT;
  return rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
}

type BlockOutput = Paragraph | Table;

/** Parse unordered lists with proper async nesting */
async function parseUl(el: Element, rtl: boolean, font: string, listLevel: number): Promise<Paragraph[]> {
  const paras: Paragraph[] = [];
  for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
    const children: InlineChild[] = [];
    li.childNodes.forEach(n => {
      if (n.nodeType !== Node.ELEMENT_NODE || !['ul', 'ol'].includes((n as Element).tagName.toLowerCase())) {
        children.push(...parseInline(n, { rtl }, font));
      }
    });
    paras.push(new Paragraph({
      numbering: { reference: BULLET_REF, level: Math.min(listLevel, 2) },
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: children.length ? children : [new TextRun({ text: ' ' })],
      spacing: { before: 60, after: 60, line: LINE_BODY, lineRule: LineRuleType.AUTO },
    }));
    for (const nested of Array.from(li.querySelectorAll(':scope > ul'))) {
      paras.push(...await parseUl(nested, rtl, font, listLevel + 1));
    }
    for (const nested of Array.from(li.querySelectorAll(':scope > ol'))) {
      paras.push(...(await parseOl(nested, rtl, font, listLevel + 1)));
    }
  }
  return paras;
}

async function parseOl(el: Element, rtl: boolean, font: string, listLevel: number): Promise<Paragraph[]> {
  const paras: Paragraph[] = [];
  for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
    const children: InlineChild[] = [];
    li.childNodes.forEach(n => {
      if (n.nodeType !== Node.ELEMENT_NODE || !['ul', 'ol'].includes((n as Element).tagName.toLowerCase())) {
        children.push(...parseInline(n, { rtl }, font));
      }
    });
    paras.push(new Paragraph({
      numbering: { reference: NUMBER_REF, level: Math.min(listLevel, 2) },
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: children.length ? children : [new TextRun({ text: ' ' })],
      spacing: { before: 60, after: 60, line: LINE_BODY, lineRule: LineRuleType.AUTO },
    }));
    for (const nested of Array.from(li.querySelectorAll(':scope > ul'))) {
      paras.push(...await parseUl(nested, rtl, font, listLevel + 1));
    }
    for (const nested of Array.from(li.querySelectorAll(':scope > ol'))) {
      paras.push(...await parseOl(nested, rtl, font, listLevel + 1));
    }
  }
  return paras;
}

async function blockToBlocks(
  el: Element,
  globalRtl: boolean,
  font: string,
  listLevel = 0
): Promise<BlockOutput[]> {
  const tag = el.tagName.toLowerCase();
  const text = el.textContent ?? '';
  const rtl = globalRtl || isArabic(text);
  const baseOpts: RunOpts = { rtl };

  if (HEADING_MAP[tag]) {
    const children: InlineChild[] = [];
    el.childNodes.forEach(n => children.push(...parseInline(n, baseOpts, font)));
    return [new Paragraph({
      heading: HEADING_MAP[tag],
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { before: 240, after: 120, line: LINE_BODY, lineRule: LineRuleType.AUTO },
      children,
    })];
  }

  if (tag === 'hr') {
    return [new Paragraph({
      border: { bottom: { color: 'D1D5DB', space: 1, size: 6, style: BorderStyle.SINGLE } },
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: '' })],
    })];
  }

  if (tag === 'img') {
    const src = el.getAttribute('src') ?? '';
    const alt = el.getAttribute('alt') ?? '';
    if (!src) return [];
    const payload = await fetchImagePayload(src);
    if (payload) return [imageParagraph(payload, alt || 'image', rtl)];
    if (alt) {
      return [new Paragraph({
        bidirectional: rtl,
        alignment: AlignmentType.CENTER,
        children: [makeRun(`[${alt}]`, { ...baseOpts, italics: true, color: COLOR_MUTED }, font)],
      })];
    }
    return [];
  }

  if (tag === 'blockquote') {
    const paras: Paragraph[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const nested = await blockToBlocks(child as Element, rtl, font, listLevel);
        nested.forEach(b => { if (b instanceof Paragraph) paras.push(b); });
      } else if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent?.trim() ?? '';
        if (t) {
          paras.push(new Paragraph({
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            indent: rtl ? { right: convertInchesToTwip(0.35) } : { left: convertInchesToTwip(0.35) },
            border: rtl
              ? { right: { color: COLOR_ACCENT, space: 8, size: 12, style: BorderStyle.SINGLE } }
              : { left: { color: COLOR_ACCENT, space: 8, size: 12, style: BorderStyle.SINGLE } },
            shading: { type: ShadingType.SOLID, color: 'F9FAFB', fill: 'F9FAFB' },
            spacing: { before: 120, after: 120, line: LINE_BODY, lineRule: LineRuleType.AUTO },
            children: [makeRun(t, { ...baseOpts, italics: true, color: COLOR_MUTED }, font)],
          }));
        }
      }
    }
    return paras;
  }

  if (tag === 'pre') {
    const codeEl = el.querySelector('code');
    const codeText = (codeEl ?? el).textContent ?? '';
    return codeText.split('\n').map(line => new Paragraph({
      shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
      spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
      children: [new TextRun({
        text: decodeEntities(line) || ' ',
        font: FONT_CODE,
        size: SIZE_CODE,
        color: COLOR_BODY,
      })],
    }));
  }

  if (tag === 'ul') return parseUl(el, rtl, font, listLevel);
  if (tag === 'ol') return parseOl(el, rtl, font, listLevel);

  if (tag === 'table') {
    const rows: TableRow[] = [];
    for (const tr of Array.from(el.querySelectorAll('tr'))) {
      const cells: TableCell[] = [];
      for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const cellChildren: InlineChild[] = [];
        cell.childNodes.forEach(n => cellChildren.push(...parseInline(n, { ...baseOpts, bold: isHeader }, font)));
        cells.push(new TableCell({
          children: [new Paragraph({
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: cellChildren.length ? cellChildren : [makeRun(' ', baseOpts, font)],
          })],
          shading: isHeader ? { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' } : undefined,
          verticalAlign: VerticalAlign.CENTER,
        }));
      }
      if (cells.length) {
        rows.push(new TableRow({
          children: cells,
          height: { value: convertInchesToTwip(0.35), rule: HeightRule.ATLEAST },
        }));
      }
    }
    return rows.length
      ? [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })]
      : [];
  }

  if (['p', 'div', 'span', 'article', 'section'].includes(tag)) {
    const children: InlineChild[] = [];
    const blockChildren: BlockOutput[] = [];
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const childTag = (n as Element).tagName.toLowerCase();
        if (['p', 'div', 'ul', 'ol', 'table', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'article', 'section'].includes(childTag)) {
          blockChildren.push(...await blockToBlocks(n as Element, rtl, font, listLevel));
          continue;
        }
      }
      children.push(...parseInline(n, baseOpts, font));
    }
    if (blockChildren.length) {
      if (children.length) {
        blockChildren.unshift(new Paragraph({
          bidirectional: rtl,
          alignment: getAlign(el, rtl),
          children,
          spacing: { before: 80, after: 80, line: LINE_BODY, lineRule: LineRuleType.AUTO },
        }));
      }
      return blockChildren;
    }
    if (!children.length) return [];
    return [new Paragraph({
      bidirectional: rtl,
      alignment: getAlign(el, rtl),
      children,
      spacing: { before: 80, after: 80, line: LINE_BODY, lineRule: LineRuleType.AUTO },
    })];
  }

  const nested: BlockOutput[] = [];
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      nested.push(...await blockToBlocks(n as Element, rtl, font, listLevel));
    }
  }
  return nested;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ArticleExportData {
  title: string;
  content: string;
  summary?: string;
  source?: string;
  category?: string;
  link?: string;
  published_at?: string;
  author?: string;
}

export async function exportArticleToDocx(article: ArticleExportData): Promise<Uint8Array> {
  const fullText = `${article.title} ${article.summary ?? ''} ${article.content}`;
  const rtl = isArabic(fullText);
  const font = pickFont(rtl);
  const locale = rtl ? 'ar-SA' : 'en-US';

  const parser = new DOMParser();
  const dom = parser.parseFromString(article.content || '', 'text/html');

  const bodyChildren: (Paragraph | Table)[] = [];

  bodyChildren.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: 0, after: 200, line: LINE_BODY, lineRule: LineRuleType.AUTO },
    children: [new TextRun({
      text: article.title,
      bold: true,
      font,
      size: SIZE_TITLE,
      rightToLeft: rtl,
      color: '111827',
    })],
  }));

  const metaParts: string[] = [];
  if (article.author) metaParts.push(article.author);
  if (article.source) metaParts.push(article.source);
  if (article.published_at) {
    try {
      metaParts.push(new Date(article.published_at).toLocaleDateString(locale, { dateStyle: 'long' }));
    } catch { /* ignore */ }
  }
  if (article.category) metaParts.push(article.category);
  if (metaParts.length) {
    bodyChildren.push(new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { before: 0, after: 160, line: LINE_BODY, lineRule: LineRuleType.AUTO },
      children: [new TextRun({
        text: metaParts.join(' · '),
        italics: true,
        color: COLOR_MUTED,
        size: SIZE_SMALL,
        font,
        rightToLeft: rtl,
      })],
    }));
  }

  if (article.link?.trim()) {
    bodyChildren.push(new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { before: 0, after: 200 },
      children: [
        new ExternalHyperlink({
          link: article.link.trim(),
          children: [new TextRun({
            text: article.link.trim(),
            font,
            size: SIZE_SMALL,
            color: COLOR_LINK,
            underline: { type: UnderlineType.SINGLE },
            rightToLeft: rtl,
          })],
        }),
      ],
    }));
  }

  if (article.summary?.trim()) {
    bodyChildren.push(new Paragraph({
      bidirectional: rtl,
      alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: rtl ? { right: convertInchesToTwip(0.3) } : { left: convertInchesToTwip(0.3) },
      border: rtl
        ? { right: { color: COLOR_ACCENT, space: 10, size: 14, style: BorderStyle.SINGLE } }
        : { left: { color: COLOR_ACCENT, space: 10, size: 14, style: BorderStyle.SINGLE } },
      shading: { type: ShadingType.SOLID, color: 'FAF5FF', fill: 'FAF5FF' },
      spacing: { before: 160, after: 280, line: LINE_BODY, lineRule: LineRuleType.AUTO },
      children: [new TextRun({
        text: article.summary,
        italics: true,
        size: SIZE_BODY,
        font,
        rightToLeft: rtl,
        color: COLOR_BODY,
      })],
    }));
  }

  bodyChildren.push(new Paragraph({
    border: { bottom: { color: 'D1D5DB', space: 1, size: 6, style: BorderStyle.SINGLE } },
    spacing: { before: 80, after: 280 },
    children: [new TextRun({ text: '' })],
  }));

  for (const node of Array.from(dom.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const blocks = await blockToBlocks(node as Element, rtl, font);
      blocks.forEach(b => bodyChildren.push(b));
    } else if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim() ?? '';
      if (t) {
        bodyChildren.push(new Paragraph({
          bidirectional: rtl,
          alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: decodeEntities(t), font, size: SIZE_BODY, rightToLeft: rtl, color: COLOR_BODY })],
          spacing: { before: 80, after: 80, line: LINE_BODY, lineRule: LineRuleType.AUTO },
        }));
      }
    }
  }

  const headerTitle = article.title.length > 80 ? `${article.title.slice(0, 77)}…` : article.title;

  const doc = new Document({
    creator: 'EyesPro',
    title: article.title,
    description: article.summary ?? article.title,
    compatibility: { version: 15 },
    styles: {
      default: {
        document: {
          run: { font, size: SIZE_BODY, rightToLeft: rtl, color: COLOR_BODY },
          paragraph: {
            spacing: { line: LINE_BODY, lineRule: LineRuleType.AUTO },
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
          },
        },
        title: {
          run: { font, bold: true, size: SIZE_TITLE, color: '111827', rightToLeft: rtl },
          paragraph: { spacing: { before: 0, after: 200 } },
        },
        heading1: {
          run: { font, bold: true, size: SIZE_H1, color: '111827', rightToLeft: rtl },
          paragraph: { spacing: { before: 360, after: 180, line: LINE_BODY, lineRule: LineRuleType.AUTO } },
        },
        heading2: {
          run: { font, bold: true, size: SIZE_H2, color: '1F2937', rightToLeft: rtl },
          paragraph: { spacing: { before: 280, after: 140, line: LINE_BODY, lineRule: LineRuleType.AUTO } },
        },
        heading3: {
          run: { font, bold: true, size: SIZE_H3, color: '374151', rightToLeft: rtl },
          paragraph: { spacing: { before: 220, after: 120, line: LINE_BODY, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '\u2022',
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: rtl ? 0 : convertInchesToTwip(0.35),
                    right: rtl ? convertInchesToTwip(0.35) : 0,
                    hanging: convertInchesToTwip(0.2),
                  },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '\u25E6',
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: rtl ? 0 : convertInchesToTwip(0.65),
                    right: rtl ? convertInchesToTwip(0.65) : 0,
                    hanging: convertInchesToTwip(0.2),
                  },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: '\u25AA',
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: rtl ? 0 : convertInchesToTwip(0.95),
                    right: rtl ? convertInchesToTwip(0.95) : 0,
                    hanging: convertInchesToTwip(0.2),
                  },
                },
              },
            },
          ],
        },
        {
          reference: NUMBER_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: rtl ? 0 : convertInchesToTwip(0.35),
                    right: rtl ? convertInchesToTwip(0.35) : 0,
                    hanging: convertInchesToTwip(0.2),
                  },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: rtl ? 0 : convertInchesToTwip(0.65),
                    right: rtl ? convertInchesToTwip(0.65) : 0,
                    hanging: convertInchesToTwip(0.2),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: PAGE_MARGIN,
            right: PAGE_MARGIN,
            bottom: PAGE_MARGIN,
            left: PAGE_MARGIN,
            header: convertInchesToTwip(0.5),
            footer: convertInchesToTwip(0.5),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            bidirectional: rtl,
            alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({
              text: headerTitle,
              font,
              size: 18,
              color: COLOR_MUTED,
              rightToLeft: rtl,
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: rtl ? 'صفحة ' : 'Page ', font, size: 18, color: COLOR_MUTED, rightToLeft: rtl }),
              new TextRun({ children: [PageNumber.CURRENT], font, size: 18, color: COLOR_MUTED }),
              new TextRun({ text: rtl ? ' من ' : ' of ', font, size: 18, color: COLOR_MUTED, rightToLeft: rtl }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size: 18, color: COLOR_MUTED }),
            ],
          })],
        }),
      },
      children: bodyChildren,
    }],
  });

  const ab = await Packer.toArrayBuffer(doc);
  return new Uint8Array(ab);
}
