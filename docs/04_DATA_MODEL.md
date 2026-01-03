# Data Model

## 1. User

Fields:

- id
- created_at
- is_anonymous
- is_admin
- username (nullable)
- auth_methods[]
- preferences (versioned JSON)
- timezone

---

## 2. Word

Fields:

- id
- word
- definition
- etymology
- pronunciation
- examples[]
- created_at

---

## 3. UserWord

Tracks delivery, not just viewing.

Fields:

- user_id
- word_id
- delivered_at
- viewed_at (nullable)

---

## 4. NotificationSchedule

Fields:

- user_id
- delivery_time (HH:mm)
- timezone
- enabled
