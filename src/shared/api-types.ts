export type Role = 'super_admin' | 'editor' | 'reporter' | 'viewer';

export interface UserPublic {
  id: number;
  username: string;
  email: string | null;
  role: Role;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  needs2fa?: boolean;
  pendingUser?: string;
}

export interface PublishLogRow {
  id: number;
  article_id: number;
  article_title: string | null;
  platform: string;
  success: number;
  post_url: string | null;
  error: string | null;
  created_at: string;
}

export interface PublishOutcome {
  ok: boolean;
  platform: string;
  postUrl?: string;
  postId?: string;
  error?: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  totpCode?: string;
}

export interface QuickLoginUser {
  id: number;
  username: string;
  has_pin: number;
  has_bio: number;
}

export interface PasswordResetRequest {
  username?: string;
  email?: string;
}

export interface PasswordResetConfirm extends PasswordResetRequest {
  code: string;
  newPassword: string;
}

export interface LoginResult {
  token: string;
  user: UserPublic;
  expiresAt: string;
}

export interface DashboardStats {
  pending: number;
  published: number;
  sources: number;
  today: number;
}

export interface ArticleRow {
  id: number;
  title: string;
  status: string;
  category: string | null;
  updated_at: string;
}

export interface ArticleFull extends ArticleRow {
  summary: string | null;
  content: string | null;
  link: string | null;
  image_url: string | null;
  video_url?: string | null;
  source: string | null;
  word_count: number;
  published_at: string | null;
  created_at: string;
  workflow_status?: string | null;
  processing_status?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  tldr?: string | null;
  sentiment?: string | null;
  sentiment_score?: number | null;
  original_content?: string | null;
  tags?: string | null;
}

export interface SourceRow {
  id: number;
  name: string;
  url: string | null;
  enabled: number;
  source_type: string | null;
  category: string | null;
  css_selector: string | null;
  link_extensions: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
  use_ai_extractor?: number;
  include_keywords?: string | null;
  exclude_keywords?: string | null;
  fetch_mode?: string | null;
  last_item_guid?: string | null;
  last_pub_date?: string | null;
  clean_rules_json?: string | null;
  fetch_interval_min?: number;
  next_fetch_at?: string | null;
  trust_score?: number | null;
  feed_etag?: string | null;
  feed_last_modified?: string | null;
}

export interface VideoPublishResult {
  ok: boolean;
  error?: string;
  url?: string;
  postId?: string;
}

export interface ScheduledTask {
  id: number;
  name: string;
  task_type: string;
  article_id: number | null;
  platforms: string | null;
  scheduled_at: string;
  status: string;
  repeat_rule: string | null;
  created_at: string;
}

export type PipelineProfileId = 'full' | 'light' | 'sanitize_only';

export interface PipelinePreviewItem {
  articleId: number;
  title: string;
  status: string;
  profile: PipelineProfileId;
  steps: string[];
  ready: boolean;
}

export interface PipelineArticleDetail {
  article: {
    id: number;
    title: string;
    processing_status: string | null;
    pipeline_profile: string | null;
    pipeline_quality_score: number | null;
  };
  remainingSteps: string[];
  log: Array<{ step?: string; status?: string; message?: string; created_at?: string }>;
  aiRuns: Array<{
    step?: string;
    ok?: number;
    skipped?: number;
    error?: string;
    provider?: string;
    duration_ms?: number;
    created_at?: string;
  }>;
}

export interface PipelineQueueStats {
  pending: number;
  running: number;
  failed: number;
  stuckPending: number;
}

export interface ImportReport {
  users: number;
  articles: number;
  settings: number;
  sources: number;
  publishLogs: number;
  skipped: string[];
}

