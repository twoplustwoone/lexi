import { useEffect, useRef, useState } from 'preact/hooks';

import {
  fetchMe,
  getAuthMethods,
  getClientType,
  loginEmailPassword,
  loginWithGoogle,
  requestEmailCode,
  signUpEmailPassword,
  trackEvent,
  verifyEmailCode,
  type AuthMethodsResponse,
} from '../api';
import { Button } from './Button';
import { Loader } from './Loader';
import { getAnonymousId } from '../identity';

interface AuthSheetProps {
  open: boolean;
  onClose: () => void;
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

type AuthStage = 'email' | 'password' | 'code';

export function AuthSheet({ open, onClose, user, onUserChange }: AuthSheetProps) {
  const [stage, setStage] = useState<AuthStage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [methods, setMethods] = useState<AuthMethodsResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleInitializedRef = useRef(false);
  const userIdRef = useRef<string | null>(user.userId);

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const hasGoogleClientId =
    typeof clientId === 'string' && clientId.includes('.apps.googleusercontent.com');

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

  useEffect(() => {
    userIdRef.current = user.userId;
  }, [user.userId]);

  const finalizeAuth = async () => {
    const me = await refreshUser();
    if (me.is_authenticated) {
      onClose();
      return;
    }
    setStatus(
      'Signed in, but the session cookie was not stored. Ensure the app and API share the same origin.'
    );
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setStage('email');
    setEmail('');
    setPassword('');
    setEmailCode('');
    setStatus(null);
    setMethods(null);
    setIsFetching(false);
    setIsSubmitting(false);
    setCodeSent(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !hasGoogleClientId || !googleButtonRef.current) {
      return;
    }

    const renderButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) {
        return;
      }
      googleButtonRef.current.innerHTML = '';
      if (!googleInitializedRef.current) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: { credential: string }) => {
            setStatus(null);
            setIsSubmitting(true);
            try {
              await trackEvent({
                event_name: 'auth_flow_started',
                timestamp: new Date().toISOString(),
                user_id: userIdRef.current || getAnonymousId(),
                client: getClientType(),
                metadata: { method: 'google' },
              });
              await loginWithGoogle(response.credential);
              await trackEvent({
                event_name: 'auth_flow_completed',
                timestamp: new Date().toISOString(),
                user_id: userIdRef.current || getAnonymousId(),
                client: getClientType(),
                metadata: { method: 'google' },
              });
              await finalizeAuth();
            } catch (error: unknown) {
              setStatus(getErrorMessage(error, 'Google sign-in failed.'));
            } finally {
              setIsSubmitting(false);
            }
          },
        });
        googleInitializedRef.current = true;
      }
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 280,
      });
    };

    if (window.google?.accounts?.id) {
      renderButton();
      return;
    }

    let script = document.querySelector('script[data-google-gsi]') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.setAttribute('data-google-gsi', 'true');
      document.body.appendChild(script);
    }

    const onLoad = () => renderButton();
    script.addEventListener('load', onLoad);
    return () => {
      script?.removeEventListener('load', onLoad);
    };
  }, [open, hasGoogleClientId, stage, clientId]);

  if (!open) {
    return null;
  }

  const canUsePassword = methods?.methods.password ?? false;
  const hasAccount = methods?.account_exists ?? false;
  const showPasswordOption = canUsePassword || !hasAccount;
  const actionLabel = hasAccount ? 'Sign in' : 'Create account';

  const handleEmailContinue = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    setIsFetching(true);
    try {
      const trimmed = email.trim();
      const response = await getAuthMethods(trimmed);
      setMethods(response);
      setEmail(trimmed);
      setStage(response.methods.password ? 'password' : 'code');
      setCodeSent(false);
      setEmailCode('');
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Unable to continue.'));
    } finally {
      setIsFetching(false);
    }
  };

  const handlePasswordSubmit = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: {
          method: 'email_password',
          intent: hasAccount ? 'signin' : 'signup',
        },
      });
      if (hasAccount) {
        await loginEmailPassword(email, password);
      } else {
        await signUpEmailPassword(email, password);
      }
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: {
          method: 'email_password',
          intent: hasAccount ? 'signin' : 'signup',
        },
      });
      await finalizeAuth();
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Password sign-in failed.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeRequest = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);
    try {
      await requestEmailCode(email);
      setStatus('Code sent to your email.');
      setCodeSent(true);
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Could not send code.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeVerify = async (event: Event) => {
    event.preventDefault();
    setStatus(null);
    setIsSubmitting(true);
    try {
      await trackEvent({
        event_name: 'auth_flow_started',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: {
          method: 'email_code',
          intent: hasAccount ? 'signin' : 'signup',
        },
      });
      await verifyEmailCode(email, emailCode);
      await trackEvent({
        event_name: 'auth_flow_completed',
        timestamp: new Date().toISOString(),
        user_id: user.userId || getAnonymousId(),
        client: getClientType(),
        metadata: {
          method: 'email_code',
          intent: hasAccount ? 'signin' : 'signup',
        },
      });
      await finalizeAuth();
    } catch (error: unknown) {
      setStatus(getErrorMessage(error, 'Invalid code.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[24px] border border-[rgba(30,27,22,0.12)] bg-card p-6 shadow-[0_24px_60px_rgba(29,25,18,0.25)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-[var(--font-display)] text-2xl">Sign in or create account</h2>
            <p className="mt-1 text-sm text-muted">
              Keep your history, schedule, and preferences synced across devices.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            radius="full"
            className="font-normal"
            onClick={onClose}
            aria-label="Close sign in"
          >
            Close
          </Button>
        </div>

        {status ? <p className="mt-4 text-sm text-accent-strong">{status}</p> : null}

        {stage === 'email' ? (
          <div className="mt-6 grid gap-5">
            <div className="rounded-2xl border border-dashed border-[rgba(30,27,22,0.2)] bg-white/60 px-4 py-4">
              <p className="text-sm text-muted">Fastest option</p>
              {hasGoogleClientId ? (
                <div className="mt-3 flex justify-center" ref={googleButtonRef} />
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Google sign-in needs a valid client ID ending in{' '}
                  <span className="font-semibold">.apps.googleusercontent.com</span>.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted">
              <span className="h-px flex-1 bg-[rgba(30,27,22,0.12)]" />
              <span>or</span>
              <span className="h-px flex-1 bg-[rgba(30,27,22,0.12)]" />
            </div>

            <form className="grid gap-4" onSubmit={handleEmailContinue}>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Email address</span>
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={isFetching || !email.trim()}>
                {isFetching ? <Loader label="Checking..." tone="light" /> : 'Continue'}
              </Button>
            </form>
          </div>
        ) : (
          <div className="mt-6 grid gap-5">
            <div className="flex items-center justify-between rounded-xl border border-[rgba(30,27,22,0.12)] bg-white/70 px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{email}</span>
              <Button
                variant="link"
                size="link"
                radius="none"
                className="text-xs uppercase tracking-[0.12em]"
                onClick={() => {
                  setStage('email');
                  setMethods(null);
                  setStatus(null);
                  setPassword('');
                  setEmailCode('');
                  setCodeSent(false);
                }}
              >
                Change
              </Button>
            </div>

            {stage === 'password' ? (
              <form className="grid gap-4" onSubmit={handlePasswordSubmit}>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold">Password</span>
                  <input
                    className={inputClass}
                    type="password"
                    value={password}
                    autoComplete={hasAccount ? 'current-password' : 'new-password'}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                  />
                </label>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader label="Working..." tone="light" /> : actionLabel}
                </Button>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                  <span>
                    {hasAccount ? 'Prefer a code instead?' : 'Prefer not to set a password?'}
                  </span>
                  <Button
                    variant="link"
                    size="link"
                    radius="none"
                    onClick={() => {
                      setStage('code');
                      setStatus(null);
                      setEmailCode('');
                      setCodeSent(false);
                    }}
                  >
                    Use email code
                  </Button>
                </div>
              </form>
            ) : (
              <form className="grid gap-4" onSubmit={handleCodeVerify}>
                {!codeSent ? (
                  <Button type="button" onClick={handleCodeRequest} disabled={isSubmitting}>
                    {isSubmitting ? <Loader label="Sending..." tone="light" /> : 'Send code'}
                  </Button>
                ) : (
                  <>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-semibold">Enter code</span>
                      <input
                        className={inputClass}
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.currentTarget.value)}
                        inputMode="numeric"
                        required
                      />
                    </label>
                    <Button type="submit" disabled={isSubmitting || !emailCode.trim()}>
                      {isSubmitting ? <Loader label="Verifying..." tone="light" /> : 'Verify code'}
                    </Button>
                    <Button
                      variant="link"
                      size="link"
                      radius="none"
                      className="text-left"
                      onClick={handleCodeRequest}
                      disabled={isSubmitting}
                    >
                      Resend code
                    </Button>
                  </>
                )}

                {showPasswordOption ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                    <span>Want to use a password instead?</span>
                    <Button
                      variant="link"
                      size="link"
                      radius="none"
                      onClick={() => {
                        setStage('password');
                        setStatus(null);
                        setPassword('');
                      }}
                    >
                      Use password
                    </Button>
                  </div>
                ) : null}
              </form>
            )}

            {hasGoogleClientId ? (
              <div className="rounded-2xl border border-dashed border-[rgba(30,27,22,0.2)] bg-white/60 px-4 py-4">
                <p className="text-sm text-muted">
                  {methods?.methods.google
                    ? 'Google is linked to this email.'
                    : 'Prefer a one-tap sign-in?'}
                </p>
                <div className="mt-3 flex justify-center" ref={googleButtonRef} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
