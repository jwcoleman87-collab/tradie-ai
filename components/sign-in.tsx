'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { requestApi } from '@/lib/client';
import type { OnboardingSnapshot } from '@/lib/contracts';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';

type AuthView = 'sign-in' | 'sign-up' | 'reset-request' | 'password-recovery';
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'That did not work. Please try again.';

export default function SignIn() {
  const router = useRouter();
  const {
    config,
    session,
    client,
    event,
    loading,
    error: authError,
  } = useWorkbenchAuth();
  const [view, setView] = useState<AuthView>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [signupConfirmation, setSignupConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [routing, setRouting] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (
      url.searchParams.get('view') === 'recovery' ||
      hash.get('type') === 'recovery'
    ) {
      setView('password-recovery');
    } else if (url.searchParams.get('view') === 'signup') {
      setView('sign-up');
    }
  }, []);
  useEffect(() => {
    if (event === 'PASSWORD_RECOVERY') {
      setView('password-recovery');
      setPassword('');
      setConfirmation('');
      setNotice('Choose a new password for your Workbench account.');
    }
  }, [event]);

  const routeSignedInOwner = useCallback(async () => {
    if (!session || routing || view === 'password-recovery') return;
    setRouting(true);
    try {
      const next = new URL(window.location.href).searchParams.get('next');
      if (next === '/onboarding' || next === '/workspace') {
        router.replace(next);
        return;
      }
      const state = await requestApi<OnboardingSnapshot>(
        session.access_token,
        'onboarding',
      );
      router.replace(state.requiresOnboarding ? '/onboarding' : '/workspace');
    } catch (caught) {
      setError(messageOf(caught));
      setRouting(false);
    }
  }, [router, routing, session, view]);

  useEffect(() => {
    void routeSignedInOwner();
  }, [routeSignedInOwner]);

  async function perform(task: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await task();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(createAccount = false) {
    await perform(async () => {
      if (!client) throw Error('Workbench sign-in is not configured.');
      if (createAccount && password !== signupConfirmation)
        throw Error('The two passwords do not match.');
      const result = createAccount
        ? await client.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: new URL(
                '/onboarding',
                window.location.origin,
              ).toString(),
            },
          })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setPassword('');
      if (createAccount) {
        setSignupConfirmation('');
        setNotice(
          'Check your email to confirm your account. The confirmation link will bring you back to Chat onboarding.',
        );
      }
    });
  }

  async function requestReset() {
    await perform(async () => {
      if (!client) throw Error('Workbench sign-in is not configured.');
      const result = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: new URL(
          '/sign-in?view=recovery',
          window.location.origin,
        ).toString(),
      });
      if (result.error) throw result.error;
      setView('sign-in');
      setPassword('');
      setNotice(
        'If an account exists for that email, a password reset link is on its way.',
      );
    });
  }

  async function updatePassword() {
    await perform(async () => {
      if (!client) throw Error('Workbench sign-in is not configured.');
      if (password.length < 10)
        throw Error('Use at least 10 characters for your new password.');
      if (password !== confirmation)
        throw Error('The two passwords do not match.');
      const result = await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      const signOut = await client.auth.signOut({ scope: 'local' });
      if (signOut.error) throw signOut.error;
      setPassword('');
      setConfirmation('');
      setView('sign-in');
      window.history.replaceState({}, document.title, '/sign-in');
      setNotice('Password updated. Sign in with your new password.');
    });
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link href="/" aria-label="Workbench home">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={620}
            height={116}
            priority
            unoptimized
          />
        </Link>
        <Link href="/" className="back-link">
          <ArrowLeft size={15} /> Back
        </Link>
      </header>
      <section className="auth-form-panel">
        <div className="standalone-auth-form">
          <Image
            className="auth-mobile-mark"
            src="/workbench/mark.png"
            alt=""
            width={52}
            height={41}
            unoptimized
          />
          {loading || routing ? (
            <>
              <span className="section-label">WORKBENCH</span>
              <h2>
                {routing ? 'Opening your workspace…' : 'Checking sign-in…'}
              </h2>
              <p className="muted">One moment.</p>
            </>
          ) : !config?.configured ? (
            <>
              <span className="section-label">SETUP REQUIRED</span>
              <h2>Sign-in is not connected.</h2>
              <p className="muted">
                Workbench is not presenting sample access as a real account.
              </p>
            </>
          ) : view === 'password-recovery' ? (
            <form
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void updatePassword();
              }}
            >
              <span className="section-label">PASSWORD RECOVERY</span>
              <h2>Choose a new password.</h2>
              <p className="muted">
                Use at least 10 characters, then sign in again.
              </p>
              <label htmlFor="new-password">New password</label>
              <Input
                id="new-password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(change) => setPassword(change.target.value)}
                required
              />
              <label htmlFor="confirm-password">Confirm new password</label>
              <Input
                id="confirm-password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={confirmation}
                onChange={(change) => setConfirmation(change.target.value)}
                required
              />
              <Button
                className="auth-primary"
                type="submit"
                disabled={
                  busy || password.length < 10 || password !== confirmation
                }
              >
                Update password
              </Button>
            </form>
          ) : view === 'reset-request' ? (
            <form
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void requestReset();
              }}
            >
              <span className="section-label">PASSWORD RECOVERY</span>
              <h2>Reset your password.</h2>
              <p className="muted">
                We’ll send a secure link to your account email.
              </p>
              <label htmlFor="reset-email">Email</label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(change) => setEmail(change.target.value)}
                required
              />
              <div className="auth-actions">
                <Button type="submit" disabled={busy || !email.trim()}>
                  Send reset link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setView('sign-in')}
                >
                  Back to sign in
                </Button>
              </div>
              <p className="auth-fine-print">
                For privacy, the same confirmation appears whether or not an
                account exists.
              </p>
            </form>
          ) : view === 'sign-up' ? (
            <form
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void signIn(true);
              }}
            >
              <span className="section-label">WORKBENCH CHAT</span>
              <h2>Create your private Workbench.</h2>
              <p className="muted">
                One account step, then Chat will guide the setup.
              </p>
              <label htmlFor="account-email">Email</label>
              <Input
                id="account-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(change) => setEmail(change.target.value)}
                required
              />
              <label htmlFor="account-password">Password</label>
              <Input
                id="account-password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(change) => setPassword(change.target.value)}
                required
              />
              <label htmlFor="account-password-confirm">Confirm password</label>
              <Input
                id="account-password-confirm"
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={signupConfirmation}
                onChange={(change) =>
                  setSignupConfirmation(change.target.value)
                }
                required
              />
              <Button
                className="auth-primary"
                type="submit"
                disabled={
                  busy ||
                  password.length < 10 ||
                  !email.trim() ||
                  password !== signupConfirmation
                }
              >
                Continue to Chat
              </Button>
              <button
                className="auth-mode-switch"
                type="button"
                disabled={busy}
                onClick={() => setView('sign-in')}
              >
                Already have an account? Sign in
              </button>
              <p className="auth-fine-print">
                You’ll confirm your email before the private setup begins.
              </p>
            </form>
          ) : (
            <form
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void signIn(false);
              }}
            >
              <span className="section-label">WELCOME BACK</span>
              <h2>Open your Workbench.</h2>
              <label htmlFor="account-email">Email</label>
              <Input
                id="account-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(change) => setEmail(change.target.value)}
                required
              />
              <label htmlFor="account-password">Password</label>
              <Input
                id="account-password"
                type="password"
                minLength={10}
                autoComplete="current-password"
                value={password}
                onChange={(change) => setPassword(change.target.value)}
                required
              />
              <button
                className="auth-text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setView('reset-request');
                  setPassword('');
                }}
              >
                Forgot password?
              </button>
              <div className="auth-actions">
                <Button type="submit" disabled={busy}>
                  Sign in
                </Button>
              </div>
              <button
                className="auth-mode-switch"
                type="button"
                disabled={busy}
                onClick={() => setView('sign-up')}
              >
                New here? Start with Chat
              </button>
            </form>
          )}
          {(error || authError) && (
            <div className="form-alert" role="alert">
              {error || authError}
            </div>
          )}
          {notice && <output className="form-notice">{notice}</output>}
        </div>
      </section>
    </main>
  );
}
