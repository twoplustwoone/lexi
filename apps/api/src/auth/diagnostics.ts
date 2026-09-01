import { Env } from '../env';
import { logInfo, logWarn } from '../notifications/logger';
import { SessionLookup, parseCookies } from './sessions';

/**
 * Why a device that was signed in stops being signed in.
 *
 * The symptom this exists for — "I have to log in again every couple of days"
 * — only reproduces on a phone, where there is no way to inspect a cookie
 * jar. So the server records what the browser presented on each request and
 * what became of the session it named, and the admin screen reads it back.
 *
 * What each cause leaves behind, and what it does not:
 *
 *   1. The cookie is never sent. `SameSite=Lax` withholds it whenever the API
 *      is on a different site than the app, so `secFetchSite: 'cross-site'`
 *      with no session cookie names this outright.
 *   2. The session genuinely expired. The row outlives it by the evidence
 *      window and the cookie outlives the row, so the expired row can still be
 *      found and can say how many days it actually lived.
 *   3. The browser threw the site's storage away (Safari/iOS does this to
 *      sites it considers idle). This one is NOT observable on the request it
 *      happens to: eviction takes the cookie and the app's own localStorage
 *      flag together, leaving a device that is byte-for-byte a first-time
 *      visitor. Nothing here can honestly claim to have caught it. What it
 *      leaves instead is a trace across requests — a session that stops being
 *      presented long before it expires, with no sign-out recorded — and that
 *      is read off the accumulated records in the admin screen, not from here.
 *
 * Every outcome below is therefore something actually witnessed. A device that
 * has not told us it was signed in is never counted as having been signed out;
 * otherwise every first-time reader becomes an incident, and on a cross-site
 * deployment they would be the overwhelming majority of them.
 */

/**
 * What arrived with a request. Cookie *names* only — the session token is a
 * live credential, and this table is rendered in the admin screen.
 */
export interface RequestFingerprint {
  cookieNames: string[];
  /** False means an empty jar, which is the shape storage eviction leaves. */
  hadCookies: boolean;
  /**
   * `same-origin` | `same-site` | `cross-site` | `none`. The decisive header
   * for cause 1: browsers set it themselves, so it reports how the browser
   * classified the request rather than how we hoped it would.
   */
  secFetchSite: string | null;
  originHost: string | null;
  hasAnonHeader: boolean;
  /**
   * What the app believed before it asked. `expected` means this device
   * completed a sign-in and never logged out, so an unauthenticated answer is
   * a real regression rather than a stranger's first visit — which is the only
   * thing separating the two, since they are identical on the wire.
   *
   * Note what this cannot do: the flag lives in localStorage, so anything that
   * clears the cookie by clearing the whole site clears this too, and the
   * request then reads as a stranger's. Absence is never evidence of eviction.
   */
  clientExpectation: 'expected' | 'none' | 'unknown';
  /** `standalone` for an installed PWA — the configuration iOS evicts hardest. */
  clientDisplay: string | null;
  platform: string;
}

export type SessionOutcome =
  /** A live session. Recorded too: a session seen on day 3 and gone on day 4 dates the loss. */
  | 'ok'
  /** The row was found and had passed its expiry. `ageDays` says whether that was the full TTL. */
  | 'expired'
  /** A cookie arrived naming a session that no longer exists: a purged row, or a rotated SESSION_SECRET. */
  | 'unknown_token'
  /** No session cookie on a request the browser called cross-site. */
  | 'cookie_withheld_cross_site'
  /** The session cookie is gone while other cookies survived — it was lost on its own. */
  | 'cookie_missing'
  /** No cookies at all, though the app's own stored state survived: the jar was cleared. */
  | 'cookies_cleared'
  /**
   * No session, and nothing claiming there was one. The ordinary anonymous
   * reader — and also, indistinguishably, a device whose storage was evicted.
   * Never counted as a sign-out, because on this request it cannot be told
   * from someone arriving for the first time.
   */
  | 'anonymous';

function platformOf(userAgent: string | null): string {
  if (!userAgent) return 'unknown';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Macintosh/i.test(userAgent)) return 'macos';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'other';
}

function expectationOf(header: string | null): RequestFingerprint['clientExpectation'] {
  if (header === 'expected' || header === 'none') return header;
  return 'unknown';
}

export function describeRequest(request: Request): RequestFingerprint {
  const cookieHeader = request.headers.get('cookie');
  const cookieNames = Object.keys(parseCookies(cookieHeader)).sort();
  const userAgent = request.headers.get('user-agent');

  let originHost: string | null = null;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = 'unparseable';
    }
  }

  return {
    cookieNames,
    hadCookies: cookieNames.length > 0,
    secFetchSite: request.headers.get('sec-fetch-site'),
    originHost,
    hasAnonHeader: request.headers.get('x-anon-id') !== null,
    clientExpectation: expectationOf(request.headers.get('x-client-session')),
    clientDisplay: request.headers.get('x-client-display'),
    platform: platformOf(userAgent),
  };
}

