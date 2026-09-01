import { SessionObservation, isUnwantedSessionLoss } from '@word-of-the-day/shared';

import { Env } from '../env';
import { logInfo, logWarn } from '../notifications/logger';
import { SessionLookup, parseCookies } from './sessions';

/**
 * Recording why sessions end.
 *
 * The symptom this exists for — "I have to log in again every couple of days"
 * — only reproduces on a phone, where there is no cookie jar to inspect. So
 * the server writes down what each request presented and what became of the
 * session it named.
 *
 * Two rules govern everything here, and both were learned by breaking them:
 *
 *   1. **Record observations, never causes.** Every value written must be
 *      true by construction — the row was found past its expiry; a token
 *      named no row; a device that said it had signed in sent no cookie. A
 *      cause is a judgement about facts, it can be wrong, and one written
 *      into an append-only table is wrong permanently. Judgement happens at
 *      reading time, in `diagnoseSession`, over evidence that stays intact.
 *
 *   2. **Record incidents, never requests.** A session is lost once. If the
 *      loss is written down on every app open that follows, one reader
 *      outweighs every other and picks the answer. Each observation below is
 *      therefore made to happen once: a dead cookie is cleared the moment it
 *      is seen, so the request that follows carries nothing to re-observe;
 *      the client drops its claim once told; accepted sessions are sampled.
 *
 * What is deliberately absent: any attempt to catch storage eviction in the
 * act. It takes the cookie and the client's own flag together and leaves a
 * device identical to a first-time visitor. It is inferred in the admin screen
 * from sessions that go quiet while still valid, and claimed nowhere else.
 */

/**
 * What arrived with a request. Cookie *names* only — the session token is a
 * live credential and these records are rendered in the admin screen.
 */
export interface RequestFingerprint {
  cookieNames: string[];
  hadCookies: boolean;
  /**
   * `same-origin` | `same-site` | `cross-site` | `none`. Evidence, not a
   * verdict: read against the cookie's SameSite policy it can settle whether
   * the browser withheld the cookie, and read alone it settles nothing.
   */
  secFetchSite: string | null;
  originHost: string | null;
  hasAnonHeader: boolean;
  /**
   * What the app believed before it asked. `expected` means this device
   * completed a sign-in and never signed out, which is the only thing
   * separating a device that lost a session from one that never had one —
   * on the wire they are the same request.
   *
   * Absence proves nothing: the flag lives in localStorage, so anything that
   * clears the site's storage takes it along with the cookie. Only its
   * presence carries information.
   */
  clientExpectation: 'expected' | 'none' | 'unknown';
  /** `standalone` for an installed PWA — the shape iOS evicts hardest. */
  clientDisplay: string | null;
  platform: string;
}

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

/**
 * What happened, in terms that cannot be wrong.
 *
 * Note there is no cross-site case here. Whether SameSite withheld the cookie
 * depends on the policy the cookie carries as much as on the request, and that
 * pairing is a judgement — it belongs to `diagnoseSession`, not to the value
 * this writes down. `Sec-Fetch-Site` is recorded as evidence for it.
 */
export function observeSession(
  lookup: SessionLookup,
  fingerprint: RequestFingerprint
): SessionObservation {
  if (lookup.outcome === 'valid') return 'ok';
  if (lookup.outcome === 'expired') return 'expired';
  if (lookup.outcome === 'unknown_token') return 'unknown_token';

  // No token arrived. Without a claim from this device there is nothing to
  // say it ever had a session, and a first-time reader would otherwise be
  // counted as having lost one.
  if (fingerprint.clientExpectation !== 'expected') return 'anonymous';
  return 'no_session_cookie';
}

const SUMMARIES: Record<SessionObservation, string> = {
  ok: 'Session accepted',
  expired: 'Session found past its expiry',
  unknown_token: 'Session cookie named no session on record',
  no_session_cookie: 'A device that had signed in arrived without its session cookie',
  anonymous: 'No session claimed',
};

/**
 * How often an accepted session is worth writing down. Every app open asks
 * `/api/me`; one record every few hours is enough to date a session's last
 * sighting, which is all the accepted records are for.
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

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toMs: number): number | null {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return null;
  return Math.round(((toMs - from) / DAY_MS) * 10) / 10;
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
  const observation = observeSession(lookup, fingerprint);

  // An anonymous reader supports no diagnosis: no session, no session id, and
  // nothing lost. They are also the overwhelming majority of requests, so
  // writing them down would push the records that matter out of every window
  // that reads them.
  if (observation === 'anonymous') {
    return;
  }

  if (
    observation === 'ok' &&
    lookup.outcome === 'valid' &&
    !(await acceptedIsWorthRecording(env, lookup.sessionId))
  ) {
    return;
  }

  const metadata: Record<string, unknown> = {
    outcome: observation,
    ...fingerprint,
    // The policy the cookie was issued under. `diagnoseSession` needs it: a
    // cross-site request means one thing under SameSite=Lax and another under
    // None, and without it the reading would send someone to change a setting
    // that is already correct.
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
    // How long the session lasted in practice. A term of 30 days that ends at
    // 2 is the whole question, and this is the number that answers it.
    metadata.ageDays = daysBetween(lookup.createdAt, Date.now());
  }

  const level = isUnwantedSessionLoss(observation) ? logWarn : logInfo;
  await level(env, 'auth', SUMMARIES[observation], metadata, userId ?? undefined);
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
 * Record a deliberate sign-out, so that a sign-out someone asked for is never
 * read as a failure, and its session is not counted as having gone quiet.
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
