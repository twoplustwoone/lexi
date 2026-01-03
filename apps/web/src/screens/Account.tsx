import { useEffect, useRef, useState } from 'preact/hooks';

import {
  fetchMe,
  getClientType,
  loginEmailPassword,
  loginWithGoogle,
  logout,
  requestEmailCode,
  requestPhoneCode,
  sendAdminTestNotification,
  signUpEmailPassword,
  trackEvent,
  verifyEmailCode,
  verifyPhoneCode,
} from '../api';
import { getAnonymousId } from '../identity';

interface AccountProps {
  path?: string;
  user: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  };
  onUserChange: (next: {
    userId: string | null;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isAdmin: boolean;
  }) => void;
}

export function Account({ user, onUserChange }: AccountProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

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

  const reportAuthResult = (me: { is_authenticated: boolean }, successMessage: string): void => {
    if (me.is_authenticated) {
      setStatus(successMessage);
      return;
    }
    setStatus(
      'Signed in, but the session cookie was not stored. Ensure the app and API share the same origin.'
    );
  };

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleButtonRef.current) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.google?.accounts?.id) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          try {
            await trackEvent({
              event_name: 'auth_flow_started',
              timestamp: new Date().toISOString(),
              user_id: user.userId || getAnonymousId(),
              client: getClientType(),
              metadata: { method: 'google' },
            });
            await loginWithGoogle(response.credential);
            const me = await refreshUser();
            await trackEvent({
              event_name: 'auth_flow_completed',
              timestamp: new Date().toISOString(),
              user_id: user.userId || getAnonymousId(),
              client: getClientType(),
              metadata: { method: 'google' },
            });
            reportAuthResult(me, 'Signed in with Google.');
          } catch (error: unknown) {
            setStatus(getErrorMessage(error, 'Google sign-in failed.'));
          }
        },
      });
      const buttonEl = googleButtonRef.current;
      if (!buttonEl) {
        return;
      }
      window.google.accounts.id.renderButton(buttonEl, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
      });
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handleSignup = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_password' },
      });
      await signUpEmailPassword(email, password);
      const me = await refreshUser();
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_password' },
      });
      reportAuthResult(me, 'Account created.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Sign-up failed.'));
    }
  };

  const handleLogin = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_password' },
      });
      await loginEmailPassword(identifier, password);
      const me = await refreshUser();
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_password' },
      });
      reportAuthResult(me, 'Signed in successfully.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Login failed.'));
    }
  };

  const handleEmailCodeRequest = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await requestEmailCode(email);
      setStatus('Code sent to your email.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Could not send code.'));
    }
  };

  const handleEmailCodeVerify = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_code' },
      });
      await verifyEmailCode(email, emailCode);
      const me = await refreshUser();
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'email_code' },
      });
      reportAuthResult(me, 'Signed in with email code.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Invalid code.'));
    }
  };

  const handlePhoneCodeRequest = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await requestPhoneCode(phone);
      setStatus('Code sent via SMS.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Could not send SMS code.'));
    }
  };

  const handlePhoneCodeVerify = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'phone_code' },
      });
      await verifyPhoneCode(phone, phoneCode);
      const me = await refreshUser();
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: { method: 'phone_code' },
      });
      reportAuthResult(me, 'Signed in with phone code.');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Invalid code.'));
    }
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
  const inputClass =
    'rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

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

      {user.isAuthenticated ? null : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          <form className={`${cardBase} p-6`} onSubmit={handleLogin}>
            <h3 className="text-lg font-semibold">Sign in</h3>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Email or username</span>
              <input
                className={inputClass}
                value={identifier}
                autoComplete="username"
                onChange={(e) => setIdentifier(e.currentTarget.value)}
              />
            </label>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Password</span>
              <input
                className={inputClass}
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="submit"
            >
              Sign in
            </button>
          </form>

          <form className={`${cardBase} p-6`} onSubmit={handleSignup}>
            <h3 className="text-lg font-semibold">Email + Password</h3>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Email</span>
              <input
                className={inputClass}
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            </label>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Password (min 10 chars)</span>
              <input
                className={inputClass}
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="submit"
            >
              Create account
            </button>
          </form>

          <form className={`${cardBase} p-6`} onSubmit={handleEmailCodeRequest}>
            <h3 className="text-lg font-semibold">Email + Code</h3>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Email</span>
              <input
                className={inputClass}
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-accent/10 px-4 py-2 text-sm font-semibold text-accent-strong transition hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="submit"
            >
              Send code
            </button>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Code</span>
              <input
                className={inputClass}
                value={emailCode}
                onChange={(e) => setEmailCode(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="button"
              onClick={handleEmailCodeVerify}
            >
              Verify code
            </button>
          </form>

          <form className={`${cardBase} p-6`} onSubmit={handlePhoneCodeRequest}>
            <h3 className="text-lg font-semibold">Phone + SMS Code</h3>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Phone (E.164)</span>
              <input
                className={inputClass}
                value={phone}
                autoComplete="tel"
                onChange={(e) => setPhone(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-accent/10 px-4 py-2 text-sm font-semibold text-accent-strong transition hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="submit"
            >
              Send SMS
            </button>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-semibold">Code</span>
              <input
                className={inputClass}
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.currentTarget.value)}
              />
            </label>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              type="button"
              onClick={handlePhoneCodeVerify}
            >
              Verify code
            </button>
          </form>

          <div className={`${cardBase} p-6`}>
            <h3 className="text-lg font-semibold">Google</h3>
            <p className="mt-1 text-sm text-muted">
              Sign in with Google to keep your history across devices.
            </p>
            {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
              <div className="mt-4" ref={googleButtonRef} />
            ) : (
              <p className="mt-4 text-sm text-muted">Google sign-in requires a client ID.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
