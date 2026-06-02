# EyesPro

**Copyright © 2025–2026 Abdallahjk. All rights reserved.**

Full migration of Eyes Pro 10.x into a clean Electron + TypeScript + React architecture.

## Features

- Auth: sessions, rate limiting, 2FA (TOTP), password change, RBAC (4 roles)
- **16 app areas**: dashboard, articles, pipeline, sources, media, templates, publish, social, scheduler, calendar, analytics, quality, AI batch, users, system, settings
- RSS ingestion, URL ingest, article search, bulk delete
- Publish: Telegram, WhatsApp, Discord, WordPress, Twitter/X, Facebook, LinkedIn, Instagram, email, push
- Content pipeline (sanitize → rewrite → TLDR → SEO → ready)
- AI via Gemini or Ollama
- Editorial quality workflow
- Encrypted backups + restore
- Legacy DB import from Babylon/Eyes Pro
- Arabic/English UI with RTL/LTR
- Windows NSIS + Portable installers

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
npm run build:win
```

## License

Proprietary — Abdallahjk. See [LICENSE](LICENSE).
