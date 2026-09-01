import { describe, expect, it } from 'vitest';

import { diagnoseSession, isUnwantedSessionLoss } from '../src/sessionDiagnosis';

/**
 * The reading is the part that has been wrong every time, so it is the part
 * held down hardest. Two properties matter more than any individual wording:
 * a reading may never assert a cause the evidence does not settle, and it may
 * never send someone to change a setting that is already what it recommends.
 */
describe('diagnoseSession', () => {
  describe('a missing cookie on a cross-site request', () => {
    it('is settled when the policy is one that withholds it', () => {
      // Lax on a cross-site request is withheld by specification, and the
      // browser is what called the request cross-site. Nothing else to weigh.
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        sameSite: 'Lax',
      });

      expect(diagnosis.standing).toBe('determined');
      expect(diagnosis.statement).toContain('withheld');
      expect(diagnosis.nextStep).toContain('None');
    });

    it('never recommends None when None is already configured', () => {
      // The failure this guards: asserting that a Lax cookie caused the loss,
      // and sending someone to change a setting that is already correct.
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        sameSite: 'None',
      });

      expect(diagnosis.standing).toBe('narrowed');
      expect(diagnosis.statement).toContain('already None');
      expect(diagnosis.nextStep).not.toContain('SESSION_COOKIE_SAMESITE');
    });

    it('treats Strict the same as Lax', () => {
      const diagnosis = diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        sameSite: 'Strict',
      });
      expect(diagnosis.standing).toBe('determined');
    });
  });

  it('does not blame SameSite when the browser did not call the request cross-site', () => {
    const diagnosis = diagnoseSession({
      observation: 'no_session_cookie',
      secFetchSite: 'same-site',
      sameSite: 'Lax',
    });

    expect(diagnosis.standing).toBe('narrowed');
    expect(diagnosis.statement).not.toContain('withheld');
  });

  describe('an expired session', () => {
    it('separates running the full term from ending early', () => {
      const fullTerm = diagnoseSession({ observation: 'expired', ageDays: 30, ttlDays: 30 });
      expect(fullTerm.statement).toContain('full term');
      expect(fullTerm.nextStep).toContain('SESSION_TTL_DAYS');

      // The reported symptom. If this ever shows up, the term is not the cause
      // and raising it would fix nothing.
      const early = diagnoseSession({ observation: 'expired', ageDays: 2, ttlDays: 30 });
      expect(early.statement).toContain('2 days');
      expect(early.statement).toContain('short');
      expect(early.nextStep).toContain('shorter expiry');
    });

    it('is settled either way — the row is its own evidence', () => {
      expect(diagnoseSession({ observation: 'expired', ageDays: 30, ttlDays: 30 }).standing).toBe(
        'determined'
      );
      expect(diagnoseSession({ observation: 'expired', ageDays: 2, ttlDays: 30 }).standing).toBe(
        'determined'
      );
    });

    it('still says something useful when the age was not recorded', () => {
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
      diagnoseSession({ observation: 'expired', ageDays: 30, ttlDays: 30 }),
      diagnoseSession({ observation: 'expired', ageDays: 2, ttlDays: 30 }),
      diagnoseSession({ observation: 'unknown_token' }),
      diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'cross-site',
        sameSite: 'Lax',
      }),
      diagnoseSession({
        observation: 'no_session_cookie',
        secFetchSite: 'same-site',
        sameSite: 'Lax',
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

    // An accepted session is not a loss, and an anonymous reader never had one
    // — counting either would let ordinary traffic pick the answer.
    expect(isUnwantedSessionLoss('ok')).toBe(false);
    expect(isUnwantedSessionLoss('anonymous')).toBe(false);
    expect(isUnwantedSessionLoss('signed_in')).toBe(false);
    expect(isUnwantedSessionLoss('signed_out')).toBe(false);
  });
});
