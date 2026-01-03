import { DateTime } from 'luxon';

import { timeStringSchema } from './schemas';

export function getLocalDateKey(date: Date, timeZone: string): string {
  const value = DateTime.fromJSDate(date, { zone: timeZone }).toISODate();
  return value ?? DateTime.fromJSDate(date, { zone: timeZone }).toFormat('yyyy-LL-dd');
}

export function computeNextDeliveryAt(
  timeZone: string,
  deliveryTime: string,
  now: Date = new Date()
): Date {
  const parsed = timeStringSchema.parse(deliveryTime);
  const [hour, minute] = parsed.split(':').map(Number);
  const nowLocal = DateTime.fromJSDate(now, { zone: timeZone });
  let scheduledLocal = nowLocal.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  if (scheduledLocal <= nowLocal) {
    scheduledLocal = scheduledLocal.plus({ days: 1 });
  }

  return scheduledLocal.toUTC().toJSDate();
}

export function toUtcDateString(date: Date): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).toISO() ?? date.toISOString();
}
