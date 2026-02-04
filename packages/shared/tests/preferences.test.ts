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

  it('accepts a valid difficulty preference', () => {
    const result = normalizePreferences({
      version: 1,
      notification_enabled: false,
      delivery_time: '09:00',
      word_filters: {
        difficulty: 'advanced',
      },
    });

    expect(result.word_filters?.difficulty).toBe('advanced');
  });

  it('falls back to defaults for an invalid difficulty value while preserving schedule fields', () => {
    const result = normalizePreferences({
      version: 1,
      notification_enabled: true,
      delivery_time: '10:00',
      word_filters: {
        difficulty: 'impossible',
      },
    });

    expect(result.notification_enabled).toBe(true);
    expect(result.delivery_time).toBe('10:00');
    expect(result.word_filters).toBeUndefined();
  });
});