export interface PublishResult {
  platform: string;
  ok: boolean;
  error?: string;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface RolePermission {
  role: string;
  platform: string;
  action: string;
  allowed: number;
}

export type ThemeMode = 'dark' | 'light' | 'system';
export type LangCode = 'ar' | 'en';

export interface AiModel {
  id: string;
  name: string;
  provider: 'gemini' | 'ollama' | 'openai' | 'groq' | 'anthropic';
  type: 'cloud' | 'local';
}

type Inv<T> = Promise<ApiResult<T>>;

export interface TrendRow {
  id: number;
  title: string;
  region: string;
  source: string;
  traffic: string | null;
  description: string | null;
  status: 'pending' | 'generating' | 'completed' | 'dismissed';
  article_id: number | null;
  created_at: string;
}

export type TrendSourceType = 'google_trends_geo' | 'rss' | 'atom' | 'youtube' | 'reddit';

export interface TrendSourceRow {
  id: number;
  name: string;
  type: TrendSourceType;
  url: string;
  region_tag: string;
  is_builtin: number;
  is_enabled: number;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface TrendSourceTypeInfo {
  labelAr: string;
  labelEn: string;
  hint: string;
  example: string;
}

export interface AutopilotConfig {
  enabled: boolean;
  crisisMode: boolean;
  geo: string;
  maxPerRun: number;
  autoPipeline: boolean;
  dedupEnabled: boolean;
  fetchGoogle: boolean;
  intervalMin: number;
}

export interface AutopilotProgress {
  phase: string;
  message: string;
  current?: number;
  total?: number;
}

export interface AutopilotRunResult {
  ok: boolean;
  runId?: number;
  trendsInserted: number;
  processed: number;
  duplicatesSkipped: number;
  generated: number;
  pipelineOk: number;
  pipelineFailed: number;
  errors: string[];
  articleIds: number[];
}

export interface AutopilotRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  config_json: string;
  result_json: string | null;
  user_id: number | null;
}

export interface AutopilotStatus {
  running: boolean;
  config: AutopilotConfig;
  lastRun: AutopilotRunRow | null;
  pendingTrends: number;
}

// ─── Video Factory types ───────────────────────────────────────────────────────
export interface VideoJob {
  id: number;
  article_id: number | null;
  status: string;
  script: string | null;
  output_path: string | null;
  template: string;
  error: string | null;
  created_at: string;
}

// ─── Competitor Monitor types ─────────────────────────────────────────────────
export type MonitorSourceType = 'rss' | 'facebook' | 'youtube' | 'google_news' | 'twitter' | 'instagram' | 'tiktok' | 'website';


export type DownloadQuality = 'best' | '1080p' | '720p' | '480p' | '360p' | 'audio_only';
export type PlatformRatio = 'youtube' | 'tiktok' | 'instagram_reel' | 'instagram_square' | 'twitter';
export type WatermarkPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center';

export interface VideoInfo {
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  description: string;
  viewCount: number | null;
  likeCount: number | null;
  uploadDate: string;
  platform: string;
  formats: { id: string; ext: string; height: number | null; note: string }[];
  webpage_url: string;
}

export interface LocalFile {
  name: string;
  path: string;
  size: number;
  ext: string;
  mtimeMs: number;
  sourceUrl?: string | null;
}

export interface DownloadJob {
  id: string;
  url: string;
  quality: DownloadQuality;
  status: 'pending' | 'downloading' | 'done' | 'error';
  progress: number;
  speed: string;
  eta: string;
  outputPath: string | null;
  title: string;
  error: string | null;
  startedAt: string;
}

export interface CompetitorMonitor {
  id: number;
  name: string;
  source_type: MonitorSourceType;
  feed_url: string;
  fb_page_url: string | null;
  website_url: string | null;
  extra_config: string | null;
  last_checked_at: string | null;
  last_content_hash: string | null;
  active: number;
}

export interface CompetitorSnapshot {
  id: number;
  monitor_id: number;
  title: string;
  link: string | null;
  summary: string | null;
  published_at: string | null;
  seen_at: string;
  is_read: number;
  rewritten_article_id: number | null;
  diff_text: string | null;
  thumbnail_url: string | null;
}

export interface EyesProApi {
  auth: {
    login: (payload: LoginPayload) => Inv<LoginResult>;
    logout: () => Inv<void>;
    session: () => Inv<{ user: UserPublic } | null>;
    changePassword: (current: string, next: string) => Inv<void>;
    setup2fa: () => Inv<{ secret: string; uri: string }>;
    enable2fa: (code: string) => Inv<{ backupCodes: string[] }>;
    disable2fa: (code: string) => Inv<void>;
    status2fa: () => Inv<{ enabled: boolean }>;
    requestPasswordReset: (payload: PasswordResetRequest) => Inv<{ message?: string; sentTo?: string }>;
    confirmPasswordReset: (payload: PasswordResetConfirm) => Inv<{ message?: string; username?: string }>;
    quickLoginUsers: () => Inv<QuickLoginUser[]>;
  };
  dashboard: { stats: () => Inv<DashboardStats> };
  articles: {
    pageInit: () => Inv<{ categories: string[]; stats: { total: number; draft: number; pending: number; published: number } }>;
    downloadDocx: (articleIds: number[], opts?: { groupBy?: 'source' | 'category' | 'status' | 'none'; title?: string; toDesktop?: boolean }) => Inv<{ filePath: string; count: number }>;
    list: (opts?: {
      status?: string;
      category?: string;
      source?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      sortField?: string;
      sortOrder?: 'ASC' | 'DESC';
      page?: number;
      pageSize?: number;
      limit?: number;
    }) => Inv<ArticleFull[]>;
    count: (opts?: {
      status?: string;
      category?: string;
      source?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    }) => Inv<number>;
    search: (q: string, limit?: number) => Inv<ArticleFull[]>;
    categories: () => Inv<string[]>;
    get: (id: number) => Inv<ArticleFull | null>;
    create: (data: Partial<ArticleFull>) => Inv<{ id: number }>;
    update: (id: number, data: Partial<ArticleFull>) => Inv<void>;
    delete: (id: number) => Inv<void>;
    bulkDelete: (ids: number[]) => Inv<{ deleted: number }>;
    deleteAll:  () => Inv<{ deleted: number }>;
    ingest: (url: string) => Inv<{ ok: boolean; id?: number; error?: string }>;
    checkDuplicate: (link: string) => Inv<{ duplicate: boolean }>;
    saveDocxFile: (filename: string, data: Uint8Array) => Inv<string>;
  };
  sources: {
    list: () => Inv<SourceRow[]>;
    get: (id: number) => Inv<SourceRow | null>;
    create: (data: Partial<SourceRow>) => Inv<{ id: number }>;
    update: (id: number, data: Partial<SourceRow>) => Inv<void>;
    delete: (id: number) => Inv<void>;
    toggle: (id: number, enabled: boolean) => Inv<{ ok: boolean }>;
    fetch: (id: number) => Inv<{ ok: boolean; saved: number; error?: string }>;
    fetchAll: () => Inv<{ total: number; failed: number }>;
    detect: (url: string) => Inv<{
      ok?: boolean;
      type?: string;
      feedUrl?: string;
      title?: string;
      error?: string;
      confidence?: number;
      candidates?: Array<{
        feedUrl: string;
        type: string;
        method: string;
        confidence: number;
        score: number;
        label: string;
        itemCount?: number;
        hasWebSub?: boolean;
      }>;
      best?: {
        feedUrl: string;
        type: string;
        method: string;
        score: number;
        label: string;
      };
      runId?: number;
    }>;
    discover: (url: string) => Inv<{
      ok: boolean;
      inputUrl: string;
      title?: string;
      candidates: Array<{
        feedUrl: string;
        type: string;
        method: string;
        confidence: number;
        score: number;
        label: string;
      }>;
      best?: { feedUrl: string; type: string; method: string; score: number; label: string };
      error?: string;
      runId?: number;
    }>;
    searchFeeds: (query: string) => Inv<Array<{
      title: string;
      feedUrl: string;
      website?: string;
      description?: string;
      subscribers?: number;
      type?: string;
      score?: number;
      provider?: string;
      category?: string;
    }>>;
    searchAdvanced: (opts: {
      query: string;
      region?: 'SA' | 'EG' | 'AE' | 'JO' | 'MA' | 'KW' | 'QA' | 'LB' | 'GLOBAL_AR' | 'GLOBAL_EN';
      sector?: string;
      language?: 'ar' | 'en' | 'any';
      catalogId?: string;
      limit?: number;
      providers?: Record<string, boolean>;
    }) => Inv<{
      results: Array<{
        title: string;
        feedUrl: string;
        website?: string;
        description?: string;
        subscribers?: number;
        type?: string;
        score?: number;
        provider?: string;
        language?: string;
      }>;
      stages: Array<{ id: string; label: string; status: string; count: number; ms: number; error?: string }>;
      cached?: boolean;
      sector?: string;
      error?: string;
    }>;
    listSectors: () => Inv<Array<{ id: string; icon: string; labelAr: string; labelEn: string }>>;
    clearDiscoveryCache: (query?: string) => Inv<{ cleared: number }>;
    similarFeeds: (feedUrl: string) => Inv<Array<{ title: string; feedUrl: string; provider?: string; score?: number }>>;
    suggestCatalog: (data: { name: string; feedUrl: string; website?: string; sector?: string; language?: string }) => Inv<unknown>;
    providerStats: () => Inv<Array<{ provider: string; success_count: number; fail_count: number; last_ok_at: string | null; last_err: string | null }>>;
    listCatalogs: () => Inv<Array<{ id: string; name: string; description: string; language: string; items: unknown[] }>>;
    browseCatalog: (catalogId: string, query?: string) => Inv<{
      results: Array<{ title: string; feedUrl: string; website?: string; type?: string; score?: number; provider?: string }>;
      stages: Array<{ id: string; label: string; status: string; count: number; ms: number }>;
    }>;
    bulkDiscover: (urlsOrText: string) => Inv<{ total: number; imported: number; skipped: number; failed: number }>;
    previewFeed: (feedUrl: string) => Inv<{
      ok: boolean;
      preview?: { title: string; summary: string; contentLength: number; image: string; method: string; purityScore: number; warnings: string[] };
      feedTitle?: string;
      itemCount?: number;
      error?: string;
    }>;
    previewFetch: (id: number, sampleUrl?: string) => Inv<{
      ok: boolean;
      preview?: { title: string; summary: string; contentLength: number; image: string; method: string; purityScore: number; warnings: string[] };
      error?: string;
      health?: { total: number; ok: number; fail: number; avgMs: number; lastError: string | null };
    }>;
    health: (id: number) => Inv<{ total: number; ok: number; fail: number; avgMs: number; lastError: string | null }>;
    healthAll: () => Inv<Array<{
      id: number; name: string; url: string | null; enabled: number;
      last_fetched_at: string | null; last_error: string | null;
      trust_score: number; fetch_interval_min: number | null; next_fetch_at: string | null;
      circuit: { mode: string; shieldScore: number } | null;
      health: { total: number; ok: number; fail: number; avgMs: number; lastError: string | null };
    }>>;
    lowTrust: () => Inv<Array<{ id: number; name: string; url: string | null; trust_score: number; last_error: string | null }>>;
  };
  fetch: {
    audit: (opts?: { sourceId?: number; limit?: number }) => Inv<unknown[]>;
    shieldOverview: () => Inv<{
      overview: { totalHosts: number; openCount: number; feedOnlyCount: number; avgScore: number };
      circuits: Array<{ host: string; mode: string; failureCount: number; shieldScore: number; openUntil: string | null }>;
    }>;
    qualityTiers: () => Inv<{ tiers: Record<string, number>; linkHealth: Record<string, number> }>;
  };
  domainPolicies: {
    list: () => Inv<unknown[]>;
    upsert: (data: unknown) => Inv<void>;
    delete: (host: string) => Inv<{ deleted: boolean }>;
  };
  tasks: {
    list: (status?: string) => Inv<ScheduledTask[]>;
    create: (data: Partial<ScheduledTask>) => Inv<{ id: number }>;
    update: (id: number, data: Partial<ScheduledTask>) => Inv<void>;
    delete: (id: number) => Inv<{ ok: boolean }>;
    run: (id: number) => Inv<{ ok: boolean }>;
  };
  pipeline: {
    kanban: () => Inv<Record<string, unknown[]>>;
    log: (articleId: number) => Inv<unknown[]>;
    config: () => Inv<Record<string, unknown>>;
    jobs: (limit?: number) => Inv<unknown[]>;
    cancelJob: (jobId: number) => Inv<{ cancelled: boolean }>;
    aiStatus: () => Inv<{
      ok: boolean;
      provider: string;
      configuredProvider?: string | null;
      effectiveProvider?: string;
      providerLabel?: string;
      model?: string | null;
      providerReady?: boolean;
      error?: string;
      continueOnAiError?: boolean;
      sessionDisableAi?: boolean;
      aiSkippedThisSession?: boolean;
      aiStepsEnabled?: boolean;
    }>;
    retryFailed: () => Inv<{ retried: number }>;
    dismissFailed: () => Inv<{ dismissed: number }>;
    retryJob: (jobId: number) => Inv<{ retried: boolean }>;
    runStep: (articleId: number, step: string) => Inv<{ ok: boolean; error?: string; skipped?: boolean }>;
    runFull: (articleId: number) => Inv<{ ok: boolean; error?: string }>;
    runBulk: (
      limit?: number,
      profile?: string
    ) => Inv<{ processed: number; failed: number; skipped?: number }>;
    runArticles: (
      articleIds: number[],
      profile?: string
    ) => Inv<{ processed: number; failed: number; skipped?: number }>;
    previewArticles: (articleIds: number[]) => Inv<PipelinePreviewItem[]>;
    previewAuto: (limit?: number) => Inv<{ items: PipelinePreviewItem[]; totalCandidates: number }>;
    articleDetail: (articleId: number) => Inv<PipelineArticleDetail>;
    setProfile: (articleId: number, profile: string) => Inv<{ updated: boolean }>;
    setProfiles: (articleIds: number[], profile: string) => Inv<{ updated: number }>;
    session: () => Inv<{ disableAi: boolean }>;
    setSessionDisableAi: (disable: boolean) => Inv<{ disableAi: boolean }>;
    cancelAllPending: () => Inv<{ cancelled: number }>;
    queueStats: () => Inv<PipelineQueueStats>;
  };
  ai: {
    modes: () => Inv<string[]>;
    status: () => Inv<{ ok: boolean; provider: string; error?: string }>;
    listModels: () => Inv<AiModel[]>;
    setModel: (provider: string, modelId: string) => Inv<{ provider: string; modelId: string }>;
    run: (articleId: number, mode: string) => Inv<{ result?: string }>;
    generateArticle: (
      topic: string,
      opts?: { keywords?: string[]; style?: string; wordCount?: number; language?: string; category?: string; tone?: string }
    ) => Inv<{ articleId?: number; title?: string }>;
    generateVariants: (
      topic: string,
      count?: number,
      opts?: { keywords?: string[]; style?: string; wordCount?: number; language?: string; category?: string; tone?: string }
    ) => Inv<{ articleId?: number; title?: string }[]>;
    jobs: () => Inv<unknown[]>;
    createBatch: (articleIds: number[], mode: string) => Inv<{ id: number }>;
    processJobs: () => Inv<{ processed: number }>;
    testProvider: (
      provider: string,
      fields?: Record<string, string>
    ) => Inv<{
      ok: boolean;
      provider: string;
      latencyMs: number;
      message: string;
      modelsCount?: number;
      sampleModel?: string;
    }>;
    chat: (
      articleId: number,
      history: { role: 'user' | 'assistant'; content: string }[],
      question: string
    ) => Inv<{ response: string }>;
  };
  ollama: {
    status: () => Inv<unknown>;
    recommended: () => Inv<unknown[]>;
    localModels: () => Inv<{ name: string; size?: number }[]>;
    setEnabled: (enabled: boolean) => Inv<{ ok: boolean; error?: string }>;
    start: () => Inv<{ ok: boolean; error?: string }>;
    stop: () => Inv<void>;
    openDownload: () => Inv<void>;
    installWinget: () => Inv<{ ok: boolean; error?: string }>;
    pull: (model: string) => Inv<{ ok: boolean; error?: string }>;
    deleteModel: (name: string) => Inv<{ ok: boolean; error?: string }>;
  };
  quality: {
    queue: (status?: string) => Inv<unknown[]>;
    submit: (articleId: number) => Inv<{ ok: boolean }>;
    approve: (articleId: number) => Inv<{ ok: boolean }>;
    reject: (articleId: number, reason?: string) => Inv<{ ok: boolean }>;
    check: (articleId: number, type?: string) => Inv<{ ok: boolean; score: number; details: string }>;
    reports: (articleId?: number) => Inv<unknown[]>;
    stats: () => Inv<{ avgScore: number; pendingReview: number }>;
  };
  analytics: {
    publishLogs: (limit?: number) => Inv<PublishLogRow[]>;
    dashboard: () => Inv<unknown>;
    exportCsv: () => Inv<{ csv: string }>;
    alerts: () => Inv<unknown[]>;
    dismissAlert: (id: number) => Inv<void>;
    dismissNotif: (id: number, kind: 'system' | 'keyword') => Inv<void>;
  };
  media: {
    list: () => Inv<unknown[]>;
    stats: () => Inv<{ count: number; bytes: number }>;
    pickUpload: () => Inv<{ id: number } | null>;
    delete: (id: number) => Inv<{ ok: boolean }>;
    updateMeta: (id: number, alt: string) => Inv<{ ok: boolean }>;
    getFileUrl: (id: number) => Inv<{ url: string; filepath: string; size: number; mime: string; ext: string } | null>;
  };
  templates: {
    articleList: () => Inv<unknown[]>;
    articleCreate: (data: unknown) => Inv<{ id: number }>;
    articleDelete: (id: number) => Inv<{ ok: boolean }>;
    articleApply: (id: number) => Inv<{ id: number }>;
    publishList: () => Inv<unknown[]>;
    publishCreate: (name: string, platforms: string[]) => Inv<{ id: number }>;
    publishDelete: (id: number) => Inv<{ ok: boolean }>;
  };
  social: {
    platforms: () => Inv<string[]>;
    connections: () => Inv<unknown[]>;
    configuredPlatforms: () => Inv<string[]>;
    save: (platform: string, label: string, config: Record<string, string>) => Inv<{ id: number }>;
    delete: (id: number) => Inv<{ ok: boolean }>;
    guide: (platform: string) => Inv<{ text: string }>;
    test: (id: number) => Inv<{ info?: string }>;
    testPlatform: (platform: string) => Inv<{ info?: string }>;
    openShare: (url: string, clipboardText?: string) => Inv<{ opened: boolean }>;
  };
  publish: {
    platforms: () => Inv<string[]>;
    one: (articleId: number, platform: string, text: string, link?: string) => Inv<PublishOutcome>;
    crossPost: (articleId: number, platforms: string[], text: string, link?: string) => Inv<PublishOutcome[]>;
  };
  youtube: {
    connectOAuth: () => Inv<{ channelTitle?: string; hasRefreshToken?: boolean }>;
    completeOAuthFromUrl: (callbackUrl: string) => Inv<{ channelTitle?: string; hasRefreshToken?: boolean }>;
  };
  twitter: {
    probePublish: () => Inv<{ info?: string }>;
  };
  users: {
    list: () => Inv<UserPublic[]>;
    create: (data: Partial<UserPublic> & { password?: string }) => Inv<{ id: number }>;
    update: (id: number, data: Partial<UserPublic> & { password?: string }) => Inv<void>;
    delete: (id: number) => Inv<void>;
    resetPassword: (id: number, password: string) => Inv<void>;
  };
  permissions: {
    list: () => Inv<RolePermission[]>;
    set: (role: string, platform: string, action: string, allowed: boolean) => Inv<void>;
  };
  audit: { list: () => Inv<unknown[]> };
  system: {
    perf: () => Inv<unknown>;
    cache: () => Inv<unknown>;
  };
  migration: {
    guessPaths: () => Inv<string[]>;
    importLegacy: (filePath: string) => Inv<ImportReport>;
    pickLegacyFile: () => Inv<string | null>;
  };
  backup: {
    create: () => Inv<BackupInfo>;
    list: () => Inv<BackupInfo[]>;
    restore: (filePath: string) => Inv<void>;
  };
  settings: {
    get: (key: string) => Inv<string | null>;
    getAll: () => Inv<Record<string, string>>;
    set: (key: string, value: string) => Inv<void>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  stealth: {
    status: () => Inv<{ enabled: boolean; browser?: boolean; playwright?: boolean; vault: boolean }>;
    testFetch: (url: string, forceBrowser?: boolean) => Inv<{ ok: boolean; status: number; body: string }>;
  };
  links: {
    scan: (url: string) => Inv<unknown>;
    scanBatch: (urls: string[]) => Inv<unknown[]>;
    sanitize: (url: string) => Inv<{ ok: boolean; sanitized: string; error?: string }>;
    extract: (html: string) => Inv<string[]>;
    history: () => Inv<unknown[]>;
    health: (url: string) => Inv<{ url: string; ok: boolean; statusCode: number; state: string; checkedAt: string }>;
    healthLog: () => Inv<unknown[]>;
  };
  domain: {
    intelligence: (host?: string) => Inv<unknown>;
    suggestPolicy: (host: string) => Inv<{ useBrowser: boolean; fetchMode: string; notes: string } | null>;
  };
  video: {
    tools: () => Inv<{ ffmpeg: boolean; whisper: boolean; ffmpegPath?: string }>;
    specs: () => Inv<Record<string, {
      maxWidth: number; maxHeight: number; maxDurationSec?: number;
      videoBitrate: string; audioBitrate: string; codec: string; container: string;
      maxSizeMB: number; note: string; transcodeOptional?: boolean;
    }>>;
    /** Import video directly as article with video_url — does NOT require Whisper */
    pickAndLink: () => Inv<{ articleId: number; videoUrl: string; mediaId: number } | null>;
    pickAndImport: () => Inv<{ ok: boolean; articleId?: number; error?: string } | null>;
    /** Pick a video file and attach it to an EXISTING article by updating video_url */
    attachToArticle: (articleId: number) => Inv<{ videoUrl: string; mediaId: number; articleId: number } | null>;
    importPath: (path: string) => Inv<{ ok: boolean; articleId?: number; error?: string }>;
    probe: (filePath: string) => Inv<unknown>;
    /** Universal in-app playback: returns a playable eyesmedia:// URL, converting (remux/transcode) if needed. */
    prepareForPlayback: (filePath: string, force?: boolean) => Inv<{ url?: string; mode?: 'native' | 'remux' | 'transcode'; error?: string }>;
    mediaToolsStatus: () => Inv<{ source: 'updated' | 'bundled'; ffmpeg: string; updatedAvailable: boolean }>;
    updateMediaTools: () => Inv<{ ok: boolean; source: string; error?: string }>;
    onPrepareProgress: (cb: (data: { pct: number; mode: string }) => void) => (() => void);
    transcode: (filePath: string, platform: string) => Inv<{ outputPath?: string; platform?: string; info?: string }>;
    transcodeMany: (filePath: string, platforms: string[]) => Inv<Record<string, { ok: boolean; outputPath?: string; error?: string; info?: string }>>;
    transcodeMedia: (mediaId: number, platforms: string[]) => Inv<Record<string, { ok: boolean; outputPath?: string; error?: string; info?: string }>>;
    onTranscodeProgress: (cb: (data: { pct: number; msg: string; platform: string }) => void) => void;
    offTranscodeProgress: () => void;
  };
  api: {
    status: () => Inv<{ running: boolean; port: number; baseUrl?: string; rssPublic?: boolean }>;
    start: () => Inv<{ ok: boolean; error?: string }>;
    stop: () => Inv<void>;
    keysList: () => Inv<unknown[]>;
    keyCreate: (name: string, scopes: string[]) => Inv<{ key: string; id: number }>;
    keyRevoke: (id: number) => Inv<void>;
  };
  pin: {
    set: (pin: string) => Inv<{ ok: boolean; code?: string }>;
    remove: () => Inv<void>;
    status: () => Inv<{ enabled: boolean }>;
    login: (userId: number, pin: string) => Inv<LoginResult>;
  };
  biometric: {
    check: () => Inv<{ available: boolean }>;
    enable: (on: boolean) => Inv<void>;
    status: () => Inv<{ enabled: boolean }>;
    login: (userId: number) => Inv<LoginResult>;
  };
  tenants: {
    list: () => Inv<unknown[]>;
    create: (name: string, slug?: string) => Inv<{ id: number }>;
    switch: (id: number | null) => Inv<unknown>;
    current: () => Inv<unknown>;
  };
  updater: {
    status: () => Inv<{ available: boolean; version?: string; downloaded: boolean; error?: string }>;
    check: () => Inv<unknown>;
    download: () => Inv<void>;
    install: () => Inv<void>;
  };
  app: { copyright: () => string };
  translation: {
    text: (text: string, targetLang: string, backend?: string) => Inv<string>;
    article: (articleId: number, targetLang: string, backend?: string, save?: boolean) =>
      Inv<{ title: string; content: string; summary: string }>;
    bulk: (ids: number[], targetLang: string, backend?: string) => Inv<{ done: number; failed: number }>;
  };
  keywords: {
    list: () => Inv<unknown[]>;
    create: (keyword: string) => Inv<{ id: number }>;
    delete: (id: number) => Inv<{ ok: boolean }>;
    toggle: (id: number, enabled: boolean) => Inv<{ ok: boolean }>;
    matches: (dismissed?: boolean) => Inv<unknown[]>;
    dismiss: (id: number) => Inv<{ ok: boolean }>;
  };
  reports: {
    generate: (period: 'weekly' | 'monthly') => Inv<unknown>;
    html: (period: 'weekly' | 'monthly', lang?: string) => Inv<{ html: string }>;
  };
  opml: {
    preview: (xml: string) => Inv<{ count: number; outlines: unknown[] }>;
    import: (xml: string) => Inv<{ created: number; skipped: number; errors: string[] }>;
    importFile: () => Inv<{ created: number; skipped: number; errors: string[] } | null>;
    importUrl: (url: string) => Inv<{ created: number; skipped: number; errors: string[] }>;
  };
  trendRadar: {
    list: (geo?: string) => Inv<TrendRow[]>;
    get: (trendId: number) => Inv<TrendRow | null>;
    stats: () => Inv<{ pending: number; generating: number; completed: number; dismissed: number }>;
    update: (trendId: number, data: { title?: string; description?: string }) => Inv<{ ok: boolean }>;
    reset: (trendId: number) => Inv<{ ok: boolean }>;
    fetch: (geo: string) => Inv<{ ok: boolean; count: number; error?: string }>;
    generate: (trendId: number) => Inv<{ ok: boolean; articleId?: number; error?: string }>;
    dismiss: (trendId: number) => Inv<{ ok: boolean }>;
    listSources: () => Inv<TrendSourceRow[]>;
    sourceTypeInfo: () => Inv<Record<TrendSourceType, TrendSourceTypeInfo>>;
    addSource: (payload: { name: string; type: TrendSourceType; url: string; region_tag?: string }) => Inv<{ ok: boolean; id?: number; error?: string }>;
    deleteSource: (id: number) => Inv<{ ok: boolean; error?: string }>;
    toggleSource: (id: number, enabled: boolean) => Inv<{ ok: boolean }>;
    fetchSource: (id: number) => Inv<{ ok: boolean; count: number; error?: string }>;
    fetchAll: () => Inv<{ total: number; failed: number; inserted: number }>;
  };
  autopilot: {
    status: () => Inv<AutopilotStatus>;
    config: () => Inv<AutopilotConfig>;
    setConfig: (partial: Partial<AutopilotConfig>) => Inv<AutopilotConfig>;
    run: () => Inv<AutopilotRunResult>;
    stop: () => Inv<{ ok: boolean }>;
    runs: (limit?: number) => Inv<AutopilotRunRow[]>;
  };
  license: {
    status: () => Promise<
      | { ok: true; serial: string }
      | { ok: false; reason: 'not_activated' | 'expired' | 'revoked' | 'network_error'; error?: string }
    >;
    activate: (serial: string) => Promise<{ ok: boolean; error?: string }>;
    deactivate: () => Promise<{ ok: boolean; error?: string }>;
    info: () => Promise<{ machine_id: string }>;
  };
  studio: {
    createJob: (articleId: number, template?: string) => Inv<{ id: number }>;
    generateScript: (articleId: number) => Inv<{ script: string }>;
    runJob: (jobId: number) => Inv<{ outputPath: string }>;
    jobs: () => Inv<VideoJob[]>;
    job: (id: number) => Inv<VideoJob | null>;
  };
  monitor: {
    list: () => Inv<CompetitorMonitor[]>;
    add: (name: string, feedUrl: string, websiteUrl?: string, sourceType?: string, fbPageUrl?: string, extraConfigJson?: string) => Inv<{ id: number }>;
    delete: (id: number) => Inv<void>;
    check: (id: number) => Inv<{ found: number }>;
    checkAll: () => Inv<{ checked: number; found: number }>;
    snapshots: (monitorId?: number, limit?: number) => Inv<CompetitorSnapshot[]>;
    markRead: (snapshotId: number) => Inv<void>;
    rewrite: (snapshotId: number) => Inv<{ articleId: number }>;
    unreadCount: () => Inv<number>;
  };
  instagram: {
    login:      () => Inv<void>;
    loggedIn:   () => Inv<boolean>;
    disconnect: () => Inv<void>;
    test:       () => Inv<{ username: string; accountType: string } | { error: string }>;
  };

  downloader: {
    status:       () => Inv<{ installed: boolean; version: string }>;
    update:       () => Inv<{ updated: boolean; version: string }>;
    install:      () => Inv<{ path: string }>;
    start:        (url: string, quality: string, jobId: string) => Inv<{ jobId: string }>;
    list:         () => Inv<DownloadJob[]>;
    scan:         () => Inv<LocalFile[]>;
    info:         (url: string) => Inv<VideoInfo>;
    openFolder:   () => Inv<void>;
    openFile:     (filePath: string) => Inv<void>;
    clear:        () => Inv<void>;
    mediaUrl:     (filePath: string) => Inv<string>;
    trim:         (inputPath: string, startSec: number, endSec: number) => Inv<{ outputPath: string }>;
    watermark:    (inputPath: string, text: string, position: string) => Inv<{ outputPath: string }>;
    resize:       (inputPath: string, platform: string) => Inv<{ outputPath: string }>;
    extractAudio: (inputPath: string) => Inv<{ outputPath: string }>;
    delete:       (filePath: string) => Inv<void>;
  };

  tor: {
    status: () => Inv<{ status: 'stopped' | 'starting' | 'ready' | 'error'; bootstrap: string; socksPort: number; controlPort: number; enabled: boolean }>;
    rotate: () => Inv<{ success: boolean }>;
    toggle: (enabled: boolean) => Inv<{ status: 'stopped' | 'starting' | 'ready' | 'error'; bootstrap: string; socksPort: number; controlPort: number; enabled: boolean }>;
  };
  crawler: {
    crawl: (monitorId: number, startUrl: string, opts?: { maxDepth?: number; maxPages?: number }) => Inv<{ monitorId: number; pagesCrawled: number; snapshotsCreated: number }>;
  };


  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?: (channel: string, cb: (...args: any[]) => void) => (() => void);
}

