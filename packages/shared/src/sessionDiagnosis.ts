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
  /**
   * The SameSite setting configured when the loss was recorded.
   *
   * Emphatically not "the policy this cookie was issued under": a rollout does
   * not rewrite cookies already in browsers, so after a Lax-to-None change an
   * old Lax cookie is still Lax while this reads None. Nothing below may
   * conclude from it — it only shapes which explanations are worth listing.
   */
  configuredSameSite?: string | null;
  /** How many days the session lasted before expiring. */
  ageDays?: number | null;
  /**
   * The term the session was actually issued for, derived from its own
   * created and expires timestamps rather than from configuration.
   */
  termDays?: number | null;
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

/** Within this fraction of its own term counts as running full term. */
const FULL_TERM = 0.95;

function diagnoseExpired(evidence: SessionEvidence): SessionDiagnosis {
  const { ageDays, termDays } = evidence;

  // Settled, and settled by the row's own two dates: when it was issued and
  // when it lapsed. Configuration is not consulted, so a setting changed since
  // cannot make this read wrong. Only the remedy varies.
  if (typeof ageDays !== 'number' || typeof termDays !== 'number' || termDays <= 0) {
    return {
      statement: 'The session reached its expiry and was refused.',
      standing: 'determined',
      nextStep: 'Compare the age it reached against SESSION_TTL_DAYS.',
    };
  }

  if (ageDays >= termDays * FULL_TERM) {
    return {
      statement: `The session ran its full term of ${termDays} days and expired.`,
      standing: 'determined',
      nextStep:
        'Nothing is broken — the term is simply short for how people use the app. Raise SESSION_TTL_DAYS, or renew a session on use so an active reader is never signed out.',
    };
  }

  return {
    statement: `The session expired after ${ageDays} days, well short of the ${termDays} it was issued for.`,
    standing: 'determined',
    nextStep:
      'The row was written with a shorter expiry than its term implies. Check what SESSION_TTL_DAYS resolved to when the session was created.',
  };
}

function diagnoseMissingCookie(evidence: SessionEvidence): SessionDiagnosis {
  const crossSite = evidence.secFetchSite === 'cross-site';
  const sameSite = (evidence.configuredSameSite ?? 'Lax').toLowerCase();

  /**
   * This is never `determined`, and the temptation to make it so is the single
   * mistake this module exists to stop making.
   *
   * The server sees that no cookie arrived. It cannot see whether one was
   * there to arrive. A cookie the browser withheld and a cookie that had
   * already been deleted, evicted, or never stored produce byte-identical
   * requests, and `Sec-Fetch-Site` classifies the request, not the cookie. So
   * a cross-site request under SameSite=Lax is *consistent with* the browser
   * withholding it — it is not proof that it did, and telling someone to
   * change SameSite when the cookie was simply gone sends them to fix a thing
   * that was never broken.
   *
   * What the configured policy earns is a place in the shortlist, and an
   * ordering of it. Never a conclusion.
   */
  if (crossSite && (sameSite === 'lax' || sameSite === 'strict')) {
    return {
      statement: `The request was cross-site and the cookie is configured SameSite=${evidence.configuredSameSite}, which would withhold it — though a cookie already deleted or evicted looks exactly the same from here.`,
      standing: 'narrowed',
      nextStep:
        'Setting SESSION_COOKIE_SAMESITE to None removes the one candidate you can act on, and is worth doing regardless while the API is on another site. If losses continue after that, the cookie was going missing on its own.',
    };
  }

  if (crossSite) {
    // Policy is already None, so SameSite is not among the candidates at all.
    // Recommending it would send someone to change a setting already correct.
    return {
      statement:
        'The request was cross-site with the policy already None, so SameSite did not withhold it: the cookie was blocked as third-party, deleted, or evicted.',
      standing: 'narrowed',
      nextStep:
        'Browsers that block third-party cookies will not send this one from another site at all. Serving the API from the app’s own domain is the only reliable answer to that.',
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
