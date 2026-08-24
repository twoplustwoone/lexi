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
import { Sheet } from './reader/Sheet';
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

  // Escape-to-close and the body scroll lock live on Sheet now. Running them
  // here as well left two effects fighting over document.body.style.overflow,
  // and whichever restored last could leave the page locked after closing.

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

  /* An underline, not a box — the hairline turns accent on focus. */
  const fieldClass =
    'w-full border-0 border-b border-ink/[0.16] bg-transparent pb-2 text-[16px] text-ink caret-accent outline-none placeholder:text-ink/[0.45] focus:border-accent';

  const googleBlock = (caption: string) => (
    <div>
      <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-accent">{caption}</div>
      {hasGoogleClientId ? (
        <div className="flex justify-center" ref={googleButtonRef} />
      ) : (
        <p className="m-0 text-[14px] leading-[1.55] text-ink/[0.6]">
          Google sign-in needs a client ID ending in .apps.googleusercontent.com.
        </p>
      )}
    </div>
  );

  const emailRow = (
    <div className="flex items-center justify-between border-b border-ink/[0.16] pb-2">
      <span className="text-[15px]">{email}</span>
      <button
        type="button"
        onClick={() => {
          setStage('email');
          setMethods(null);
          setStatus(null);
          setPassword('');
          setEmailCode('');
          setCodeSent(false);
        }}
        className="min-h-[44px] cursor-pointer text-[11px] uppercase tracking-[0.12em] text-accent"
      >
        Change
      </button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="auth-sheet-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="auth-sheet-title" className="m-0 font-display text-[25px] font-normal">
            Sign in or create account
          </h2>
          <p className="m-0 mt-1 text-[14px] leading-[1.55] text-ink/[0.65]">
            Keep your history, schedule, and preferences synced across devices.
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={onClose} aria-label="Close sign in">
          Close
        </Button>
      </div>

      {/* Status renders as one line, never in a bordered alert. */}
      {status ? <p className="m-0 mt-3 text-[14px] text-accent-strong">{status}</p> : null}

      {stage === 'email' ? (
        <div className="mt-6 grid gap-5">
          {googleBlock('Fastest option')}

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-ink/[0.5]">
            <span className="h-px flex-1 bg-ink/[0.16]" />
            <span>or</span>
            <span className="h-px flex-1 bg-ink/[0.16]" />
          </div>

          <form className="grid gap-4" onSubmit={handleEmailContinue}>
            <label className="grid gap-2">
              <span className="text-[10px] uppercase tracking-[0.16em] text-accent">
                Email address
              </span>
              <input
                className={fieldClass}
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.currentTarget.value)}
                required
              />
            </label>
            <Button type="submit" size="lg" block disabled={isFetching || !email.trim()}>
              {isFetching ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        </div>
      ) : (
        <div className="mt-6 grid gap-5">
          {emailRow}

          {stage === 'password' ? (
            <form className="grid gap-4" onSubmit={handlePasswordSubmit}>
              <label className="grid gap-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-accent">
                  Password
                </span>
                <input
                  className={fieldClass}
                  type="password"
                  value={password}
                  autoComplete={hasAccount ? 'current-password' : 'new-password'}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                />
              </label>
              <Button type="submit" size="lg" block disabled={isSubmitting}>
                {isSubmitting ? 'Working…' : actionLabel}
              </Button>
              <div className="flex flex-wrap items-center gap-3 text-[14px] text-ink/[0.65]">
                <span>
                  {hasAccount ? 'Prefer a code instead?' : 'Prefer not to set a password?'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStage('code');
                    setStatus(null);
                    setEmailCode('');
                    setCodeSent(false);
                  }}
                  className="min-h-[44px] cursor-pointer text-accent"
                >
                  Use email code
                </button>
              </div>
            </form>
          ) : (
            <form className="grid gap-4" onSubmit={handleCodeVerify}>
              {!codeSent ? (
                <Button
                  type="button"
                  size="lg"
                  block
                  onClick={handleCodeRequest}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending…' : 'Send code'}
                </Button>
              ) : (
                <>
                  <label className="grid gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-accent">
                      Enter code
                    </span>
                    <input
                      className={`${fieldClass} tabular text-[22px] tracking-[0.34em]`}
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.currentTarget.value)}
                      inputMode="numeric"
                      required
                    />
                  </label>
                  <Button
                    type="submit"
                    size="lg"
                    block
                    disabled={isSubmitting || !emailCode.trim()}
                  >
                    {isSubmitting ? 'Verifying…' : 'Verify code'}
                  </Button>
                  <div className="flex flex-wrap items-center gap-5 text-[14px]">
                    <button
                      type="button"
                      onClick={handleCodeRequest}
                      disabled={isSubmitting}
                      className="min-h-[44px] cursor-pointer text-accent disabled:opacity-45"
                    >
                      Resend code
                    </button>
                    {showPasswordOption ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStage('password');
                          setStatus(null);
                          setPassword('');
                        }}
                        className="min-h-[44px] cursor-pointer text-accent"
                      >
                        Use password
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </form>
          )}

          {googleBlock(
            methods?.methods.google
              ? 'Google is linked to this email.'
              : 'Prefer a one-tap sign-in?'
          )}
        </div>
      )}
    </Sheet>
  );
}
