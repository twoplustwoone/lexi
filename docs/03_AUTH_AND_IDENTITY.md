# Authentication & Identity

## 1. Anonymous First Model

All users start as anonymous.

- A unique anonymous user ID is generated client-side
- Stored locally
- Used for:
  - Word history
  - Notification schedule
  - Preferences

---

## 2. Account Creation (Optional)

Users may later convert to a full account.

Supported methods:

1. Email + password
2. Email + one-time code
3. Phone number + SMS code
4. Google OAuth

Login accepts email or username identifiers (admin users may use a username).

No 2FA beyond method itself.

---

## 3. Account Linking

When creating an account:

- Anonymous user data is merged
- Word history is preserved
- Preferences are preserved
- Anonymous ID is retired

---

## 4. Password Requirements

- Minimum 10 characters
- Stored as salted hash
- No password reuse enforcement (out of scope)

---

## 5. External Services

- SMS provider (e.g., Twilio)
  - API key
  - Sender number
- OAuth provider (Google)
  - Client ID
  - Client secret
- Email provider (Resend)
  - API key
  - Sender address
