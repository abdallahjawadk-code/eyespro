import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiResult,
  EyesProApi,
  LoginPayload,
  LoginResult,
  PasswordResetConfirm,
  PasswordResetRequest,
} from '../shared/api-types';

const COPYRIGHT = '© Masar Network — All rights reserved';

async function persistToken(token: string | null): Promise<void> {
  if (token) await ipcRenderer.invoke('auth:persistToken', token);
  else await ipcRenderer.invoke('auth:clearPersistedToken');
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: EyesProApi = {
  app: { copyright: () => COPYRIGHT },
  auth: {
    login: async (payload: LoginPayload) => {
      const res = await invoke<Awaited<ReturnType<EyesProApi['auth']['login']>>>('auth:login', payload);
      if (res.ok && res.data?.token) await persistToken(res.data.token);
      return res;
    },
    logout: async () => {
      const res = await invoke<Awaited<ReturnType<EyesProApi['auth']['logout']>>>('auth:logout');
      await persistToken(null);
      return res;
    },
    session: async () => invoke('auth:session'),
    changePassword: (current, next) => invoke('auth:changePassword', current, next),
    setup2fa: () => invoke('auth:setup2fa'),
    enable2fa: (code) => invoke('auth:enable2fa', code),
    disable2fa: (code) => invoke('auth:disable2fa', code),
    status2fa: () => invoke('auth:status2fa'),
    requestPasswordReset: (payload: PasswordResetRequest) => invoke('auth:requestPasswordReset', payload),
    confirmPasswordReset: (payload: PasswordResetConfirm) => invoke('auth:confirmPasswordReset', payload),
    quickLoginUsers: () => invoke('auth:quickLoginUsers')
  },
  dashboard: { stats: () => invoke('dashboard:stats') },
  articles: {
    pageInit: () => invoke('articles:pageInit'),
    list: (opts) => invoke('articles:list', opts),
    count: (opts) => invoke('articles:count', opts),
    search: (q, limit) => invoke('articles:search', q, limit),
    categories: () => invoke('articles:categories'),
    get: (id) => invoke('articles:get', id),
    create: (data) => invoke('articles:create', data),
    update: (id, data) => invoke('articles:update', id, data),
    delete: (id) => invoke('articles:delete', id),
    bulkDelete: (ids) => invoke('articles:bulkDelete', ids),
    deleteAll:  () => invoke('articles:deleteAll'),
    ingest: (url) => invoke('articles:ingest', url),
    checkDuplicate: (link) => invoke('articles:checkDuplicate', link),
    saveDocxFile: (filename: string, data: Uint8Array) => invoke('articles:saveDocxFile', filename, data),
    downloadDocx: (articleIds, opts) => invoke('articles:downloadDocx', articleIds, opts),
  },
  sources: {
    list: () => invoke('sources:list'),
    get: (id) => invoke('sources:get', id),
    create: (data) => invoke('sources:create', data),
    update: (id, data) => invoke('sources:update', id, data),
    delete: (id) => invoke('sources:delete', id),
    toggle: (id, enabled) => invoke('sources:toggle', id, enabled),
    fetch: (id) => invoke('sources:fetch', id),
    fetchAll: () => invoke('sources:fetchAll'),
    detect: (url: string) => invoke('sources:detect', url),
    discover: (url: string) => invoke('sources:discover', url),
    searchFeeds: (query: string) => invoke('sources:searchFeeds', query),
    searchAdvanced: (opts: unknown) => invoke('sources:searchAdvanced', opts),
    listCatalogs: () => invoke('sources:listCatalogs'),
    browseCatalog: (catalogId: string, query?: string) => invoke('sources:browseCatalog', catalogId, query),
    listSectors: () => invoke('sources:listSectors'),
    clearDiscoveryCache: (query?: string) => invoke('sources:clearDiscoveryCache', query),
    similarFeeds: (feedUrl: string) => invoke('sources:similarFeeds', feedUrl),
    suggestCatalog: (data: unknown) => invoke('sources:suggestCatalog', data),
    providerStats: () => invoke('sources:providerStats'),
    previewFeed: (feedUrl: string) => invoke('sources:previewFeed', feedUrl),
    bulkDiscover: (text: string) => invoke('sources:bulkDiscover', text),
    previewFetch: (id: number, sampleUrl?: string) => invoke('sources:previewFetch', id, sampleUrl),
    health: (id: number) => invoke('sources:health', id),
    healthAll: () => invoke('sources:healthAll'),
    lowTrust: () => invoke('sources:lowTrust')
  },
  opml: {
    preview: (xml: string) => invoke('opml:preview', xml),
    import: (xml: string) => invoke('opml:import', xml),
    importFile: () => invoke('opml:importFile'),
    importUrl: (url: string) => invoke('opml:importUrl', url)
  },
  fetch: {
    audit: (opts?: { sourceId?: number; limit?: number }) => invoke('fetch:audit', opts),
    shieldOverview: () => invoke('fetch:shieldOverview'),
    qualityTiers: () => invoke('fetch:qualityTiers')
  },
  domainPolicies: {
    list: () => invoke('domainPolicies:list'),
    upsert: (data: unknown) => invoke('domainPolicies:upsert', data),
    delete: (host: string) => invoke('domainPolicies:delete', host)
  },
  tasks: {
    list: (status) => invoke('tasks:list', status),
    create: (data) => invoke('tasks:create', data),
    update: (id, data) => invoke('tasks:update', id, data),
    delete: (id) => invoke('tasks:delete', id),
    run: (id) => invoke('tasks:run', id)
  },
  pipeline: {
    kanban: () => invoke('pipeline:kanban'),
    log: (articleId) => invoke('pipeline:log', articleId),
    config: () => invoke('pipeline:config'),
    jobs: (limit?: number) => invoke('pipeline:jobs', limit),
    cancelJob: (jobId: number) => invoke('pipeline:cancelJob', jobId),
    aiStatus: () => invoke('pipeline:aiStatus'),
    retryFailed: () => invoke('pipeline:retryFailed'),
    retryJob: (jobId: number) => invoke('pipeline:retryJob', jobId),
    dismissFailed: () => invoke('pipeline:dismissFailed'),
    runStep: (articleId, step) => invoke('pipeline:runStep', articleId, step),
    runFull: (articleId) => invoke('pipeline:runFull', articleId),
    runBulk: (limit?: number, profile?: string) => invoke('pipeline:runBulk', limit, profile),
    runArticles: (articleIds: number[], profile?: string) =>
      invoke('pipeline:runArticles', articleIds, profile),
    previewArticles: (articleIds: number[]) => invoke('pipeline:previewArticles', articleIds),
    previewAuto: (limit?: number) => invoke('pipeline:previewAuto', limit),
    articleDetail: (articleId: number) => invoke('pipeline:articleDetail', articleId),
    setProfile: (articleId: number, profile: string) =>
      invoke('pipeline:setProfile', articleId, profile),
    setProfiles: (articleIds: number[], profile: string) =>
      invoke('pipeline:setProfiles', articleIds, profile),
    session: () => invoke('pipeline:session'),
    setSessionDisableAi: (disable: boolean) => invoke('pipeline:setSessionDisableAi', disable),
    cancelAllPending: () => invoke('pipeline:cancelAllPending'),
    queueStats: () => invoke('pipeline:queueStats'),
  },
  ai: {
    modes: () => invoke('ai:modes'),
    status: () => invoke('ai:status'),
    listModels: () => invoke('ai:listModels'),
    setModel: (provider, modelId) => invoke('ai:setModel', provider, modelId),
    run: (articleId, mode) => invoke('ai:run', articleId, mode),
    generateArticle: (topic: string, opts?: Record<string, unknown>) => invoke('ai:generate', topic, opts),
    generateVariants: (topic: string, count?: number, opts?: Record<string, unknown>) =>
      invoke('ai:generateVariants', topic, count, opts),
    jobs: () => invoke('ai:jobs'),
    createBatch: (articleIds, mode) => invoke('ai:createBatch', articleIds, mode),
    processJobs: () => invoke('ai:processJobs'),
    testProvider: (provider: string, fields?: Record<string, string>) =>
      invoke('ai:testProvider', provider, fields),
    chat: (articleId: number, history: { role: 'user' | 'assistant'; content: string }[], question: string) =>
      invoke('ai:chat', articleId, history, question),
  },
  ollama: {
    status: () => invoke('ollama:status'),
    recommended: () => invoke('ollama:recommended'),
    localModels: () => invoke('ollama:localModels'),
    setEnabled: (enabled: boolean) => invoke('ollama:setEnabled', enabled),
    start: () => invoke('ollama:start'),
    stop: () => invoke('ollama:stop'),
    openDownload: () => invoke('ollama:openDownload'),
    installWinget: () => invoke('ollama:installWinget'),
    pull: (model: string) => invoke('ollama:pull', model),
    deleteModel: (name: string) => invoke('ollama:deleteModel', name),
  },
  quality: {
    queue: (status) => invoke('quality:queue', status),
    submit: (articleId) => invoke('quality:submit', articleId),
    approve: (articleId) => invoke('quality:approve', articleId),
    reject: (articleId, reason) => invoke('quality:reject', articleId, reason),
    check: (articleId, type) => invoke('quality:check', articleId, type),
    reports: (articleId) => invoke('quality:reports', articleId),
    stats: () => invoke('quality:stats')
  },
  analytics: {
    publishLogs: (limit?: number) => invoke('analytics:publishLogs', limit),
    dashboard: () => invoke('analytics:dashboard'),
    exportCsv: () => invoke('analytics:exportCsv'),
    alerts: () => invoke('analytics:alerts'),
    dismissAlert: (id) => invoke('analytics:dismissAlert', id),
    dismissNotif: (id: number, kind: 'system' | 'keyword') => invoke('analytics:dismissNotif', id, kind)
  },
  media: {
    list: () => invoke('media:list'),
    stats: () => invoke('media:stats'),
    pickUpload: () => invoke('media:pickUpload'),
    delete: (id) => invoke('media:delete', id),
    updateMeta: (id, alt) => invoke('media:updateMeta', id, alt),
    getFileUrl: (id: number) => invoke('media:getFileUrl', id)
  },
  templates: {
    articleList: () => invoke('templates:article:list'),
    articleCreate: (data) => invoke('templates:article:create', data),
    articleDelete: (id) => invoke('templates:article:delete', id),
    articleApply: (id) => invoke('templates:article:apply', id),
    publishList: () => invoke('templates:publish:list'),
    publishCreate: (name, platforms) => invoke('templates:publish:create', name, platforms),
    publishDelete: (id) => invoke('templates:publish:delete', id)
  },
  social: {
    platforms: () => invoke('social:platforms'),
    connections: () => invoke('social:connections'),
    configuredPlatforms: () => invoke('social:configuredPlatforms'),
    save: (platform, label, config) => invoke('social:save', platform, label, config),
    delete: (id) => invoke('social:delete', id),
    guide: (platform) => invoke('social:guide', platform),
    test: (id: number) => invoke('social:test', id),
    testPlatform: (platform: string) => invoke('social:testPlatform', platform),
    openShare: (url: string, clipboardText?: string) => invoke('social:openShare', url, clipboardText)
  },
  publish: {
    platforms: () => invoke('publish:platforms'),
    one: (articleId, platform, text, link) => invoke('publish:one', articleId, platform, text, link),
    crossPost: (articleId, platforms, text, link) => invoke('publish:crossPost', articleId, platforms, text, link),
  },
  youtube: {
    connectOAuth: () => invoke('youtube:connectOAuth'),
    completeOAuthFromUrl: (callbackUrl: string) => invoke('youtube:completeOAuthFromUrl', callbackUrl),
  },
  twitter: {
    probePublish: () => invoke('twitter:probePublish'),
  },
  users: {
    list: () => invoke('users:list'),
    create: (data) => invoke('users:create', data),
    update: (id, data) => invoke('users:update', id, data),
    delete: (id) => invoke('users:delete', id),
    resetPassword: (id, password) => invoke('users:resetPassword', id, password)
  },
  permissions: {
    list: () => invoke('permissions:list'),
    set: (role, platform, action, allowed) => invoke('permissions:set', role, platform, action, allowed)
  },
  audit: { list: () => invoke('audit:list') },
  system: {
    perf: () => invoke('system:perf'),
    cache: () => invoke('system:cache')
  },
  migration: {
    guessPaths: () => invoke('migration:guessPaths'),
    importLegacy: (path) => invoke('migration:importLegacy', path),
    pickLegacyFile: () => invoke('migration:pickLegacyFile')
  },
  backup: {
    create: () => invoke('backup:create'),
    list: () => invoke('backup:list'),
    restore: (filePath) => invoke('backup:restore', filePath)
  },
  settings: {
    get: (key) => invoke('settings:get', key),
    getAll: () => invoke('settings:getAll'),
    set: (key, value) => invoke('settings:set', key, value)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  stealth: {
    status: () => invoke('stealth:status'),
    testFetch: (url, forceBrowser) => invoke('stealth:testFetch', url, forceBrowser)
  },
  links: {
    scan: (url) => invoke('links:scan', url),
    scanBatch: (urls) => invoke('links:scanBatch', urls),
    sanitize: (url) => invoke('links:sanitize', url),
    extract: (html) => invoke('links:extract', html),
    history: () => invoke('links:history'),
    health: (url: string) => invoke('links:health', url),
    healthLog: () => invoke('links:healthLog')
  },
  domain: {
    intelligence: (host?: string) => invoke('domain:intelligence', host),
    suggestPolicy: (host: string) => invoke('domain:suggestPolicy', host)
  },
  video: {
    tools: () => invoke('video:tools'),
    pickAndLink: () => invoke('video:pickAndLink'),
    pickAndImport: () => invoke('video:pickAndImport'),
    attachToArticle: (articleId: number) => invoke('video:attachToArticle', articleId),
    importPath: (path) => invoke('video:importPath', path),
    probe: (filePath: string) => invoke('video:probe', filePath),
    specs: () => invoke('video:specs'),
    prepareForPlayback: (filePath: string, force?: boolean) => invoke('video:prepareForPlayback', filePath, force),
    mediaToolsStatus: () => invoke('video:mediaToolsStatus'),
    updateMediaTools: () => invoke('video:updateMediaTools'),
    onPrepareProgress: (cb: (data: { pct: number; mode: string }) => void) => {
      ipcRenderer.on('video:prepareProgress', (_e, data) => cb(data));
      return () => ipcRenderer.removeAllListeners('video:prepareProgress');
    },
    transcode: (filePath: string, platform: string) => invoke('video:transcode', filePath, platform),
    transcodeMany: (filePath: string, platforms: string[]) => invoke('video:transcodeMany', filePath, platforms),
    transcodeMedia: (mediaId: number, platforms: string[]) => invoke('video:transcodeMedia', mediaId, platforms),
    onTranscodeProgress: (cb: (data: { pct: number; msg: string; platform: string }) => void) => {
      ipcRenderer.on('video:transcodeProgress', (_e, data) => cb(data));
    },
    offTranscodeProgress: () => ipcRenderer.removeAllListeners('video:transcodeProgress')
  },
  api: {
    status: () => invoke('api:status'),
    start: () => invoke('api:start'),
    stop: () => invoke('api:stop'),
    keysList: () => invoke('api:keysList'),
    keyCreate: (name, scopes) => invoke('api:keyCreate', name, scopes),
    keyRevoke: (id) => invoke('api:keyRevoke', id)
  },
  pin: {
    set: (pin) => invoke('pin:set', pin),
    remove: () => invoke('pin:remove'),
    status: () => invoke('pin:status'),
    login: async (userId, pin) => {
      const res = await invoke<ApiResult<LoginResult>>('pin:login', userId, pin);
      if (res.ok && res.data?.token) await persistToken(res.data.token);
      return res;
    }
  },
  biometric: {
    check: () => invoke('biometric:check'),
    enable: (on) => invoke('biometric:enable', on),
    status: () => invoke('biometric:status'),
    login: async (userId) => {
      const res = await invoke<ApiResult<LoginResult>>('biometric:login', userId);
      if (res.ok && res.data?.token) await persistToken(res.data.token);
      return res;
    }
  },
  tenants: {
    list: () => invoke('tenants:list'),
    create: (name, slug) => invoke('tenants:create', name, slug),
    switch: (id) => invoke('tenants:switch', id),
    current: () => invoke('tenants:current')
  },
  updater: {
    status: () => invoke('updater:status'),
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    install: () => invoke('updater:install')
  },
  translation: {
    text: (text: string, targetLang: string, backend?: string) => invoke('translation:text', text, targetLang, backend),
    article: (articleId: number, targetLang: string, backend?: string, save?: boolean) =>
      invoke('translation:article', articleId, targetLang, backend, save),
    bulk: (ids: number[], targetLang: string, backend?: string) => invoke('translation:bulk', ids, targetLang, backend)
  },
  keywords: {
    list: () => invoke('keywords:list'),
    create: (keyword: string) => invoke('keywords:create', keyword),
    delete: (id: number) => invoke('keywords:delete', id),
    toggle: (id: number, enabled: boolean) => invoke('keywords:toggle', id, enabled),
    matches: (dismissed?: boolean) => invoke('keywords:matches', dismissed),
    dismiss: (id: number) => invoke('keywords:dismiss', id)
  },
  reports: {
    generate: (period: 'weekly' | 'monthly') => invoke('reports:generate', period),
    html: (period: 'weekly' | 'monthly', lang?: string) => invoke('reports:html', period, lang)
  },
  trendRadar: {
    list: (geo?: string) => invoke('trendRadar:list', geo),
    get: (trendId: number) => invoke('trendRadar:get', trendId),
    stats: () => invoke('trendRadar:stats'),
    update: (trendId: number, data: { title?: string; description?: string }) =>
      invoke('trendRadar:update', trendId, data),
    reset: (trendId: number) => invoke('trendRadar:reset', trendId),
    fetch: (geo: string) => invoke('trendRadar:fetch', geo),
    generate: (trendId: number) => invoke('trendRadar:generate', trendId),
    dismiss: (trendId: number) => invoke('trendRadar:dismiss', trendId),
    listSources: () => invoke('trendRadar:listSources'),
    sourceTypeInfo: () => invoke('trendRadar:sourceTypeInfo'),
    addSource: (payload: { name: string; type: string; url: string; region_tag?: string }) => invoke('trendRadar:addSource', payload),
    deleteSource: (id: number) => invoke('trendRadar:deleteSource', id),
    toggleSource: (id: number, enabled: boolean) => invoke('trendRadar:toggleSource', id, enabled),
    fetchSource: (id: number) => invoke('trendRadar:fetchSource', id),
    fetchAll: () => invoke('trendRadar:fetchAll'),
  },
  autopilot: {
    status: () => invoke('autopilot:status'),
    config: () => invoke('autopilot:config'),
    setConfig: (partial: Record<string, unknown>) => invoke('autopilot:setConfig', partial),
    run: () => invoke('autopilot:run'),
    stop: () => invoke('autopilot:stop'),
    runs: (limit?: number) => invoke('autopilot:runs', limit),
  },
  license: {
    status:     () => invoke('license:status'),
    activate:   (serial: string) => invoke('license:activate', serial),
    deactivate: () => invoke('license:deactivate'),
    info:       () => invoke('license:info'),
  },
  studio: {
    createJob: (articleId: number, template?: string) => invoke('studio:createJob', articleId, template),
    generateScript: (articleId: number) => invoke('studio:generateScript', articleId),
    runJob: (jobId: number) => invoke('studio:runJob', jobId),
    jobs: () => invoke('studio:jobs'),
    job: (id: number) => invoke('studio:job', id),
  },
  monitor: {
    list: () => invoke('monitor:list'),
    add: (name: string, feedUrl: string, websiteUrl?: string, sourceType?: string, fbPageUrl?: string, extraConfigJson?: string) => invoke('monitor:add', name, feedUrl, websiteUrl, sourceType, fbPageUrl, extraConfigJson),
    delete: (id: number) => invoke('monitor:delete', id),
    check: (id: number) => invoke('monitor:check', id),
    checkAll: () => invoke('monitor:checkAll'),
    snapshots: (monitorId?: number, limit?: number) => invoke('monitor:snapshots', monitorId, limit),
    markRead: (snapshotId: number) => invoke('monitor:markRead', snapshotId),
    rewrite: (snapshotId: number) => invoke('monitor:rewrite', snapshotId),
    unreadCount: () => invoke('monitor:unreadCount'),
  },
  instagram: {
    login:      () => invoke('instagram:login'),
    loggedIn:   () => invoke('instagram:loggedIn'),
    disconnect: () => invoke('instagram:disconnect'),
    test:       () => invoke('instagram:test'),
  },

  downloader: {
    status:     ()                                   => invoke('downloader:status'),
    update:     ()                                   => invoke('downloader:update'),
    install:    ()                                   => invoke('downloader:install'),
    start:      (url: string, quality: string, jobId: string) => invoke('downloader:start', url, quality, jobId),
    list:       ()                                   => invoke('downloader:list'),
    openFolder: ()                                   => invoke('downloader:openFolder'),
    openFile:   (filePath: string)                   => invoke('downloader:openFile', filePath),
    revealFile: (filePath: string)                   => invoke('downloader:revealFile', filePath),
    copyFile:   (filePath: string)                   => invoke('downloader:copyFile', filePath),
    clear:        ()                                                     => invoke('downloader:clear'),
    mediaUrl:     (filePath: string)                                     => invoke('downloader:mediaUrl', filePath),
    scan:         ()                                                     => invoke('downloader:scan'),
    info:         (url: string)                                          => invoke('downloader:info', url),
    trim:         (inputPath: string, startSec: number, endSec: number) => invoke('downloader:trim', inputPath, startSec, endSec),
    watermark:    (inputPath: string, text: string, position: string)    => invoke('downloader:watermark', inputPath, text, position),
    resize:       (inputPath: string, platform: string)                  => invoke('downloader:resize', inputPath, platform),
    extractAudio: (inputPath: string)                                    => invoke('downloader:extractAudio', inputPath),
    delete:       (filePath: string)                                     => invoke('downloader:delete', filePath),
  },

  tor: {
    status: () => invoke('tor:status'),
    rotate: () => invoke('tor:rotate'),
    toggle: (enabled: boolean) => invoke('tor:toggle', enabled),
  },
  crawler: {
    crawl: (monitorId: number, startUrl: string, opts?: { maxDepth?: number; maxPages?: number }) => invoke('crawler:crawl', monitorId, startUrl, opts),
  },

  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const ALLOWED = new Set([
      'pipeline:progress', 'video:transcodeProgress', 'video:progress',
      'updater:status', 'updater:progress', 'ollama:pullProgress', 'ollama:installProgress',
      'autopilot:progress', 'downloader:progress',
    ]);
    if (!ALLOWED.has(channel)) return () => undefined;
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('eyespro', api);
