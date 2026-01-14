import { useEffect, useState } from 'preact/hooks';
import PreactRouter from 'preact-router';
import { Link } from 'preact-router/match';

import { fetchMe, getClientType, registerAnonymousIdentity, trackEvent } from './api';
import { getAnonymousId } from './identity';
import { Home } from './screens/Home';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Account } from './screens/Account';

interface UserState {
  userId: string | null;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  isAdmin: boolean;
}

export function App() {
  const [user, setUser] = useState<UserState>({
    userId: null,
    isAuthenticated: false,
    isAnonymous: true,
    isAdmin: false,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await registerAnonymousIdentity();
        const me = await fetchMe();
        setUser({
          userId: me.user_id,
          isAuthenticated: me.is_authenticated,
          isAnonymous: me.is_anonymous,
          isAdmin: me.is_admin,
        });
      } catch {
        // Continue in offline mode.
      } finally {
        setReady(true);
      }
    };
    void init();
  }, []);

  useEffect(() => {
    const handler = () => {
      trackEvent({
        event_name: 'app_installed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
      });
    };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, [user.userId]);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-[radial-gradient(circle_at_top,_#fdf7ee_0%,_#f7f0e6_45%,_#f1dfcc_100%)] px-6 pb-16 pt-6 text-ink md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-8">
        <div className="flex items-center gap-4">
          <img
            src="/icons/icon-192.png"
            alt="Lexi"
            className="h-14 w-14 rounded-[18px] shadow-[0_18px_40px_rgba(29,25,18,0.12)]"
          />
          <div>
            <p className="m-0 font-[var(--font-display)] text-2xl">Lexi</p>
            <p className="mt-1 text-sm text-muted">Daily rituals, kept simple.</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-4 rounded-full bg-white/70 px-4 py-2 shadow-[0_8px_18px_rgba(29,25,18,0.08)]">
          <Link
            activeClassName="text-accent-strong"
            className="text-muted font-semibold no-underline transition-colors hover:text-accent-strong"
            href="/"
          >
            Home
          </Link>
          <Link
            activeClassName="text-accent-strong"
            className="text-muted font-semibold no-underline transition-colors hover:text-accent-strong"
            href="/history"
          >
            History
          </Link>
          <Link
            activeClassName="text-accent-strong"
            className="text-muted font-semibold no-underline transition-colors hover:text-accent-strong"
            href="/settings"
          >
            Settings
          </Link>
          <Link
            activeClassName="text-accent-strong"
            className="text-muted font-semibold no-underline transition-colors hover:text-accent-strong"
            href="/account"
          >
            Account
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {!ready ? (
          <div className="rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card p-6 shadow-[0_18px_40px_rgba(29,25,18,0.12)]">
            Loading your daily word...
          </div>
        ) : (
          <PreactRouter>
            <Home path="/" />
            <History path="/history" user={user} />
            <Settings path="/settings" user={user} />
            <Account path="/account" user={user} onUserChange={setUser} />
          </PreactRouter>
        )}
      </main>
    </div>
  );
}
