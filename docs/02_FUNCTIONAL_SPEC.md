# Functional Specification

## 1. Lexi Daily Word

Each word includes:

- Word text
- Definition
- Etymology
- One or more usage examples
- Pronunciation guide (text-based IPA or phonetic)

Words are immutable once delivered.

---

## 2. Daily Delivery

- One word per calendar day per user
- Delivered via push notification
- Time is user-configurable
- Timezone-aware
- Delivery happens server-side

If the user opens the app without receiving a notification, the word must still be available.

---

## 3. Notification Settings

- Toggle notifications on/off
- Set preferred delivery time (local timezone)
- Default time: 9:00 AM local
- Changing time applies next day

---

## 4. History

- Users can view all previously received words
- Ordered chronologically
- Read-only
- Works offline for already-received words

---

## 5. Preferences (Future-Proofing)

Preferences are stored as a versioned object.

v1 supports:

- notification_enabled
- delivery_time

Future preferences (word difficulty, language, theme, etc.) must:

- Be optional
- Default safely
- Not invalidate existing users
