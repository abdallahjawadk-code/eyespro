import { describe, expect, it } from 'vitest';
import { articleVideoBody, stripHtml } from '../src/main/services/social-adapters/types';
import type { ArticleFull } from '../src/main/services/articles';

const base = { id: 1, title: 'T', status: 'draft' } as ArticleFull;

describe('articleVideoBody', () => {
  it('returns content when summary is empty', () => {
    expect(articleVideoBody({ ...base, summary: '', content: '<p>Full body</p>' })).toBe('Full body');
  });

  it('returns summary when content is empty', () => {
    expect(articleVideoBody({ ...base, summary: 'Short intro', content: '' })).toBe('Short intro');
  });

  it('combines summary and content when both exist', () => {
    const body = articleVideoBody({
      ...base,
      summary: 'Short intro',
      content: '<p>Paragraph one.</p><p>Paragraph two.</p>',
    });
    expect(body).toBe('Short intro\n\nParagraph one. Paragraph two.');
  });

  it('avoids duplicating summary already in content', () => {
    const body = articleVideoBody({
      ...base,
      summary: 'Short intro',
      content: '<p>Short intro</p><p>More details here.</p>',
    });
    expect(body).toBe('Short intro More details here.');
  });

  it('stripHtml normalizes whitespace', () => {
    expect(stripHtml('<p>Hello   <strong>world</strong></p>')).toBe('Hello world');
  });
});
