import { z } from 'zod';

import { timeStringSchema, wordDifficultySchema } from './schemas';

const WordFiltersSchema = z.object({
  difficulty: wordDifficultySchema.optional(),
  language: z.string().optional(),
  theme: z.string().optional(),
});

export const PreferencesV1Schema = z.object({
  version: z.literal(1),
  notification_enabled: z.boolean(),
  delivery_time: timeStringSchema,
  word_filters: WordFiltersSchema.optional(),
});

export type PreferencesV1 = z.infer<typeof PreferencesV1Schema>;
export type WordDifficulty = z.infer<typeof wordDifficultySchema>;

export const DEFAULT_PREFERENCES: PreferencesV1 = {
  version: 1,
  notification_enabled: false,
  delivery_time: '09:00',
};

export function normalizePreferences(input: unknown): PreferencesV1 {
  const parsed = PreferencesV1Schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return DEFAULT_PREFERENCES;
  }

  const candidate = input as Record<string, unknown>;

  const normalized: PreferencesV1 = {
    version: 1,
    notification_enabled:
      typeof candidate.notification_enabled === 'boolean'
        ? candidate.notification_enabled
        : DEFAULT_PREFERENCES.notification_enabled,
    delivery_time: timeStringSchema.safeParse(candidate.delivery_time).success
      ? (candidate.delivery_time as string)
      : DEFAULT_PREFERENCES.delivery_time,
  };

  const wordFilters = WordFiltersSchema.safeParse(candidate.word_filters);
  if (
    wordFilters.success &&
    (wordFilters.data.difficulty || wordFilters.data.language || wordFilters.data.theme)
  ) {
    normalized.word_filters = {
      ...wordFilters.data,
    };
  }

  return normalized;
}
