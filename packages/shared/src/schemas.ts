import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (HH:mm)');

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().refine(isValidTimeZone, {
  message: 'Invalid timezone',
});

export const emailSchema = z.string().email();

export const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format');

export const passwordSchema = z.string().min(10);

export const eventNameSchema = z.enum([
  'app_installed',
  'auth_flow_completed',
  'auth_flow_started',
  'history_opened',
  'notification_enabled',
  'notification_permission_granted',
  'word_delivered',
  'word_viewed',
  'notification_disabled',
  'account_created',
  'auth_method_used',
]);

export const eventSchema = z.object({
  event_name: eventNameSchema,
  timestamp: z.string().datetime(),
  user_id: uuidSchema,
  client: z.enum(['web', 'pwa']),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const deliverySettingsSchema = z.object({
  enabled: z.boolean(),
  delivery_time: timeStringSchema,
  timezone: timeZoneSchema,
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});
