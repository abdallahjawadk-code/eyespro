import { app, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { getSessionFromEvent } from '../auth/session-store';
import type { Role } from '../../shared/api-types';
import { defaultRateLimiter, authRateLimiter } from './rate-limiter';

type Perm = 'auth' | 'read' | 'contribute' | 'write' | 'admin';

const CHANNEL_PERMS: Record<string, Perm> = {
  'auth:login': 'auth',
  'auth:logout': 'auth',
  'auth:session': 'auth',
  'auth:changePassword': 'write',
  'auth:setup2fa': 'write',
  'auth:enable2fa': 'write',
  'auth:disable2fa': 'write',
  'auth:status2fa': 'read',
  'auth:requestPasswordReset': 'auth',
  'auth:confirmPasswordReset': 'auth',
  'auth:quickLoginUsers': 'auth',
  'dashboard:stats': 'read',
  'articles:list': 'read',
  'articles:search': 'read',
  'articles:categories': 'read',
  'articles:get': 'read',
  'articles:create': 'contribute',
  'articles:update': 'contribute',
  'articles:delete': 'write',
  'articles:bulkDelete': 'write',
  'articles:deleteAll':  'admin',
  'articles:ingest': 'contribute',
  'articles:checkDuplicate': 'read',
  'articles:count': 'read',
  'articles:saveDocxFile': 'contribute',
  'sources:list': 'read',
  'sources:get': 'read',
  'sources:create': 'write',
  'sources:update': 'write',
  'sources:delete': 'write',
  'sources:toggle': 'write',
  'sources:fetch': 'write',
  'sources:fetchAll': 'write',
  'publish:platforms': 'read',
  'publish:crossPost': 'write',
  'publish:one': 'write',
  'publish:logs': 'read',
  'publish:calendar': 'read',
  'tasks:list': 'read',
  'tasks:create': 'write',
  'tasks:update': 'write',
  'tasks:delete': 'write',
  'tasks:run': 'write',
  'pipeline:kanban': 'read',
  'pipeline:log': 'read',
  'pipeline:runStep': 'write',
  'pipeline:runFull': 'write',
  'pipeline:runBulk': 'write',
  'pipeline:runArticles': 'write',
  'pipeline:config': 'read',
  'pipeline:jobs': 'read',
  'pipeline:cancelJob': 'write',
  'pipeline:aiStatus': 'read',
  'pipeline:retryFailed': 'write',
  'pipeline:dismissFailed': 'write',
  'pipeline:previewArticles': 'read',
  'pipeline:previewAuto': 'read',
  'pipeline:articleDetail': 'read',
  'pipeline:setProfile': 'write',
  'pipeline:setProfiles': 'write',
  'pipeline:session': 'read',
  'pipeline:setSessionDisableAi': 'write',
  'pipeline:cancelAllPending': 'write',
  'pipeline:queueStats': 'read',
  'pipeline:retryJob': 'write',
  'ai:modes': 'read',
  'ai:status': 'read',
  'ai:listModels': 'read',
  'ai:setModel': 'write',
  'ai:run': 'contribute',
  'ai:generate': 'write',
  'ai:generateVariants': 'write',
  'ai:jobs': 'read',
  'ai:createBatch': 'write',
  'ai:processJobs': 'admin',
  'ai:chat': 'read',
  'ai:testProvider': 'write',
  'ollama:status': 'read',
  'ollama:recommended': 'read',
  'ollama:localModels': 'read',
  'ollama:setEnabled': 'write',
  'ollama:start': 'write',
  'ollama:stop': 'write',
  'ollama:openDownload': 'read',
  'ollama:installWinget': 'write',
  'ollama:pull': 'write',
  'ollama:deleteModel': 'write',
  'quality:queue': 'read',
  'quality:submit': 'contribute',
  'quality:approve': 'write',
  'quality:reject': 'write',
  'quality:check': 'contribute',
  'quality:reports': 'read',
  'quality:stats': 'read',
  'analytics:dashboard': 'read',
  'analytics:exportCsv': 'read',
  'analytics:alerts': 'read',
  'analytics:dismissAlert': 'write',
  'media:list': 'read',
  'media:stats': 'read',
  'media:pickUpload': 'contribute',
  'media:delete': 'write',
  'media:updateMeta': 'contribute',
  'templates:article:list': 'read',
  'templates:article:create': 'write',
  'templates:article:delete': 'write',
  'templates:article:apply': 'write',
  'templates:publish:list': 'read',
  'templates:publish:create': 'write',
  'templates:publish:delete': 'write',
  'social:platforms': 'read',
  'social:connections': 'read',
  'social:configuredPlatforms': 'read',
  'social:save': 'write',
  'social:delete': 'write',
  'social:guide': 'read',
  'social:test': 'write',
  'social:testPlatform': 'write',
  'youtube:connectOAuth': 'write',
  'youtube:completeOAuthFromUrl': 'write',
  'twitter:probePublish': 'write',
  'users:list': 'read',
  'users:create': 'admin',
  'users:update': 'admin',
  'users:delete': 'admin',
  'users:resetPassword': 'admin',
  'audit:list': 'admin',
  'system:perf': 'read',
  'system:cache': 'read',
  'migration:guessPaths': 'read',
  'migration:importLegacy': 'admin',
  'migration:pickLegacyFile': 'admin',
  'backup:create': 'admin',
  'backup:list': 'read',
  'backup:restore': 'admin',
  'settings:get': 'read',
  'settings:set': 'write',
  'settings:getAll': 'read',
  'stealth:status': 'read',
  'stealth:testFetch': 'write',
  'links:scan': 'read',
  'links:scanBatch': 'write',
  'links:sanitize': 'read',
  'links:extract': 'read',
  'links:history': 'read',
  'links:health': 'read',
  'links:healthLog': 'read',
  'fetch:shieldOverview': 'read',
  'fetch:qualityTiers': 'read',
  'domain:suggestPolicy': 'read',
  'sources:lowTrust': 'read',
  'domain:intelligence': 'read',
  'video:tools': 'read',
  'video:pickAndImport': 'write',
  'video:importPath': 'write',
  'video:transcode': 'write',
  'video:transcodeMedia': 'write',
  'video:transcodeMany': 'write',
  'api:status': 'read',
  'api:start': 'admin',
  'api:stop': 'admin',
  'api:keysList': 'admin',
  'api:keyCreate': 'admin',
  'api:keyRevoke': 'admin',
  'pin:set': 'write',
  'pin:remove': 'write',
  'pin:status': 'read',
  'tenants:list': 'read',
  'tenants:create': 'admin',
  'tenants:switch': 'admin',
  'tenants:current': 'read',
  'updater:status': 'read',
  'updater:check': 'admin',
  'updater:download': 'admin',
  'updater:install': 'admin',
  'biometric:enable': 'write',
  'biometric:status': 'read',
  'biometric:check': 'read',
  'translation:text': 'contribute',
  'translation:article': 'contribute',
  'translation:bulk': 'write',
  'license:status': 'auth',
  'license:activate': 'auth',
  'license:deactivate': 'auth',
  'license:info': 'auth',
  // Studio — Video Factory
  'studio:createJob': 'write',
  'studio:generateScript': 'write',
  'studio:runJob': 'write',
  'studio:jobs': 'read',
  'studio:job': 'read',
  // Broadcast — WhatsApp
  // Competitor Monitor
  'monitor:list': 'read',
  'monitor:add': 'write',
  'monitor:delete': 'write',
  'monitor:check': 'write',
  'monitor:checkAll': 'write',
  'monitor:snapshots': 'read',
  'monitor:markRead': 'write',
  'monitor:rewrite': 'write',
  'monitor:unreadCount': 'read',
  // Instagram auth
  'instagram:login':      'write',
  'instagram:loggedIn':   'read',
  'instagram:disconnect': 'write',
  'instagram:test':       'read',
  'social:openShare': 'read',
  'autopilot:status': 'read',
  'autopilot:config': 'read',
  'autopilot:setConfig': 'write',
  'autopilot:run': 'write',
  'autopilot:stop': 'write',
  'autopilot:runs': 'read',
  'trendRadar:list': 'read',
  'trendRadar:get': 'read',
  'trendRadar:stats': 'read',
  'trendRadar:update': 'write',
  'trendRadar:reset': 'write',
  'trendRadar:fetch': 'write',
  'trendRadar:generate': 'write',
  'trendRadar:dismiss': 'write',
  'trendRadar:listSources': 'read',
  'trendRadar:sourceTypeInfo': 'read',
  'trendRadar:addSource': 'write',
  'trendRadar:deleteSource': 'write',
  'trendRadar:toggleSource': 'write',
  'trendRadar:fetchSource': 'write',
  'trendRadar:fetchAll': 'write',

  // ── Channels that previously had no permission entry ─────────────────────
  // The IPC guard treats a channel with no entry (and not in PUBLIC) as
  // UNKNOWN_CHANNEL. These are declared so that, once installIpcGuard is wired
  // up, every preload channel resolves to an explicit access level instead of
  // being rejected. Kept in sync by test/ipc-contract.test.ts.
  'analytics:publishLogs': 'read',
  'analytics:dismissNotif': 'contribute',
  'articles:pageInit': 'read',
  'articles:downloadDocx': 'read',
  'fetch:audit': 'read',
  'media:getFileUrl': 'read',
  'reports:html': 'read',
  'reports:generate': 'read',
  'keywords:list': 'read',
  'keywords:matches': 'read',
  'keywords:create': 'write',
  'keywords:delete': 'write',
  'keywords:toggle': 'write',
  'keywords:dismiss': 'contribute',
  'domainPolicies:list': 'read',
  'domainPolicies:upsert': 'write',
  'domainPolicies:delete': 'write',
  'opml:preview': 'read',
  'opml:import': 'write',
  'opml:importFile': 'write',
  'opml:importUrl': 'write',
  'permissions:list': 'admin',
  'permissions:set': 'admin',
  'video:probe': 'read',
  'video:specs': 'read',
  'video:prepareForPlayback': 'read',
  'video:mediaToolsStatus': 'read',
  'video:updateMediaTools': 'write',
  'video:attachToArticle': 'write',
  'video:pickAndLink': 'write',
  'sources:health': 'read',
  'sources:healthAll': 'read',
  'sources:detect': 'read',
  'sources:discover': 'read',
  'sources:browseCatalog': 'read',
  'sources:listCatalogs': 'read',
  'sources:listSectors': 'read',
  'sources:previewFeed': 'read',
  'sources:previewFetch': 'read',
  'sources:providerStats': 'read',
  'sources:searchFeeds': 'read',
  'sources:searchAdvanced': 'read',
  'sources:similarFeeds': 'read',
  'sources:suggestCatalog': 'read',
  'sources:bulkDiscover': 'write',
  'sources:clearDiscoveryCache': 'write',
  'downloader:status': 'read',
  'downloader:list': 'read',
  'downloader:info': 'read',
  'downloader:scan': 'read',
  'downloader:mediaUrl': 'read',
  'downloader:openFile': 'read',
  'downloader:openFolder': 'read',
  'downloader:revealFile': 'read',
  'downloader:start': 'write',
  'downloader:install': 'write',
  'downloader:update': 'write',
  'downloader:delete': 'write',
  'downloader:clear': 'write',
  'downloader:extractAudio': 'write',
  'downloader:trim': 'write',
  'downloader:resize': 'write',
  'downloader:watermark': 'write',
};

const PUBLIC = new Set([
  'auth:login',
  'auth:session',
  'auth:requestPasswordReset',
  'auth:confirmPasswordReset',
  'auth:quickLoginUsers',
  'pin:login',
  'biometric:login',
  'biometric:check',
  'license:status',
  'license:activate',
  'license:deactivate',
  'license:info'
]);

const PERM_LEVEL: Record<Perm, number> = {
  auth: 0, read: 1, contribute: 2, write: 3, admin: 4
};

const ROLE_MAX_PERM: Record<Role, Perm> = {
  super_admin: 'admin',
  editor: 'write',
  reporter: 'contribute',
  viewer: 'read'
};

function can(role: Role, required: Perm): boolean {
  const maxPerm = ROLE_MAX_PERM[role];
  if (!maxPerm) return false;
  return PERM_LEVEL[maxPerm] >= PERM_LEVEL[required];
}

function permFor(channel: string): Perm | null {
  return CHANNEL_PERMS[channel] ?? null;
}

// Rate limit configuration per channel type
const AUTH_CHANNELS = new Set([
  'auth:login',
  'auth:logout',
  'pin:login',
  'biometric:login',
  'auth:requestPasswordReset',
  'auth:confirmPasswordReset'
]);

// PUBLIC channels that need strict rate-limiting (e.g. license brute-force)
const STRICT_PUBLIC_CHANNELS = new Set([
  'license:activate',
  'license:deactivate',
]);

export function installIpcGuard(ipcMain: IpcMain): void {
  const original = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    return original(channel, async (event, ...args) => {
      // Validate sender frame origin
      const frame = event.senderFrame;
      if (!frame) {
        return { ok: false, error: 'Access denied: frame unavailable', code: 'FORBIDDEN' };
      }

      // Verify that the frame is the main frame (not an unauthorized subframe/iframe)
      if (frame.parent !== null) {
        return { ok: false, error: 'Access denied: unauthorized frame parent', code: 'FORBIDDEN' };
      }

      const url = frame.url;
      // NOTE: NODE_ENV is unset in a packaged build (see app-guard.ts / database.ts),
      // so `NODE_ENV !== 'production'` is always true in the shipped app. Keying dev
      // detection off NODE_ENV therefore left the dev origin allowlist (localhost/
      // 127.0.0.1) active in production. Rely solely on app.isPackaged instead, so the
      // shipped build enforces a strict file:// origin policy.
      const isDev = !app.isPackaged;
      const isValidOrigin = isDev
        ? (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:') || url.startsWith('file://'))
        : url.startsWith('file://');

      if (!isValidOrigin) {
        return { ok: false, error: 'Access denied: invalid origin', code: 'FORBIDDEN' };
      }

      if (PUBLIC.has(channel)) {
        // Apply rate-limiting even for public channels to prevent brute-force
        const publicKey = `public:${event.sender.id}`;
        const pubLimiter = STRICT_PUBLIC_CHANNELS.has(channel) ? authRateLimiter : defaultRateLimiter;
        const pubRate = pubLimiter.check(publicKey);
        if (!pubRate.allowed) {
          return {
            ok: false,
            error: 'Rate limit exceeded. Please try again later.',
            code: 'RATE_LIMIT',
            retryAfter: Math.ceil((pubRate.resetTime - Date.now()) / 1000)
          };
        }
        return listener(event, ...args);
      }

      // Rate limiting check
      const session = getSessionFromEvent(event);
      const rateLimitKey = session?.id?.toString() || event.sender.id.toString() || 'anonymous';

      // Use stricter rate limiting for auth endpoints
      const limiter = AUTH_CHANNELS.has(channel) ? authRateLimiter : defaultRateLimiter;
      const rateCheck = limiter.check(rateLimitKey);

      if (!rateCheck.allowed) {
        return {
          ok: false,
          error: 'Rate limit exceeded. Please try again later.',
          code: 'RATE_LIMIT',
          retryAfter: Math.ceil((rateCheck.resetTime - Date.now()) / 1000)
        };
      }

      const perm = permFor(channel);
      if (!perm) {
        return { ok: false, error: 'Unknown channel', code: 'UNKNOWN_CHANNEL' };
      }

      if (!session) {
        return { ok: false, error: 'Authentication required', code: 'UNAUTH' };
      }

      if (!can(session.role, perm)) {
        return { ok: false, error: 'Insufficient permissions', code: 'FORBIDDEN' };
      }

      return listener(event, ...args);
    });
  };
}
