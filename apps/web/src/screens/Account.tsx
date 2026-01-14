import { useState } from 'preact/hooks';

import { fetchMe, logout, sendAdminTestNotification } from '../api';
import { Button } from '../components/Button';
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
          <Button className="mt-3" variant="secondary" onClick={handleLogout}>
            Sign out
          </Button>
        ) : null}
        {!user.isAuthenticated ? (
          <Button className="mt-3" onClick={onOpenAuth}>
            Sign in or create account
          </Button>
        ) : null}
        {user.isAuthenticated && user.isAdmin ? (
          <Button className="mt-3" onClick={handleAdminNotify}>
            Send test notification
          </Button>
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
          <Button className="mt-4" onClick={onOpenAuth}>
            Open sign-in
          </Button>
        </div>
      ) : null}
    </section>
  );
}