export function classifyOutcome(
  lookup: SessionLookup,
  fingerprint: RequestFingerprint
): SessionOutcome {
  if (lookup.outcome === 'valid') return 'ok';
  if (lookup.outcome === 'expired') return 'expired';
  if (lookup.outcome === 'unknown_token') return 'unknown_token';

  // No token arrived. Nothing below is a sign-out unless this device says it
  // had signed in: a first-time reader sends no session cookie either, and on
  // a cross-site deployment sends it with `cross-site` set, which would make
  // every stranger an incident and bury the real ones.
  //
  // The lookups above need no such gate — an expired or unrecognised row is
  // the server's own evidence that a session existed, whatever the client says.
  if (fingerprint.clientExpectation !== 'expected') return 'anonymous';

  if (fingerprint.secFetchSite === 'cross-site') return 'cookie_withheld_cross_site';
  // The flag survived in localStorage. Whether anything else did says which
  // of the two happened: the session cookie went, or the jar was emptied.
  return fingerprint.hadCookies ? 'cookie_missing' : 'cookies_cleared';
}

/** The outcomes that mean somebody was signed out without asking to be. */
const UNEXPECTED: ReadonlySet<SessionOutcome> = new Set([
  'expired',
  'unknown_token',
  'cookie_withheld_cross_site',
  'cookie_missing',
  'cookies_cleared',
]);

const SUMMARIES: Record<SessionOutcome, string> = {
  ok: 'Session accepted',
  expired: 'Signed out: the session had expired',
  unknown_token: 'Signed out: the session cookie named a session that no longer exists',
  cookie_withheld_cross_site:
    'Signed out: the browser withheld the session cookie on a cross-site request',
  cookie_missing: 'Signed out: the session cookie was gone, other site data was not',
  cookies_cleared: 'Signed out: every cookie was gone, the app’s own stored state was not',
  anonymous: 'Anonymous reader, no session expected',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toMs: number): number | null {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return null;
  return Math.round(((toMs - from) / DAY_MS) * 10) / 10;
}

/**
 * How often an accepted session is worth writing down. Every app open asks
 * `/api/me`, and recording each one would bury the handful of records that
 * matter under thousands that say nothing changed. One every few hours is
 * enough to date a session's last sighting, which is all the accepted records
 * are for.
 */
const ACCEPTED_RECORD_INTERVAL_SECONDS = 6 * 60 * 60;

async function acceptedIsWorthRecording(env: Env, sessionId: string): Promise<boolean> {
  const key = `auth:seen:${sessionId}`;
  try {
    if (await env.KV.get(key)) {
      return false;
    }
    await env.KV.put(key, '1', { expirationTtl: ACCEPTED_RECORD_INTERVAL_SECONDS });
    return true;
  } catch {
    // If the throttle cannot be consulted, record anyway. Missing evidence is
    // the failure this whole apparatus exists to stop; a duplicate row is not.
    return true;
  }
}

/**
 * Record one authentication check. Fire this through `waitUntil` — it writes a
 * D1 row and the reader should never wait on a diagnostic.
 */
export async function recordSessionCheck(
  env: Env,
  request: Request,
  lookup: SessionLookup,
  userId: string | null
): Promise<void> {
  const fingerprint = describeRequest(request);
  const outcome = classifyOutcome(lookup, fingerprint);
  const now = Date.now();

  if (
    outcome === 'ok' &&
    lookup.outcome === 'valid' &&
    !(await acceptedIsWorthRecording(env, lookup.sessionId))
  ) {
    return;
  }

  const metadata: Record<string, unknown> = {
    outcome,
    ...fingerprint,
    // What the cookie was issued with, so a fingerprint can be read against
    // the policy that produced it rather than against an assumption.
    cookiePolicy: {
      sameSite: env.SESSION_COOKIE_SAMESITE || 'Lax',
      secure: env.COOKIE_SECURE === 'true',
      ttlDays: Number(env.SESSION_TTL_DAYS || '30'),
    },
  };

  if (lookup.outcome === 'valid' || lookup.outcome === 'expired') {
    metadata.sessionId = lookup.sessionId;
    metadata.sessionCreatedAt = lookup.createdAt;
    metadata.sessionExpiresAt = lookup.expiresAt;
    // How long the session lasted in practice. A TTL of 30 that dies at 2 is
    // the whole question, and this is the number that answers it.
    metadata.ageDays = daysBetween(lookup.createdAt, now);
  }

  const level = UNEXPECTED.has(outcome) ? logWarn : logInfo;
  await level(env, 'auth', SUMMARIES[outcome], metadata, userId ?? undefined);
}

/**
 * Record a sign-in. This is the anchor every later check is read against: it
 * dates the session and states the cookie policy it was issued under.
 */
export async function recordSessionCreated(
  env: Env,
  request: Request,
  params: { sessionId: string; userId: string; method: string; expiresAt: string }
): Promise<void> {
  await logInfo(
    env,
    'auth',
    `Signed in with ${params.method}`,
    {
      outcome: 'signed_in',
      method: params.method,
      sessionId: params.sessionId,
      sessionExpiresAt: params.expiresAt,
      ...describeRequest(request),
      cookiePolicy: {
        sameSite: env.SESSION_COOKIE_SAMESITE || 'Lax',
        secure: env.COOKIE_SECURE === 'true',
        ttlDays: Number(env.SESSION_TTL_DAYS || '30'),
      },
    },
    params.userId
  );
}

/**
 * Record a deliberate sign-out, so that a logout the user actually asked for
 * is never mistaken for one of the failures above.
 */
export async function recordSessionCleared(
  env: Env,
  request: Request,
  params: { sessionId: string | null; userId: string | null }
): Promise<void> {
  await logInfo(
    env,
    'auth',
    'Signed out at the reader’s request',
    { outcome: 'signed_out', sessionId: params.sessionId, ...describeRequest(request) },
    params.userId ?? undefined
  );
}
