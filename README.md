# Lexi PWA

A privacy-respecting, installable Lexi PWA that delivers a daily word with definition, etymology, examples, and pronunciation via push notifications.

The app works without accounts by default, supports optional account creation later, and is designed to scale feature complexity over time without breaking existing users.

---

## Core Principles

- No account required to start
- PWA installable on iOS & Android
- Cloudflare-native architecture
- Simple, durable tech choices
- Future-proofed preferences system
- Event-based analytics only

---

## Local Development

### Prerequisites

- Node.js 20+
- Cloudflare Wrangler (`npm install -g wrangler`)

### Setup

1. Install dependencies: `npm run install:all`
2. Copy environment templates:
   - `cp apps/api/.dev.vars.example apps/api/.dev.vars`
   - `cp apps/web/.env.example apps/web/.env`
3. Review required environment variables in `docs/ENVIRONMENT.md`
4. Generate VAPID keys: `npm run generate:vapid`
5. Create and configure D1:
   - `wrangler d1 create word_of_the_day`
   - Update `apps/api/wrangler.toml` with the D1 and KV IDs
6. Apply migrations (includes seeded words): `npm run db:migrate --prefix apps/api`
7. (Optional) Seed words + admin: `npm run seed:words`

### Run

`npm run dev`

This starts:

- API on `http://localhost:8787`
- Web on `http://localhost:5173`
- The local network URL for testing on a phone (printed on startup)

---

## Admin User (Optional)

Local dev admin seeding uses `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `apps/api/.dev.vars`:

- `npm run seed:admin` (local)
- `npm run seed:admin -- --remote` (remote, used in deploy workflow)

If the admin user already exists, the seed script skips creation unless `ADMIN_FORCE_SEED` is set to a truthy value to recreate/update the admin credentials.

Admin accounts see a "Send test notification" button in the Account screen.
Admin logins accept the username you seeded (or the email address for standard accounts).

---

## Testing

- Unit + integration tests: `npm run test`
- E2E smoke tests: `npx playwright install && npm run test:e2e --prefix apps/web`

---

## Deployment

### Cloudflare Workers (API)

1. Ensure `apps/api/wrangler.toml` IDs are set.
2. Set secrets in Cloudflare:
   - `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   - `RESEND_API_KEY`, `RESEND_FROM`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
   - `GOOGLE_CLIENT_ID`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` (optional)
3. Deploy:
   - `wrangler deploy --cwd apps/api`

Admin seeding runs during CI/CD deploys if `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set. Add `ADMIN_FORCE_SEED=true` in GitHub secrets to force a recreate/update.

### Cloudflare Pages (Web)

1. Set `VITE_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID` in Pages environment variables.
2. Build and deploy:
   - `npm run build --prefix apps/web`
   - `wrangler pages deploy apps/web/dist --project-name <your-pages-project>`

---

## Notifications & iOS Notes

iOS Safari PWAs do not always guarantee exact push scheduling. The app falls back to showing an in-app reminder banner when the app is opened, while still using Web Push on supported devices.
