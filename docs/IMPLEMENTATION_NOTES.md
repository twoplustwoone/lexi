# Implementation Notes

## Stack Summary

- Frontend: Preact + Vite + TypeScript, static build for Cloudflare Pages
- Backend: Cloudflare Workers (Hono), scheduled triggers, and queue consumer
- Storage: D1 for relational data, KV for daily word mapping, Queues for push delivery
- PWA: Web manifest, manual service worker for caching, push, and background sync
- Auth: Email+password, email+code (Resend), phone+SMS (Twilio), Google ID token verification
- Analytics: Append-only D1 event log with privacy-safe payloads

## Rationale Highlights

- Matches the /docs requirements: Cloudflare-native, no SSR, offline-first PWA
- Keeps dependencies lightweight while providing strong validation (zod) and TS end-to-end
- Uses KV to lock daily word selection, ensuring immutability per calendar date
- Daily word selection is global (same word for all users on a given date)
