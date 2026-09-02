import { describe, expect, it } from 'vitest';

import { diagnoseSession, isUnwantedSessionLoss } from '../src/sessionDiagnosis';

/**
 * The reading is the part that has been wrong every time, so it is the part
 * held down hardest. One property matters above any individual wording: a
 * reading may never assert a cause the evidence does not settle, and may never
 * send someone to change a setting that is already what it recommends.
 */
describe('diagnoseSession', () => {
  describe('a missing cookie', () => {
    /**
     * The server sees that no cookie arrived. It cannot see whether one was
     * there to arrive — a cookie the browser withheld and a cookie already
     * deleted or evicted produce byte-identical requests, and `Sec-Fetch-Site`
     * classifies the request, not the cookie.
     *
     * So no branch here may be `determined`. An earlier revision claimed one
     * was, and would have sent someone to change SameSite over a cookie that
     * had simply been deleted.
     */
    it('is never settled, whatever the policy, because a cookie that was never there looks the same', () => {
      const policies = ['Lax', 'Strict', 'None'];
      const sites: Array<string | null> = ['cross-site', 'same-site', 'same-origin', null];

      for (const configuredSameSite of policies) {
        for (const secFetchSite of sites) {
          const diagnosis = diagnoseSession({
            observation: 'no_session_cookie',
            secFetchSite,
            configuredSameSite,
          });
          expect(diagnosis.standing).toBe('narrowed');
        }
      }
    });

    it('still names SameSite as the candidate worth acting on under Lax', () => {
      // Narrowed is not the same as useless: the policy earns a place in the
      // shortlist and an ordering of it, just never a conclusion.
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        configuredSameSite: 'Lax',
      });

      expect(diagnosis.statement).toContain('SameSite=Lax');
      expect(diagnosis.statement).toContain('deleted or evicted');
      expect(diagnosis.nextStep).toContain('None');
    });

    it('never recommends None when None is already configured', () => {
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        configuredSameSite: 'None',
      });

      expect(diagnosis.statement).toContain('already None');
      expect(diagnosis.nextStep).not.toContain('SESSION_COOKIE_SAMESITE');
    });

    it('does not raise SameSite at all when the request was not cross-site', () => {
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'same-site',
        configuredSameSite: 'Lax',
      });

      expect(diagnosis.statement).not.toContain('SameSite');
      expect(diagnosis.statement).toContain('evicted');
    });
  });

  describe('an expired session', () => {
    it('reads the term from the session, so a changed setting cannot rewrite the past', () => {
      // termDays comes from the row's own created and expires timestamps. A
      // session issued for 7 days is still a 7-day session after
      // SESSION_TTL_DAYS is raised to 30, and must not be reported as having
      // died early because the configuration moved underneath it.
      const diagnosis = diagnoseSession({ observation: 'expired', ageDays: 7, termDays: 7 });
      expect(diagnosis.statement).toContain('full term of 7 days');
    });

    it('separates running the full term from ending early', () => {
      const fullTerm = diagnoseSession({ observation: 'expired', ageDays: 30, termDays: 30 });
      expect(fullTerm.statement).toContain('full term');
      expect(fullTerm.nextStep).toContain('SESSION_TTL_DAYS');

      // The reported symptom. If this ever shows up, the term is not the cause
      // and raising it would fix nothing.
      const early = diagnoseSession({ observation: 'expired', ageDays: 2, termDays: 30 });
      expect(early.statement).toContain('2 days');
      expect(early.statement).toContain('short');
    });

    it('is settled either way — the row is its own evidence', () => {
      expect(diagnoseSession({ observation: 'expired', ageDays: 30, termDays: 30 }).standing).toBe(
        'determined'
      );
      expect(diagnoseSession({ observation: 'expired', ageDays: 2, termDays: 30 }).standing).toBe(
        'determined'
      );
    });

    it('still says something useful when the term was not recorded', () => {
      const diagnosis = diagnoseSession({ observation: 'expired' });
      expect(diagnosis.standing).toBe('determined');
      expect(diagnosis.statement).toContain('expiry');
    });
  });

  it('does not claim to know why a session is missing from the database', () => {
    const diagnosis = diagnoseSession({ observation: 'unknown_token' });
    expect(diagnosis.standing).toBe('narrowed');
    expect(diagnosis.statement).toContain('deleted');
    expect(diagnosis.statement).toContain('SESSION_SECRET');
  });

  it('reports an accepted session and an anonymous reader as losing nothing', () => {
    expect(diagnoseSession({ observation: 'ok' }).standing).toBe('determined');
    expect(diagnoseSession({ observation: 'anonymous' }).statement).toContain('nothing was lost');
  });

  it('offers a next step wherever there is something to change', () => {
    // A reading with no action is a dead end for whoever opened the screen.
    const actionable = [
      diagnoseSession({ observation: 'expired', ageDays: 30, termDays: 30 }),
      diagnoseSession({ observation: 'expired', ageDays: 2, termDays: 30 }),
      diagnoseSession({ observation: 'unknown_token' }),
      diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        configuredSameSite: 'Lax',
      }),
      diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        configuredSameSite: 'None',
      }),
      diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'same-site',
        configuredSameSite: 'Lax',
      }),
    ];
    for (const diagnosis of actionable) {
      expect(diagnosis.nextStep).toBeTruthy();
    }
  });
});

describe('isUnwantedSessionLoss', () => {
  it('counts the three losses and nothing else', () => {
    expect(isUnwantedSessionLoss('expired')).toBe(true);
    expect(isUnwantedSessionLoss('unknown_token')).toBe(true);
    expect(isUnwantedSessionLoss('no_session_cookie')).toBe(true);

    expect(isUnwantedSessionLoss('ok')).toBe(false);
    expect(isUnwantedSessionLoss('anonymous')).toBe(false);
    expect(isUnwantedSessionLoss('signed_in')).toBe(false);
    expect(isUnwantedSessionLoss('signed_out')).toBe(false);
  });
});
