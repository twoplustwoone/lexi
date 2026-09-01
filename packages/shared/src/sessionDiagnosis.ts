/**
 * Reading a sign-out record back into an explanation.
 *
 * The records themselves state only what was observed — a row found past its
 * expiry, a token naming no row, a device that claimed a session and arrived
 * without its cookie. Naming the *cause* is a separate step, done here, at the
 * point of reading.
 *
 * That split is deliberate and it is the thing to preserve. A cause written
 * into the log at the moment of the request is a guess frozen into a table:
 * when the guess turns out wrong — and every one of them here did, in turn —
 * the rows are already mislabelled and the mistake cannot be taken back. The
 * same guess made here is a pure function of recorded facts. When it is wrong
 * it is one function to correct, over evidence that is still intact.
 *
 * So nothing in this file may invent evidence, and every branch has to be
 * honest about which of the two things it is doing: a conclusion the evidence
 * can only mean, or a shortlist of what remains.
 */

export type SessionObservation =
  /** The row was found and was live. */
  | 'ok'
  /** The row was found and had passed its expiry. */
  | 'expired'
  /** A token was presented and named no row. */
  | 'unknown_token'
  /** A device that said it had signed in arrived with no session cookie. */
  | 'no_session_cookie'
  /** Nothing claimed a session. Not recorded — it can support no diagnosis. */
  | 'anonymous';

export interface SessionEvidence {
  observation: SessionObservation;
  /** The browser's own classification of the request, when it sent one. */
  secFetchSite?: string | null;
  /** The SameSite policy the cookie was issued under. */
  sameSite?: string | null;
  /** How many days the session lasted before expiring. */
  ageDays?: number | null;
  /** The configured term it was issued for. */
  ttlDays?: number | null;
}

export interface SessionDiagnosis {
  /** What the evidence supports, in one sentence. */
  statement: string;
  /**
   * `determined` — the evidence admits one explanation.
   * `narrowed` — several remain, and the statement names them.
   */
  standing: 'determined' | 'narrowed';
  /** What to change, where the evidence identifies something to change. */
  nextStep?: string;
}

/** Within this fraction of the configured term counts as running full term. */
const FULL_TERM = 0.95;

function diagnoseExpired(evidence: SessionEvidence): SessionDiagnosis {
  const { ageDays, ttlDays } = evidence;

  // The row is its own evidence here: it recorded when it was issued and when
  // it lapsed, so what happened is settled. Only the remedy varies.
  if (typeof ageDays !== 'number' || typeof ttlDays !== 'number' || ttlDays <= 0) {
    return {
      statement: 'The session reached its expiry and was refused.',
      standing: 'determined',
      nextStep: 'Compare the age it reached against SESSION_TTL_DAYS.',
    };
  }

  if (ageDays >= ttlDays * FULL_TERM) {
    return {
      statement: `The session ran its full term of ${ttlDays} days and expired.`,
      standing: 'determined',
      nextStep:
        'Nothing is broken — the term is simply short for how people use the app. Raise SESSION_TTL_DAYS, or renew a session on use so an active reader is never signed out.',
    };
  }

  return {
    statement: `The session expired after ${ageDays} days, well short of the ${ttlDays} it was issued for.`,
    standing: 'determined',
    nextStep:
      'The row was written with a shorter expiry than the setting says. Check what SESSION_TTL_DAYS resolved to when the session was created.',
  };
}

function diagnoseMissingCookie(evidence: SessionEvidence): SessionDiagnosis {
  const crossSite = evidence.secFetchSite === 'cross-site';
  const sameSite = (evidence.sameSite ?? 'Lax').toLowerCase();

  if (crossSite && (sameSite === 'lax' || sameSite === 'strict')) {
    // This one the evidence really does settle. A Lax or Strict cookie is
    // withheld on a cross-site request by specification, and the browser
    // itself is what called the request cross-site.
    return {
      statement: `The browser withheld the cookie: the request was cross-site and the cookie is SameSite=${evidence.sameSite}.`,
      standing: 'determined',
      nextStep:
        'Set SESSION_COOKIE_SAMESITE to None — it requires HTTPS, which COOKIE_SECURE already gives you — or move the API onto the app’s own domain.',
    };
  }

  if (crossSite) {
    // Policy is already None, so SameSite is not what stopped it. Saying
    // otherwise would send someone to change a setting that is already right.
    return {
      statement:
        'The request was cross-site and the cookie policy is already None, so SameSite did not withhold it. Third-party cookie blocking, or the cookie was already gone.',
      standing: 'narrowed',
      nextStep:
        'Browsers that block third-party cookies will not send this cookie at all from another site. Serving the API from the app’s own domain is the only reliable fix for that.',
    };
  }

  return {
    statement:
      'A device that had signed in returned without the cookie, on a request the browser did not call cross-site: it lapsed, was cleared, or the site’s storage was evicted.',
    standing: 'narrowed',
    nextStep:
      'Check the cookie’s Max-Age against how long it survives. If it is being outlived, the browser is discarding it — which is what Safari and iOS do to a site they consider idle, hardest of all to an installed app.',
  };
}

export function diagnoseSession(evidence: SessionEvidence): SessionDiagnosis {
  switch (evidence.observation) {
    case 'ok':
      return { statement: 'The session was accepted.', standing: 'determined' };

    case 'expired':
      return diagnoseExpired(evidence);

    case 'unknown_token':
      // That the row is absent is settled; why it is absent is not.
      return {
        statement:
          'The cookie named a session with no row behind it: either the row was deleted, or SESSION_SECRET changed.',
        standing: 'narrowed',
        nextStep:
          'Every session hash derives from SESSION_SECRET, so rotating it invalidates every session at once. If several readers lost their sessions at the same moment, that is the one to check first.',
      };

    case 'no_session_cookie':
      return diagnoseMissingCookie(evidence);

    case 'anonymous':
      return {
        statement: 'No session was claimed, so nothing was lost.',
        standing: 'determined',
      };
  }
}

/** The observations that mean somebody lost a session they had not given up. */
export const UNWANTED_SESSION_OBSERVATIONS: readonly SessionObservation[] = [
  'expired',
  'unknown_token',
  'no_session_cookie',
];

export function isUnwantedSessionLoss(observation: string): boolean {
  return (UNWANTED_SESSION_OBSERVATIONS as readonly string[]).includes(observation);
}
