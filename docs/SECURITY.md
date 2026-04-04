# Security Hardening

This document captures recommended Cloudflare edge rules to complement the app-level protections.

## Cloudflare Rate Limiting Rules

Suggested starting thresholds (per IP):

- `/api/auth/email/code/request`: 10 requests per minute (block or managed challenge).
- `/api/auth/email/code/verify`: 20 requests per minute.
- `/api/auth/login`: 30 requests per minute.
- `/api/auth/methods`: 30 requests per minute.
- `/api/auth/signup`: 30 requests per minute.
- `/api/notifications/subscribe`: 120 requests per minute.
- `/api/events`: 120 requests per minute.

## Optional WAF/Zero Trust

- Block non-`POST` requests to `/api/auth/*`.
- Enable Bot Fight Mode (log or managed challenge).
- Apply Cloudflare Access policies to `/api/admin/*` if you have a Zero Trust setup.
