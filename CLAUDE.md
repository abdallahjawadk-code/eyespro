# EyesPro — Architecture Guide

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 29 (main + renderer, electron-vite) |
| UI | React 19, Zustand (client state), React Query (server state) |
| Database | better-sqlite3 — WAL mode, at-rest encryption via DPAPI (`db/at-rest.ts`) |
| Auth | Argon2id passwords, TOTP 2FA, session tokens in-process, safeStorage persistence |
| Build | electron-builder, code-signing via WIN_CSC_LINK or Azure Trusted Signing |
| Tests | Vitest (117 tests, all in `test/`) |

## Process model

```
Main process (Node.js)
├── src/main/index.ts          entry point, BrowserWindow setup
├── src/main/window.ts         CSP headers, security policy
├── src/main/ipc/guard.ts      IPC firewall — RBAC + rate limiting + frame check
├── src/main/ipc/register-handlers.ts   all ipcMain.handle() registrations
└── src/main/ipc/register-advanced.ts

Preload (isolated context)
└── src/preload/index.ts       contextBridge — maps renderer calls → IPC

Renderer (React)
└── src/renderer/              React app, no Node.js access
```

## IPC security model

Every channel goes through `src/main/ipc/guard.ts`:

1. **Frame check** — rejects calls from untrusted web frames
2. **Rate limiting** — `authRateLimiter` (tight) / `defaultRateLimiter` (loose)
3. **RBAC** — `CHANNEL_PERMS` maps each channel to a required permission level

Permission levels (lowest → highest): `auth → read → contribute → write → admin`

Role caps:
- `super_admin` → admin
- `editor` → write
- `reporter` → contribute
- `viewer` → read

Channels in `PUBLIC` set bypass auth (login, health-check).

## Database

Schema lives entirely in `src/main/db/migrations.ts` (v1–v48). Migrations run at startup via `runMigrations(db)`. The current version is v48. Add columns idempotently with the `ensureCol(db, table, col, ddl)` helper inside a new `migrateTo(db, N, …)` block.

```
src/main/db/
├── database.ts        getDb() singleton, opens encrypted DB
├── migrations.ts      all schema migrations
├── at-rest.ts         DPAPI encryption wrapper
└── paths.ts           userData paths
```

**Test databases**: `test/helpers/test-db.ts` creates a fresh in-memory DB with all migrations for each test.

## Authentication

```
src/main/auth/
├── auth-service.ts        login / logout / register
├── session-store.ts       in-process token map + safeStorage persistence
├── login-rate-limit.ts    SQLite-backed per-username rate limit (8 failures / 15 min)
├── biometric-windows.ts   Windows Hello
├── totp-service.ts        TOTP enroll / verify
├── pin-auth.ts            PIN fallback
└── quick-login.ts         remember-me token
```

Session tokens are stored in a `Map<WebContents, string>` (main process only). On startup the last token is loaded from `safeStorage` (Windows DPAPI) for auto-login — not localStorage.

## Publishing pipeline

### Text articles — `src/main/services/publish.ts`
Dispatches to per-platform handlers. Supports cross-publishing (publish to multiple platforms in parallel).

### Video — `src/main/services/publish-video.ts` (orchestrator)
Delegates to `src/main/services/video-adapters/`:

```
video-adapters/
├── types.ts        shared types, helpers (cred, trunc, fail, fromGraph, …)
├── oauth1.ts       OAuth 1.0a signer, Twitter thread builder
├── youtube.ts      resumable upload, Data API v3
├── facebook.ts     Graph API, multipart local upload
├── instagram.ts    Reels container publish (Graph API)
├── tiktok.ts       Direct Post via URL / FILE_UPLOAD
├── twitter.ts      chunked media upload + tweet
├── linkedin.ts     Posts API 2024, initialize → PUT → finalize
├── telegram.ts     sendVideo (URL or binary multipart)
├── wordpress.ts    media REST upload + post
├── whatsapp.ts     Cloud API video/text message
├── discord.ts      webhook embed
└── push.ts         OneSignal push notification
```

