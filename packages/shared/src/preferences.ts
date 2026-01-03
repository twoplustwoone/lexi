import { z } from 'zod';

import { timeStringSchema } from './schemas';

export const PreferencesV1Schema = z.object({
  version: z.literal(1),
  notification_enabled: z.boolean(),
  delivery_time: timeStringSchema,
  word_filters: z
    .object({
      difficulty: z.string().optional(),
      language: z.string().optional(),
      theme: z.string().optional(),
    })
    .optional(),
});

export type PreferencesV1 = z.infer<typeof PreferencesV1Schema>;

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

  return DEFAULT_PREFERENCES;
}
