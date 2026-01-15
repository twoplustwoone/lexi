import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import PreactRouter, { useRouter } from 'preact-router';
import { Link } from 'preact-router/match';

import { fetchMe, getClientType, logout, registerAnonymousIdentity, trackEvent } from './api';
import { getAnonymousId } from './identity';
import { AuthSheet } from './components/AuthSheet';
import { Button } from './components/Button';
import { Loader } from './components/Loader';
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

function NavLinks() {
  const [router] = useRouter();
  const navRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const [indicatorReady, setIndicatorReady] = useState(false);
  const [indicatorAnimated, setIndicatorAnimated] = useState(false);
  const indicatorReadyRef = useRef(false);
  const fontsReadyRef = useRef(false);

  const markReady = () => {
    if (indicatorReadyRef.current) {
      return;
    }
    if (!fontsReadyRef.current) {
      return;
    }
    indicatorReadyRef.current = true;
    setIndicatorReady(true);
    requestAnimationFrame(() => setIndicatorAnimated(true));
  };

  const updateIndicator = () => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) {
      return false;
    }
    const active = nav.querySelector<HTMLElement>('.nav-active');
    if (!active) {
      return false;
    }
    const left = active.offsetLeft;
    const top = active.offsetTop;

    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.height = `${active.offsetHeight}px`;
    indicator.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    return true;
  };

  const queueUpdate = () => {
    requestAnimationFrame(() => {
      if (updateIndicator()) {
        markReady();
      }
    });
  };

  useLayoutEffect(() => {
    if (updateIndicator()) {
      markReady();
    }
  }, [router?.url]);

  useEffect(() => {
    const handleResize = () => queueUpdate();
    window.addEventListener('resize', handleResize);
    const finish = () => {
      fontsReadyRef.current = true;
      queueUpdate();
    };
    if ('fonts' in document && document.fonts?.ready) {
      if (document.fonts.status === 'loaded') {
        finish();
      } else {
        document.fonts.ready.then(finish).catch(finish);
      }
    } else {
      finish();
    }
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => queueUpdate());
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="relative flex w-full max-w-md items-center gap-1 rounded-full border border-[rgba(30,27,22,0.08)] bg-white/60 p-1 shadow-[0_4px_10px_rgba(29,25,18,0.06)] md:w-auto md:max-w-none md:flex-wrap md:gap-3 md:border md:border-[rgba(30,27,22,0.08)] md:bg-white/80 md:px-4 md:py-2 md:shadow-[0_12px_24px_rgba(29,25,18,0.1)]"
    >
      <span
        ref={indicatorRef}
        className={`pointer-events-none absolute left-0 top-0 z-0 hidden rounded-full bg-white shadow-[0_6px_12px_rgba(29,25,18,0.12)] md:block ${
          indicatorAnimated ? 'transition-[transform,width,height] duration-200 ease-out' : ''
        } ${indicatorReady ? 'opacity-100' : 'opacity-0'}`}
      />
      <Link
        activeClassName="nav-active bg-white text-accent-strong shadow-[0_3px_8px_rgba(29,25,18,0.12)] md:bg-transparent md:shadow-none"
        className="relative z-10 flex-1 rounded-full px-3 py-1.5 text-center text-sm font-semibold text-muted no-underline transition-colors hover:text-accent-strong md:flex-initial md:px-4 md:py-1.5 md:text-sm"
        href="/"
      >
        Home
      </Link>
      <Link
        activeClassName="nav-active bg-white text-accent-strong shadow-[0_3px_8px_rgba(29,25,18,0.12)] md:bg-transparent md:shadow-none"
        className="relative z-10 flex-1 rounded-full px-3 py-1.5 text-center text-sm font-semibold text-muted no-underline transition-colors hover:text-accent-strong md:flex-initial md:px-4 md:py-1.5 md:text-sm"
        href="/history"
      >
        History
      </Link>
    </nav>
  );
}

function AvatarMenu({
  user,
  onSignOut,
}: {
  user: UserState;
  onSignOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!user.isAuthenticated) {
    return null;
  }

  const initial = user.userId?.charAt(0)?.toUpperCase() ?? 'L';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[rgba(30,27,22,0.12)] bg-white text-sm font-semibold text-accent-strong shadow-[0_8px_18px_rgba(29,25,18,0.12)] transition hover:text-accent-strong/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={user.userId ?? 'Account'}
      >
        {initial}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-[rgba(30,27,22,0.12)] bg-white text-sm shadow-[0_16px_32px_rgba(29,25,18,0.12)]"
        >
          <Link
            href="/settings"
            className="block cursor-pointer px-4 py-2 font-semibold text-ink no-underline transition-colors hover:bg-sand"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button
            type="button"
            className="block w-full cursor-pointer px-4 py-2 text-left font-semibold text-ink transition-colors hover:bg-sand"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<UserState>({
    userId: null,
    isAuthenticated: false,
    isAnonymous: true,
    isAdmin: false,
  });
  const [ready, setReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const openAuth = () => setAuthOpen(true);
  const closeAuth = () => setAuthOpen(false);

  const refreshUser = async () => {
    try {
      const me = await fetchMe();
      setUser({
        userId: me.user_id,
        isAuthenticated: me.is_authenticated,
        isAnonymous: me.is_anonymous,
        isAdmin: me.is_admin,
      });
    } catch {
      setUser({
        userId: null,
        isAuthenticated: false,
        isAnonymous: true,
        isAdmin: false,
      });
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignore logout failures and try to refresh state.
    } finally {
      await refreshUser();
    }
  };

  const AuthAction = ({ className }: { className?: string }) =>
    user.isAuthenticated ? (
      <div className={className}>
        <AvatarMenu user={user} onSignOut={handleLogout} />
      </div>
    ) : (
      <div className={className}>
        <Button
          radius="full"
          className="shadow-[0_8px_18px_rgba(29,25,18,0.12)]"
          onClick={openAuth}
        >
          Sign in
        </Button>
      </div>
    );

  useEffect(() => {
    const init = async () => {
      try {
        await registerAnonymousIdentity();
        await refreshUser();
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
      <header className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
        <div className="flex items-center justify-between gap-4 md:justify-start">
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
          <AuthAction className="md:hidden" />
        </div>
        <div className="flex w-full justify-start md:justify-center">
          <NavLinks />
        </div>
        <AuthAction className="hidden md:flex md:justify-end" />
      </header>

      <main className="flex-1">
        {!ready ? (
          <div className="rounded-[20px] border border-[rgba(30,27,22,0.12)] bg-card p-6 shadow-[0_18px_40px_rgba(29,25,18,0.12)]">
            <Loader label="Loading your daily word..." />
          </div>
        ) : (
          <PreactRouter>
            <Home path="/" user={user} onOpenAuth={openAuth} />
            <History path="/history" user={user} />
            <Settings path="/settings" user={user} />
            <Account path="/account" user={user} onOpenAuth={openAuth} onUserChange={setUser} />
          </PreactRouter>
        )}
      </main>

      <AuthSheet open={authOpen} onClose={closeAuth} user={user} onUserChange={setUser} />
    </div>
  );
}
