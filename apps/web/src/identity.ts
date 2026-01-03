const ANON_KEY = 'wotd:anon_id';

export function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export function setAnonymousId(id: string): void {
  localStorage.setItem(ANON_KEY, id);
}

export function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
