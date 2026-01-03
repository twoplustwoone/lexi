# PWA & Client Behavior

## 1. PWA Requirements

- Installable on iOS and Android
- Offline access to previously received words
- App shell cached
- Service worker handles:
  - Asset caching
  - Push notifications
  - Background sync (if supported)

---

## 2. Notification Flow

1. User grants notification permission
2. Push subscription stored server-side
3. Daily job triggers notification
4. Notification opens app to today's word

If push is not supported (notably on some iOS Safari PWAs), the app shows an in-app reminder banner when opened.

---

## 3. State Persistence

Client must persist:

- Anonymous user ID
- Notification preferences
- Word history cache

Local storage or IndexedDB acceptable.
