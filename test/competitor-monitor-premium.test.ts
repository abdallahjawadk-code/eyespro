import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  groupSnapshotsIntoSemanticClusters,
  synthesizeArticleFromSnapshots,
  getTopicAlerts
} from '../src/main/services/competitor-monitor';
import { runAiChain } from '../src/main/services/ai';
import { transcribeUrl } from '../src/main/services/transcribe';
import { createArticle } from '../src/main/services/articles';

// Mock the AI chain execution
vi.mock('../src/main/services/ai', () => ({
  runAiChain: vi.fn(),
}));

// Mock transcription service
vi.mock('../src/main/services/transcribe', () => ({
  transcribeUrl: vi.fn(),
}));

// Mock articles service
vi.mock('../src/main/services/articles', () => ({
  createArticle: vi.fn(),
}));

// Mock database to avoid loading better-sqlite3
const mockAll = vi.fn();
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockTransaction = vi.fn((cb) => () => cb());
const mockPrepare = vi.fn().mockReturnValue({
  all: mockAll,
  run: mockRun,
  get: mockGet,
});

vi.mock('../src/main/db/database', () => ({
  getDb: () => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  }),
}));

describe('Competitor Intelligence Premium Features - Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Semantic Clustering: should group snapshots using SimHash distance', async () => {
    // Return mock snapshots
    const mockSnapshots = [
      {
        id: 1,
        monitor_id: 101,
        title: 'مجلس الاحتياطي الفيدرالي يرفع أسعار الفائدة بمقدار 50 نقطة أساس لمكافحة التضخم',
        summary: 'أعلن المركزي الأمريكي اليوم عن زيادة الفائدة بمقدار نصف نقطة مئوية للحد من التضخم.',
        link: 'https://news.com/1',
        seen_at: '2026-06-04T08:00:00Z',
        is_read: 0,
      },
      {
        id: 2,
        monitor_id: 102,
        title: 'الفيدرالي الأمريكي يقرر زيادة أسعار الفائدة بـ 50 نقطة أساس لمواجهة التضخم',
        summary: 'قرر الاحتياطي الفيدرالي رفع الفائدة بمقدار 50 نقطة أساس للحد من التضخم المتزايد.',
        link: 'https://news.com/2',
        seen_at: '2026-06-04T08:05:00Z',
        is_read: 0,
      },
      {
        id: 3,
        monitor_id: 103,
        title: 'حالة الطقس ودرجات الحرارة المتوقعة غداً في الرياض',
        summary: 'توقعت الأرصاد الجوية أن تكون درجات الحرارة معتدلة غداً بمدينة الرياض.',
        link: 'https://weather.com/1',
        seen_at: '2026-06-04T08:10:00Z',
        is_read: 0,
      }
    ];

    mockAll.mockReturnValueOnce(mockSnapshots);

    const clusters = await groupSnapshotsIntoSemanticClusters(50);

    // Should create 2 clusters: one with the rate hike (containing 1 duplicate) and one weather
    expect(clusters.length).toBe(2);

    const rateHikeCluster = clusters.find(c => c.duplicates.length > 0);
    expect(rateHikeCluster).toBeDefined();
    expect(rateHikeCluster?.main.id).toBe(1);
    expect(rateHikeCluster?.duplicates[0].id).toBe(2);
    // Clustering builds an instant, deterministic comparison summary (no AI call on
    // page load); the AI deep-synthesis is reserved for the explicit "دمج" action.
    expect(rateHikeCluster?.diffSummary).toContain('تغطية متوازية');
    expect(rateHikeCluster?.diffSummary).toContain('مصادر');
    expect(runAiChain).not.toHaveBeenCalled();

    const weatherCluster = clusters.find(c => c.duplicates.length === 0);
    expect(weatherCluster).toBeDefined();
    expect(weatherCluster?.main.id).toBe(3);
  });

  it('2. Smart Topic Alerts: should alert when multiple competitors cover the same topic', async () => {
    // Return mock unread snapshots from the last 24 hours
    const mockSnapshots = [
      {
        id: 1,
        monitor_id: 101,
        monitor_name: 'المنافس الأول',
        title: 'مجلس الاحتياطي الفيدرالي يرفع أسعار الفائدة بمقدار 50 نقطة أساس',
        summary: 'أعلن المركزي الأمريكي اليوم عن زيادة الفائدة بمقدار نصف نقطة مئوية للحد من التضخم.',
        link: 'https://news.com/1',
        seen_at: '2026-06-04T08:00:00Z',
        is_read: 0,
      },
      {
        id: 2,
        monitor_id: 102,
        monitor_name: 'المنافس الثاني',
        title: 'الفيدرالي الأمريكي يقرر زيادة أسعار الفائدة بـ 50 نقطة أساس لمواجهة التضخم',
        summary: 'قرر الاحتياطي الفيدرالي رفع الفائدة بمقدار 50 نقطة أساس للحد من التضخم المتزايد.',
        link: 'https://news.com/2',
        seen_at: '2026-06-04T08:05:00Z',
        is_read: 0,
      }
    ];

    mockAll.mockReturnValueOnce(mockSnapshots);

    const alerts = await getTopicAlerts();

    // Should generate 1 alert
    expect(alerts.length).toBe(1);
    expect(alerts[0].topicTitle).toContain('الفيدرالي');
    expect(alerts[0].severity).toBe('medium'); // 2 competitors -> medium, 3+ -> high
    expect(alerts[0].snapshotIds).toContain(1);
    expect(alerts[0].snapshotIds).toContain(2);
  });

  it('3. Cross-Media Synthesis: should transcribe video snapshots and consolidate articles', async () => {
    const mockSnapshots = [
      {
        id: 1,
        monitor_id: 101,
        title: 'رفع أسعار الفائدة بـ 50 نقطة أساس',
        summary: 'المقال النصي يتناول التضخم وسرعة رفع الفائدة.',
        link: 'https://news.com/1',
        is_read: 0,
      },
      {
        id: 10,
        monitor_id: 105,
        title: 'تقرير مصور عن أسعار الفائدة',
        summary: 'تقرير فيديو حول الفائدة.',
        link: 'https://youtube.com/watch?v=rate-hike-video',
        is_read: 0,
      }
    ];

    mockAll.mockReturnValueOnce(mockSnapshots);
    
    // Mock the Whisper video transcription to return a success text
    vi.mocked(transcribeUrl).mockResolvedValueOnce({
      ok: true,
      text: 'هذا تفريغ صوتي مسحوب من الفيديو لمكافحة التضخم.',
      provider: 'ollama'
    });

    // Mock AI report consolidation JSON response
    const mockAiSynthesisJson = JSON.stringify({
      title: 'دمج مصادر: الفيدرالي يرفع أسعار الفائدة بـ 50 نقطة أساس',
      summary: 'تقرير مدمج يتناول الفائدة والتضخم.',
      content: 'محتوى التقرير الصحفي المدمج بالتفصيل...'
    });
    vi.mocked(runAiChain).mockResolvedValueOnce(mockAiSynthesisJson);

    // Mock articles creation ID
    vi.mocked(createArticle).mockReturnValueOnce(999);

    const articleId = await synthesizeArticleFromSnapshots([1, 10]);

    // Verify it called transcription for YouTube URL
    expect(transcribeUrl).toHaveBeenCalledWith('https://youtube.com/watch?v=rate-hike-video');

    // Verify it called the AI consolidation prompt with the transcription text included
    expect(runAiChain).toHaveBeenCalled();
    const aiChainCallArgs = vi.mocked(runAiChain).mock.calls[0];
    expect(aiChainCallArgs[1]).toContain('تفريغ فيديو مرئي');
    expect(aiChainCallArgs[1]).toContain('تفريغ صوتي مسحوب من الفيديو');

    // Verify draft article was created and ID returned
    expect(createArticle).toHaveBeenCalledWith(expect.objectContaining({
      title: 'دمج مصادر: الفيدرالي يرفع أسعار الفائدة بـ 50 نقطة أساس',
      status: 'draft',
      ingest_status: 'synthesized_from_competitors'
    }));
    expect(articleId).toBe(999);

    // Verify it marked snapshots as read and saved article link
    expect(mockRun).toHaveBeenCalled();
  });
});
