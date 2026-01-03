import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/preferences';

describe('preferences', () => {
  it('uses defaults for invalid preferences', () => {
    const result = normalizePreferences({});

    expect(result).toEqual(DEFAULT_PREFERENCES);
  });

  it('accepts valid preferences', () => {
    const result = normalizePreferences({
      version: 1,
      notification_enabled: true,
      delivery_time: '07:30',
    });

    expect(result.notification_enabled).toBe(true);
    expect(result.delivery_time).toBe('07:30');
  });
});
