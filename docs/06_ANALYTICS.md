# Analytics (Events Only)

No user profiling or PII-based analytics.

## Event Schema

All events include:

- event_name
- timestamp
- user_id (anonymous or account)
- client (web / pwa)

---

## Core Events

- app_installed
- auth_flow_started
- auth_flow_completed
- history_opened
- notification_enabled
- notification_permission_granted
- word_delivered
- word_viewed
- notification_disabled
- account_created
- auth_method_used

## Optional Metadata

- auth*flow*\*: include `method` (email_password, email_code, phone_code, google)

---

## Storage

- Append-only event log
- Queryable later for analysis
