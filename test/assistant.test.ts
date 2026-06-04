import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers/test-db';
import type Database from 'better-sqlite3';

// Setup mock for electron/database dependencies
let db: Database.Database;
beforeEach(() => {
  db = setupTestDb();
});
afterEach(() => {
  teardownTestDb();
  vi.restoreAllMocks();
});

// Mock the AI module
const runAiChainMock = vi.fn();
const checkAiProviderReadyMock = vi.fn().mockResolvedValue({ ok: true, provider: 'gemini' });
const resolveEffectiveAiProviderMock = vi.fn().mockReturnValue('gemini');
const formatAiErrorMessageMock = vi.fn((m) => `Formatted: ${m}`);

vi.mock('../src/main/services/ai', () => ({
  runAiChain: (p: string, i: string) => runAiChainMock(p, i),
  checkAiProviderReady: () => checkAiProviderReadyMock(),
  resolveEffectiveAiProvider: () => resolveEffectiveAiProviderMock(),
  formatAiErrorMessage: (m: string) => formatAiErrorMessageMock(m),
}));

// Mock settings to avoid throwing errors on getSetting('ui_language') or similar
vi.mock('../src/main/services/settings', () => ({
  getSetting: (key: string) => {
    if (key === 'ai_provider') return 'gemini';
    return '';
  },
  setSetting: () => {},
}));

// Mock dashboard metrics
vi.mock('../src/main/services/analytics', () => ({
  dashboardMetrics: () => ({ total: 10, published: 5, pending: 3, sources: 2 }),
}));

// Import module under test after helper/mocks
import { runAssistant } from '../src/main/services/assistant';

describe('Assistant Command Parser & Local Matcher', () => {
  it('instantly matches "اعرض آخر المقالات" without calling AI', async () => {
    const result = await runAssistant('اعرض آخر المقالات');
    
    // Assert that AI mocks were never called
    expect(runAiChainMock).not.toHaveBeenCalled();
    expect(checkAiProviderReadyMock).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('list_articles');
    expect(result.reply).toContain('جاري جلب أحدث المقالات...');
  });

  it('instantly matches "افتح الإعدادات" and redirects screen', async () => {
    const result = await runAssistant('افتح الإعدادات');
    
    expect(runAiChainMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.tool).toBe('open_screen');
    expect(result.navigate).toBe('/settings');
  });

  it('instantly matches "عرض الإحصائيات" and returns stats tool', async () => {
    const result = await runAssistant('عرض الإحصائيات');
    
    expect(runAiChainMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.tool).toBe('get_stats');
    expect(result.reply).toContain('لديك 10 مقالاً');
  });

  it('falls back to AI parser for unstructured commands', async () => {
    // Mock the AI response representing intent mapping to list_articles
    runAiChainMock.mockResolvedValueOnce(
      JSON.stringify({
        tool: 'list_articles',
        args: { limit: 3 },
        reply: 'تفضل أحدث المقالات من الذكاء الاصطناعي:'
      })
    );

    const result = await runAssistant('أريد أن ألقي نظرة على المقالات الجديدة لو سمحت');
    
    expect(runAiChainMock).toHaveBeenCalled();
    expect(checkAiProviderReadyMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.tool).toBe('list_articles');
  });

  it('returns a formatted error with details when AI chain throws', async () => {
    runAiChainMock.mockRejectedValueOnce(new Error('rate limit reached'));

    const result = await runAssistant('كتابة مقال جديد');
    
    expect(result.ok).toBe(false);
    expect(result.reply).toContain('تعذّر فهم الأمر عبر الذكاء الاصطناعي.');
    expect(result.reply).toContain('Formatted: rate limit reached');
  });
});
