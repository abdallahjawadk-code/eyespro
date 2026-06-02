import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  SectionType,
  TextRun,
} from 'docx';
import type { ArticleFull } from '../../shared/api-types';

export type DocxGroupBy = 'source' | 'category' | 'status' | 'none';

export interface DocxExportOptions {
  groupBy?: DocxGroupBy;
  title?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function metaLine(article: ArticleFull): string {
  const parts: string[] = [];
  if (article.source) parts.push(`المصدر: ${article.source}`);
  if (article.category) parts.push(`الفئة: ${article.category}`);
  if (article.updated_at) parts.push(`التاريخ: ${new Date(article.updated_at).toLocaleDateString('ar-SA')}`);
  if (article.word_count) parts.push(`${article.word_count} كلمة`);
  return parts.join('  •  ');
}

function buildArticleParagraphs(article: ArticleFull, isLast: boolean): Paragraph[] {
  const paras: Paragraph[] = [];

  paras.push(
    new Paragraph({
      text: article.title || '(بدون عنوان)',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 120 },
    })
  );

  const meta = metaLine(article);
  if (meta) {
    paras.push(
      new Paragraph({
        children: [new TextRun({ text: meta, color: '888888', size: 18, italics: true })],
        spacing: { after: 200 },
      })
    );
  }

  if (article.tldr) {
    paras.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'الملخص: ', bold: true, size: 20 }),
          new TextRun({ text: stripHtml(article.tldr), size: 20 }),
        ],
        spacing: { after: 160 },
      })
    );
  } else if (article.summary) {
    paras.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'الملخص: ', bold: true, size: 20 }),
          new TextRun({ text: stripHtml(article.summary), size: 20 }),
        ],
        spacing: { after: 160 },
      })
    );
  }

  if (article.content) {
    const body = stripHtml(article.content);
    const chunks = body.match(/.{1,2000}/gs) ?? [body];
    for (const chunk of chunks) {
      paras.push(
        new Paragraph({
          children: [new TextRun({ text: chunk, size: 22 })],
          alignment: AlignmentType.BOTH,
          spacing: { after: 140, line: 360 },
        })
      );
    }
  }

  if (article.link) {
    paras.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'الرابط: ', bold: true, size: 18, color: '666666' }),
          new TextRun({ text: article.link, size: 18, color: '2563EB' }),
        ],
        spacing: { after: 120 },
      })
    );
  }

  if (!isLast) {
    paras.push(new Paragraph({ children: [new PageBreak()] }));
  }

  return paras;
}

function groupArticles(articles: ArticleFull[], groupBy: DocxGroupBy): Map<string, ArticleFull[]> {
  const map = new Map<string, ArticleFull[]>();

  if (groupBy === 'none') {
    map.set('', articles);
    return map;
  }

  for (const a of articles) {
    let key = '';
    if (groupBy === 'source') key = a.source || 'مصدر غير معروف';
    else if (groupBy === 'category') key = a.category || 'غير مصنف';
    else if (groupBy === 'status') key = a.status || 'draft';

    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }

  return map;
}

const GROUP_LABELS: Record<DocxGroupBy, string> = {
  source: 'المصدر',
  category: 'الفئة',
  status: 'الحالة',
  none: '',
};

const STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  pending: 'معلق',
  published: 'منشور',
  archived: 'مؤرشف',
};

export async function generateDocx(articles: ArticleFull[], opts: DocxExportOptions = {}): Promise<Buffer> {
  const groupBy: DocxGroupBy = opts.groupBy ?? 'source';
  const docTitle = opts.title || `تقرير المقالات — ${new Date().toLocaleDateString('ar-SA')}`;

  const groups = groupArticles(articles, groupBy);
  const allParagraphs: Paragraph[] = [];

  // Cover page
  allParagraphs.push(
    new Paragraph({
      children: [new TextRun({ text: 'EyesPro', bold: true, size: 52, color: '1E40AF' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: docTitle, bold: true, size: 36 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `عدد المقالات: ${articles.length}`, size: 24, color: '555555' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: new Date().toLocaleString('ar-SA'), size: 22, color: '888888' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  let groupIndex = 0;
  for (const [groupKey, groupArticles] of groups) {
    if (groupBy !== 'none' && groupKey) {
      const label = groupBy === 'status' ? (STATUS_AR[groupKey] ?? groupKey) : groupKey;
      allParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${GROUP_LABELS[groupBy]}: ${label}`, bold: true, size: 32, color: '1E40AF' }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: groupIndex > 0 ? 600 : 0, after: 240 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${groupArticles.length} مقال`, size: 20, color: '888888' })],
          spacing: { after: 320 },
        })
      );
    }

    for (let i = 0; i < groupArticles.length; i++) {
      const isLastInDoc = groupIndex === groups.size - 1 && i === groupArticles.length - 1;
      allParagraphs.push(...buildArticleParagraphs(groupArticles[i], isLastInDoc));
    }

    groupIndex++;
  }

  const doc = new Document({
    creator: 'EyesPro',
    title: docTitle,
    description: `تقرير مقالات مُصدَّر من EyesPro — ${new Date().toISOString()}`,
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
        },
        children: allParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
