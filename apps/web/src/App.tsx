import { useEffect, useState } from 'preact/hooks';
import PreactRouter, { getCurrentUrl, route } from 'preact-router';

import { fetchMe, getClientType, registerAnonymousIdentity, trackEvent } from './api';
import { getAnonymousId } from './identity';
import { AuthSheet } from './components/AuthSheet';
import { TabBar } from './components/reader/TabBar';
import { Words } from './screens/Words';
import { Search } from './screens/Search';
import { WordDetail } from './screens/WordDetail';
import { You } from './screens/You';
import { Admin } from './screens/Admin';

interface UserState {
  userId: string | null;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  isAdmin: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function NotFoundRedirect(_props: { path?: string }) {
  useEffect(() => {
    route('/', true);
  }, []);
  return null;
}

function AdminRoute({
  user,
  onOpenAuth,
  onUserChange,
}: {
  path?: string;
  user: UserState;
  onOpenAuth: () => void;
  onUserChange: (next: UserState) => void;
}) {
  useEffect(() => {
    if (!user.isAdmin) {
      route('/', true);
    }
  }, [user.isAdmin]);

  if (!user.isAdmin) {
    return null;
  }

  return <Admin user={user} onOpenAuth={onOpenAuth} onUserChange={onUserChange} />;
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
  // The router lives below the chrome, so the chrome tracks the route itself.
  const [path, setPath] = useState(() => getCurrentUrl());

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

  // Admin brings its own nav and its own ground, so the reader chrome steps
  // aside for it entirely.
  const isAdminRoute = path.startsWith('/admin');
  // Search and word detail are full-screen surfaces of the Words tab.
  const activeTab: 'words' | 'you' = path.startsWith('/you') ? 'you' : 'words';

  const router = (
    <PreactRouter onChange={(event) => setPath(event.url)}>
      <Words path="/" />
      <Search path="/search" />
      <WordDetail path="/word/:id" />
      <You path="/you" user={user} onOpenAuth={openAuth} onUserChange={setUser} />
      <AdminRoute path="/admin" user={user} onOpenAuth={openAuth} onUserChange={setUser} />
      <NotFoundRedirect path="/:rest*" />
    </PreactRouter>
  );

  // The router must wait for fetchMe: AdminRoute reads user.isAdmin, and on a
  // first paint that is still false, so rendering early bounces an admin
  // straight back to the stream.
  const loading = <p className="px-7 py-8 text-[16px] text-ink/[0.55]">Loading your words.</p>;

  if (isAdminRoute) {
    return (
      <>
        {ready ? router : loading}
        <AuthSheet open={authOpen} onClose={closeAuth} user={user} onUserChange={setUser} />
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-bg text-ink">
      <main className="flex min-h-0 flex-1 flex-col">{ready ? router : loading}</main>

      {/* Two destinations. Search and word detail keep Words active. */}
      <TabBar active={activeTab} />

      <AuthSheet open={authOpen} onClose={closeAuth} user={user} onUserChange={setUser} />
    </div>
  );
}
