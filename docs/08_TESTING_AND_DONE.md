# Testing & Definition of Done

## Testing

- Unit tests for:
  - Word delivery logic
  - Timezone handling
  - Preference defaults
- Integration tests for:
  - Account conversion
  - Notification scheduling
- E2E smoke tests:
  - App shell loads (Playwright)
- Manual testing:
  - iOS Safari PWA
  - Android Chrome PWA

---

## Definition of Done

A feature is complete when:

- Acceptance criteria are met
- No breaking changes for anonymous users
- Analytics event is emitted
- Offline behavior verified
- Works across timezones
