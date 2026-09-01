const ANON_KEY = 'wotd:anon_id';

export function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export function setAnonymousId(id: string): void {
  localStorage.setItem(ANON_KEY, id);
}

export function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Whether this device believes it is signed in, kept alongside the session
 * cookie but in different storage.
 *
 * It exists to tell two sign-outs apart. When the cookie is gone but this flag
 * survives, something took the cookie specifically — a SameSite rule, or an
 * expiry. When both go at once, the browser cleared the whole site, which is
 * what Safari does to a site it considers idle. The server cannot distinguish
 * those on its own: a signed-out request and a stranger's first request look
 * identical to it.
 */
const SESSION_EXPECTATION_KEY = 'wotd:session_expected';

export function setSessionExpectation(expected: boolean): void {
  try {
    if (expected) {
      localStorage.setItem(SESSION_EXPECTATION_KEY, '1');
    } else {
      localStorage.removeItem(SESSION_EXPECTATION_KEY);
    }
  } catch {
    // Private modes refuse to write. The header simply reports `unknown`.
  }
}

export function getSessionExpectation(): 'expected' | 'none' | 'unknown' {
  try {
    return localStorage.getItem(SESSION_EXPECTATION_KEY) ? 'expected' : 'none';
  } catch {
    return 'unknown';
  }
}

/**
 * `standalone` once the app has been added to a home screen. Installed PWAs
 * are the configuration iOS evicts hardest, so the sign-out record says which
 * one it came from.
 */
export function getDisplayMode(): string {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser';
  } catch {
    return 'unknown';
  }
}
