import { useState } from 'preact/hooks';

import { fetchMe, logout, sendAdminTestNotification } from '../api';
import { getAnonymousId } from '../identity';

interface AccountProps {
  path?: string;
  user: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  };
  onOpenAuth: () => void;
  onUserChange: (next: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  }) => void;
}

export function Account({ user, onOpenAuth, onUserChange }: AccountProps) {
  const [status, setStatus] = useState<string | null>(null);

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const refreshUser = async () => {
    const me = await fetchMe();
    onUserChange({
      userId: me.user_id,
      isAuthenticated: me.is_authenticated,
      isAnonymous: me.is_anonymous,
      isAdmin: me.is_admin,
    });
    return me;
  };

  const handleLogout = async () => {
    await logout();
    await refreshUser();
    setStatus('Signed out.');
  };

  const handleAdminNotify = async () => {
    setStatus(null);
    try {
      await sendAdminTestNotification();
      setStatus('Test notification sent.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Could not send notification.'));
    }
  };

  const cardBase =
    'rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card shadow-[0_18px_40px_rgba(29,25,18,0.12)] animate-[fade-up_0.5s_ease_both] motion-reduce:animate-none';

  return (
    <section className="grid gap-5">
      <div className={`${cardBase} p-6`}>
        <h2 className="font-[var(--font-display)] text-2xl">Account</h2>
        <p className="mt-1 text-muted">
          {user.isAuthenticated
            ? `Signed in as ${user.userId}`
            : `Anonymous session: ${getAnonymousId()}`}
        </p>
        {user.isAuthenticated ? (
          <button
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-accent/10 px-4 py-2 text-sm font-semibold text-accent-strong transition hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            type="button"
            onClick={handleLogout}
          >
            Sign out
          </button>
        ) : null}
        {!user.isAuthenticated ? (
          <button
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            type="button"
            onClick={onOpenAuth}
          >
            Sign in or create account
          </button>
        ) : null}
        {user.isAuthenticated && user.isAdmin ? (
          <button
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            type="button"
            onClick={handleAdminNotify}
          >
            Send test notification
          </button>
        ) : null}
        {status ? <p className="mt-3 text-sm text-accent-strong">{status}</p> : null}
      </div>

      {!user.isAuthenticated ? (
        <div className={`${cardBase} p-6`}>
          <h3 className="text-lg font-semibold">Sync your history</h3>
          <p className="mt-2 text-sm text-muted">
            Sign in to keep your word history, notification settings, and preferences safe across
            devices.
          </p>
          <button
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            type="button"
            onClick={onOpenAuth}
          >
            Open sign-in
          </button>
        </div>
      ) : null}
    </section>
  );
}
