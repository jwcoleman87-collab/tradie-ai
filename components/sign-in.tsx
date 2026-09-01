'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { requestApi } from '@/lib/client';
import type { OnboardingSnapshot } from '@/lib/contracts';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';

type AuthView = 'sign-in' | 'reset-request' | 'password-recovery';
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
    )
      setView('password-recovery');
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
      if (createAccount)
        setNotice(
          'Check your email to confirm your account. The confirmation link will bring you back to Magic onboarding.',
        );
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
      <section className="auth-brand-panel">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Back to Workbench
        </Link>
        <div className="auth-brand-copy">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={620}
            height={116}
            style={{ height: 'auto' }}
            priority
            unoptimized
          />
          <p className="eyebrow">YOUR BUSINESS. YOUR CREW. ONE PLACE.</p>
          <h1>
            You build it.
            <br />
            We handle the business.
          </h1>
          <p>
            Open your private workspace, or join the controlled pilot and let
            Magic learn the useful parts of your business with you.
          </p>
          <div className="auth-trust-note">
            <ShieldCheck size={20} />
            <span>External changes still wait for your clear approval.</span>
          </div>
        </div>
      </section>
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
          ) : (
            <form
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                void signIn(false);
              }}
            >
              <span className="section-label">SIGN IN OR START</span>
              <h2>G’day. Let’s open your Workbench.</h2>
              <p className="muted">
                Existing owners can sign in. New accounts enter the controlled
                pilot onboarding.
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
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || password.length < 10 || !email.trim()}
                  onClick={() => void signIn(true)}
                >
                  Join controlled pilot
                </Button>
              </div>
              <p className="auth-fine-print">
                New accounts require email confirmation. Use at least 10
                characters for your password.
              </p>
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
