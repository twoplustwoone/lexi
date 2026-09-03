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
 * It exists so that a device which lost a session is not mistaken for one that
 * never had one — on the wire those are the same request, and without this the
 * server would count every first-time reader as an unwanted sign-out.
 *
 * It cannot report eviction. This flag lives in localStorage, so a browser
 * clearing the site's storage takes it along with the cookie, and the request
 * that follows is a stranger's in every respect. Its absence is never evidence
 * of anything; only its presence carries information.
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
