# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lexi is a Word-of-the-Day PWA that delivers daily vocabulary words via push notifications. Users can use the app without accounts (anonymous mode) and optionally create accounts later while preserving their history.

## Commands

### Development
```bash
npm run dev              # Start both API (8787) and web (5173) servers
npm run build            # Build both API and web
npm run lint             # Lint all packages
npm run lint:fix         # Fix lint issues across all packages
npm run typecheck        # Type check all packages
npm run test             # Run tests for all packages
npm run validate         # Run lint + typecheck + test
```

### Database
```bash
npm run db:migrate --prefix apps/api           # Apply D1 migrations locally
npm run seed:words                              # Seed words to database
npm run seed:admin                              # Create admin user (uses ADMIN_USERNAME/ADMIN_PASSWORD from .dev.vars)
npm run generate:vapid                          # Generate VAPID keys for push notifications
```

### Individual Package Commands
```bash
npm run dev --prefix apps/api      # API only (wrangler dev)
npm run dev --prefix apps/web      # Web only (vite)
npm run test --prefix apps/api     # API tests only (vitest)
npm run test --prefix apps/web     # Web tests only (vitest)
npm run test:e2e --prefix apps/web # E2E tests (playwright)
```

## Architecture

### Monorepo Structure
- `apps/api` - Cloudflare Worker API using Hono framework
- `apps/web` - Preact + Vite PWA with Tailwind CSS
- `packages/shared` - Shared Zod schemas, types, and utilities (Luxon for time handling)

### Backend (apps/api)
- **Framework**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) with migrations in `apps/api/migrations/`
- **Storage**: Cloudflare KV for lightweight state (cron tracking)
- **Auth**: Session-based with multiple methods (email/password, email code, Google OAuth)
- **Notifications**: Web Push using VAPID keys, scheduled via cron (`*/30 * * * *`)

Key modules:
- `src/index.ts` - All API routes and cron handler
- `src/auth/` - Authentication (sessions, OTP, Google, identity merging)
- `src/notifications/` - Push notifications (VAPID, scheduler, logger)
- `src/db.ts` - Database queries for users, schedules, words
- `src/words.ts` - Word delivery logic

### Frontend (apps/web)
- **Framework**: Preact with preact-router
- **Styling**: Tailwind CSS v4
- **Storage**: IndexedDB via `idb` package for offline support
- **Service Worker**: PWA support for push notifications

Key modules:
- `src/App.tsx` - Main routing and user state management
- `src/screens/` - Page components (Home, History, Settings, Account)
- `src/api.ts` - API client with anonymous identity handling
- `src/identity.ts` - Local anonymous ID management

### Data Flow
1. Anonymous users get a UUID stored in IndexedDB
2. API identifies users via session cookie (authenticated) or `X-Anon-Id` header (anonymous)
3. Words are delivered per-user based on their timezone and delivery schedule
4. When anonymous users create accounts, their history is merged via `mergeAnonymousIntoUser`

### Environment Configuration
- API secrets: `apps/api/.dev.vars` (VAPID keys, Resend, Twilio, Google OAuth)
- Web env: `apps/web/.env` (VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID)
- Wrangler config: `apps/api/wrangler.toml` (D1/KV bindings, cron schedule)
