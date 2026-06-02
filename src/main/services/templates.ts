import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';
import { createArticle } from './articles';

export function listArticleTemplates() {
  return getDb().prepare(`SELECT * FROM article_templates ORDER BY name`).all();
}

export function createArticleTemplate(data: {
  name: string;
  title_template?: string;
  content_template?: string;
  category?: string;
}): number {
  const r = getDb()
    .prepare(
      `INSERT INTO article_templates (name, title_template, content_template, category) VALUES (?, ?, ?, ?)`
    )
    .run(
      sanitizeString(data.name, 200),
      data.title_template ?? null,
      data.content_template ?? null,
      data.category ?? null
    );
  return Number(r.lastInsertRowid);
}

export function deleteArticleTemplate(id: number): boolean {
  return getDb().prepare(`DELETE FROM article_templates WHERE id=?`).run(id).changes > 0;
}

export function applyArticleTemplate(templateId: number): number {
  const t = getDb().prepare(`SELECT * FROM article_templates WHERE id=?`).get(templateId) as
    | { title_template: string; content_template: string; category: string }
    | undefined;
  if (!t) throw new Error('Template not found');
  return createArticle({
    title: t.title_template || 'Untitled',
    content: t.content_template || '',
    category: t.category,
    status: 'draft'
  });
}

export function listPublishTemplates() {
  return getDb().prepare(`SELECT * FROM publish_templates ORDER BY name`).all();
}

export function createPublishTemplate(name: string, platforms: string[]): number {
  const r = getDb()
    .prepare(`INSERT INTO publish_templates (name, platforms) VALUES (?, ?)`)
    .run(sanitizeString(name, 200), JSON.stringify(platforms));
  return Number(r.lastInsertRowid);
}

export function deletePublishTemplate(id: number): boolean {
  return getDb().prepare(`DELETE FROM publish_templates WHERE id=?`).run(id).changes > 0;
}
