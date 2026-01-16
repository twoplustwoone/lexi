# Environment Variables

This project relies on environment variables for secrets and runtime configuration. No secrets should be committed to source control.

## API (Cloudflare Workers)

Set these in Cloudflare (production) and in `apps/api/.dev.vars` (local dev).

Required secrets

- `SESSION_SECRET`: Secret used to hash session tokens.
- `VAPID_PRIVATE_KEY`: Web Push VAPID private key (base64url).

Required config

- `APP_ENV`: `development` or `production`.
- `CORS_ALLOW_ORIGIN`: Comma-separated list of allowed origins.
- `SESSION_TTL_DAYS`: Number of days to keep session tokens.
- `SESSION_COOKIE_SAMESITE`: Cookie SameSite policy (`Lax`, `Strict`, `None`).
- `COOKIE_SECURE`: `true` in production, `false` in local dev.
- `VAPID_SUBJECT`: Contact URI, e.g. `mailto:hello@example.com`.
- `VAPID_PUBLIC_KEY`: Web Push VAPID public key (base64url).

Optional integrations (enable when used)

- `GOOGLE_CLIENT_ID`: Google Sign-In client ID.
- `RESEND_API_KEY`: Resend API key for email codes.
- `RESEND_FROM`: From address for email codes.
- `TWILIO_ACCOUNT_SID`: Twilio account SID.
- `TWILIO_AUTH_TOKEN`: Twilio auth token.
- `TWILIO_FROM`: Twilio phone number in E.164.

Admin seeding (optional)

- `ADMIN_USERNAME`: Admin username for seed script.
- `ADMIN_PASSWORD`: Admin password for seed script.
- `ADMIN_FORCE_SEED`: Set to a truthy value to recreate/update the admin account during seeding.

Local dev file

- `apps/api/.dev.vars` should contain the above values.
- `apps/api/.dev.vars.example` is the template (do not commit real secrets).

## Web (Vite + PWA)

Set these in `apps/web/.env` (local) and Cloudflare Pages env vars (production).

Optional

- `VITE_API_BASE_URL`: Base URL for the API. Leave unset for local dev (Vite proxies `/api` to the local worker). If you point to a different origin, auth cookies require `SameSite=None` and HTTPS.

- `VITE_GOOGLE_CLIENT_ID`: Google Sign-In client ID (frontend).

## CI/CD (GitHub Actions)

Secrets required for deploy workflows:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME`

Optional deploy-time admin seed:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_FORCE_SEED`