### Social connection credentials
`getSocialCred(platform, field)` reads from `social_connections` table first, then falls back to `settings` table key `${platform}_${field}`.

## Content ingestion

```
src/main/services/
├── fetch-pipeline.ts     main fetch loop
├── ingest.ts             parse + store articles
├── dedup.ts              SimHash near-duplicate detection (32-bit FNV-1a)
├── trend-radar.ts        trending topic fetcher
├── trend-sources.ts      configurable trend source registry
└── source-search/        feed discovery engine
```

**Dedup**: `findNearDuplicates(title, summary, threshold)` loads stored SimHashes from the DB and does an in-memory Hamming distance scan. Threshold default is 4 bits (≈ 87.5% similarity).

## Security layers

| Layer | File |
|-------|------|
| IPC firewall | `ipc/guard.ts` |
| CSP headers | `window.ts` — `webRequest.onHeadersReceived` |
| Input sanitize | `security/sanitize.ts` — `sanitizeString`, `sanitizeUsername`, `sanitizeInt` |
| HTML sanitize | `security/html-sanitize.ts` |
| URL policy | `security/url-policy.ts` |
| Fetch guard | `security/fetch-guard.ts` |
| Secrets vault | `security/secrets-vault.ts` |
| At-rest encryption | `db/at-rest.ts` — DPAPI |
| Timing-safe compare | `security/password.ts` — `crypto.timingSafeEqual` for legacy PBKDF2 |
| Error monitoring | `monitoring/sentry.ts` — opt-in via `SENTRY_DSN` env var |

## Testing

```bash
npm test            # vitest run (all 117 tests)
npm run test:watch  # watch mode
npm run test:coverage
npm run bench       # performance benchmarks (vitest bench)
```

Test layout:
```
test/
├── helpers/test-db.ts          in-memory SQLite helper (mocks electron + getDb)
├── integration/
│   ├── session-db.test.ts      session lifecycle
│   ├── rate-limit-db.test.ts   login rate limiting
│   └── dedup-db.test.ts        SimHash + near-duplicate detection
├── perf/
│   └── dedup.bench.ts          SimHash / hammingDistance / sanitize benchmarks
├── e2e/
│   ├── helpers/electron.ts     Playwright Electron launcher (asserts build exists)
│   ├── welcome.e2e.ts          welcome screen smoke tests
│   ├── app-shell.e2e.ts        sidebar / Ctrl+K / header tests
│   ├── error-boundary.e2e.ts   crash recovery UI
│   └── a11y.e2e.ts             axe-core WCAG 2.1 AA audit (critical/serious fail CI)
├── sanitize.test.ts
├── ipc-guard-logic.test.ts
├── login-rate-limit.test.ts
└── ...
```

**LSH optimisation** (`dedup.ts`): migration v34 adds `simhash_b0..b3` columns (8-bit bands + indexes). `findNearDuplicates` pre-filters with an indexed OR query before the full Hamming scan. Fallback to full scan for legacy rows.

## Error monitoring (Sentry)

`src/main/monitoring/sentry.ts` wraps `@sentry/electron/main`. Activated only when `SENTRY_DSN` is set. Disabled automatically in test mode (`NODE_ENV=test` or `EYESPRO_TEST_MODE=1`). Strips AppData paths from stack frames before sending.

```
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production     # optional, defaults to NODE_ENV
SENTRY_RELEASE=eyespro@1.2.3      # optional, defaults to app.getVersion()
```

## Build & code signing

```bash
npm run build:win   # electron-builder Windows
```

Code signing env vars (see `.env.example`):
- `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` — local PFX certificate
- Azure Trusted Signing: `AZURE_KEY_VAULT_URI`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_CERTIFICATE_NAME`
