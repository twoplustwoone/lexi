import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { computeNextDeliveryAt, getLocalDateKey } from '../src/time';

describe('time helpers', () => {
  it('computes next delivery time in the same day when later', () => {
    const now = DateTime.fromISO('2024-01-01T08:00:00', { zone: 'America/New_York' });
    const next = computeNextDeliveryAt('America/New_York', '09:00', now.toJSDate());
    const nextLocal = DateTime.fromJSDate(next, { zone: 'America/New_York' });

    expect(nextLocal.toISO()).toBe('2024-01-01T09:00:00.000-05:00');
  });

  it('computes next delivery time on the next day when time has passed', () => {
    const now = DateTime.fromISO('2024-01-01T10:30:00', { zone: 'America/New_York' });
    const next = computeNextDeliveryAt('America/New_York', '09:00', now.toJSDate());
    const nextLocal = DateTime.fromJSDate(next, { zone: 'America/New_York' });

    expect(nextLocal.toISO()).toBe('2024-01-02T09:00:00.000-05:00');
  });

  it('gets local date key for timezone', () => {
    const now = DateTime.fromISO('2024-01-01T01:00:00Z');
    const localDate = getLocalDateKey(now.toJSDate(), 'America/Los_Angeles');

    expect(localDate).toBe('2023-12-31');
  });
});
