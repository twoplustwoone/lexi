# Tech Stack & Deployment

## Platform

- Cloudflare Workers (API + scheduler)
- Cloudflare D1 (relational data)
- Cloudflare KV (lightweight state)
- Cloudflare Queues (notifications)
- Cloudflare Pages (frontend)

---

## Backend

- Workers for API
- Scheduled Worker for daily delivery
- Durable Objects (optional, future)
- Routing: Hono
- SMS provider: Twilio (default integration)
- Email provider: Resend (passwordless codes)

---

## Frontend

- Preact + Vite (lightweight, static build)
- No SSR
- Static build output
- PWA-first architecture

---

## CI/CD

- GitHub repository
- GitHub Actions:
  - Lint
  - Build
  - Deploy to Cloudflare

Secrets managed via:

- GitHub Secrets
- Cloudflare environment bindings
