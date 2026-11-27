import { AdminUser, WordDifficulty } from '../../api';

/** Seven days, the window the Overview figures and the dormancy flag both use. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** `22 Aug` — the short form the design uses for anything older than yesterday. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** `24 Aug 9:00` — recent sends and the breakage feed timestamp gutter. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Today / Yesterday / `22 Aug` / Never. The People table and the per-person
 * marks both read recency this way.
 */
export function formatRelativeDay(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= startOfToday) return 'Today';
  if (time >= startOfToday - 24 * 60 * 60 * 1000) return 'Yesterday';
  return formatShortDate(iso);
}

/** True when this person has opened a word inside the last seven days. */
export function readThisWeek(user: AdminUser, now = Date.now()): boolean {
  if (!user.lastReadAt) return false;
  const time = new Date(user.lastReadAt).getTime();
  if (Number.isNaN(time)) return false;
  return now - time <= WEEK_MS;
}

/** A reader who has not opened a word in a week gets flagged in accent-strong. */
export function isDormant(user: AdminUser, now = Date.now()): boolean {
  return !readThisWeek(user, now);
}

/** Email, then username, then a truncated id — the same order AdminPanel used. */
export function displayName(user: AdminUser): string {
  if (user.email) return user.email;
  if (user.username) return user.username;
  return `${user.id.slice(0, 8)}…`;
}

/** How this person signs in, in the design's words. */
export function signInMethod(user: AdminUser): string {
  const providers = user.authProviders ?? [];
  if (providers.some((provider) => provider.provider === 'google')) return 'Google';
  if (providers.some((provider) => provider.provider === 'password')) return 'Password';
  if (providers.length > 0) return 'Magic link';
  return 'Anonymous';
}

export const DIFFICULTY_ORDER: WordDifficulty[] = ['advanced', 'balanced', 'easy'];

export function difficultyLabel(category: WordDifficulty | null): string {
  if (!category) return '—';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Sentence-cases a list: `a`, `a and b`, `a, b and c`. */
export function joinWords(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
