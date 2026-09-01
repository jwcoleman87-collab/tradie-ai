'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ExternalLink,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { requestApi } from '@/lib/client';
import type {
  OnboardingFact,
  OnboardingField,
  OnboardingSnapshot,
} from '@/lib/contracts';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';

const labels: Record<OnboardingField, string> = {
  display_name: 'Business name',
  website_url: 'Website',
  base_location: 'Based in',
  service_areas: 'Service areas',
  services: 'Work you do',
  preferred_job_types: 'Work you want more of',
  enquiry_channels: 'Where enquiries arrive',
  primary_goal: 'First outcome',
  admin_bottleneck: 'Biggest admin bottleneck',
  brand_summary: 'Business summary',
};
const arrayFields = new Set<OnboardingField>([
  'service_areas',
  'services',
  'preferred_job_types',
  'enquiry_channels',
]);
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'That did not work. Please try again.';
const displayValue = (fact: OnboardingFact) =>
  Array.isArray(fact.value) ? fact.value.join(', ') : fact.value;

export default function Onboarding() {
  const router = useRouter();
  const {
    session,
    client,
    loading: authLoading,
    error: authError,
  } = useWorkbenchAuth();
  const [state, setState] = useState<OnboardingSnapshot | null>(null);
  const [answer, setAnswer] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const next = await requestApi<OnboardingSnapshot>(
        session.access_token,
        'onboarding',
      );
      setState(next);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      router.replace('/sign-in?next=/onboarding');
      return;
    }
    void load();
  }, [authLoading, load, router, session]);

  useEffect(() => {
    if (!state) return;
    setEdits(
      Object.fromEntries(
        state.facts.map((fact) => [fact.field_path, displayValue(fact)]),
      ),
    );
  }, [state]);

  const conversation = useMemo(() => {
    if (!state) return [];
    if (state.messages.length) return state.messages;
    if (!state.currentPrompt) return [];
    return [
      {
        id: 'opening-prompt',
        role: 'assistant' as const,
        content: state.currentPrompt,
        createdAt: '',
      },
    ];
  }, [state]);

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

  async function sendAnswer() {
    if (!session || !answer.trim()) return;
    await perform(async () => {
      const next = await requestApi<OnboardingSnapshot>(
        session.access_token,
        'onboarding/turn',
        'POST',
        { workspaceId: state?.workspaceId || null, answer: answer.trim() },
      );
      setState(next);
      setAnswer('');
    });
  }

  async function saveCorrections() {
    if (!session || !state?.workspaceId) return;
    const facts = state.facts
      .filter(
        (fact) =>
          (edits[fact.field_path] || '').trim() &&
          edits[fact.field_path].trim() !== displayValue(fact),
      )
      .map((fact) => ({
        fieldPath: fact.field_path,
        value: arrayFields.has(fact.field_path)
          ? edits[fact.field_path]
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : edits[fact.field_path].trim(),
      }));
    if (!facts.length) return;
    await perform(async () => {
      const next = await requestApi<OnboardingSnapshot>(
        session.access_token,
        'onboarding/profile',
        'PATCH',
        { workspaceId: state.workspaceId, facts },
      );
      setState(next);
    });
  }

  async function confirmProfile() {
    if (!session || !state?.workspaceId) return;
    await perform(async () => {
      await requestApi(session.access_token, 'onboarding/confirm', 'POST', {
        workspaceId: state.workspaceId,
      });
      router.push('/workspace');
    });
  }

  if (authLoading || loading || !state)
    return (
      <main className="onboarding-page onboarding-loading">
        <Image
          src="/workbench/mark.png"
          alt=""
          width={62}
          height={49}
          unoptimized
        />
        <h1>Magic is opening your setup…</h1>
        {(error || authError) && (
          <div className="form-alert">{error || authError}</div>
        )}
      </main>
    );

  const reviewing =
    state.onboardingStatus === 'review' ||
    state.onboardingStatus === 'confirmed';

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <Link href="/" aria-label="Workbench home">
          <Image
            src="/workbench/lockup.png"
            alt="Workbench"
            width={620}
            height={116}
            style={{ height: 'auto' }}
            priority
            unoptimized
          />
        </Link>
        <div className="onboarding-header-actions">
          <span className="private-pill">
            <ShieldCheck size={15} /> Private setup
          </span>
          <Button variant="ghost" onClick={() => void client?.auth.signOut()}>
            <LogOut size={15} /> Sign out
          </Button>
        </div>
      </header>

      <div className="onboarding-layout">
        <section className="onboarding-main">
          <div className="magic-heading">
            <div className="magic-avatar">
              <Image
                src="/workbench/mark.png"
                alt=""
                width={48}
                height={38}
                unoptimized
              />
            </div>
            <div>
              <span className="section-label">MAGIC</span>
              <h2>
                {reviewing
                  ? 'What Magic found'
                  : 'G’day. Let’s get your Workbench ready.'}
              </h2>
              <p className="magic-subtitle">
                {reviewing
                  ? 'Check the details before opening your workspace.'
                  : 'Answer naturally. Magic will guide the rest.'}
              </p>
            </div>
          </div>

          <div className="onboarding-context-row">
            <span>
              {reviewing
                ? 'Ready for your review'
                : state.promptCount
                  ? `${state.promptCount} answered · up to 5`
                  : 'A few simple questions'}
            </span>
            <details>
              <summary>About this setup</summary>
              <p>{state.discovery.detail}</p>
              <p>
                Nothing is connected, sent, booked or published during setup.
              </p>
            </details>
          </div>

          {!reviewing ? (
            <>
              <div className="onboarding-chat" aria-live="polite">
                {conversation.map((message) => (
                  <div
                    key={message.id}
                    className={`onboarding-message ${message.role}`}
                  >
                    {message.content}
                  </div>
                ))}
              </div>
              <form
                className="onboarding-composer"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  void sendAnswer();
                }}
              >
                <Textarea
                  aria-label="Your answer to Magic"
                  placeholder="Tell Magic in your own words…"
                  value={answer}
                  maxLength={4000}
                  onChange={(change) => setAnswer(change.target.value)}
                  disabled={busy}
                />
                <div>
                  <span>
                    Plain language is perfect. You can correct everything before
                    confirming.
                  </span>
                  <Button
                    type="submit"
                    disabled={busy || answer.trim().length < 2}
                  >
                    Send to Magic <ArrowRight size={16} />
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="profile-review">
              <div className="review-intro">
                <Sparkles size={20} />
                <p>
                  This draft uses your answers only. Check anything inferred,
                  make corrections, then confirm the profile.
                </p>
              </div>
              <div className="fact-grid">
                {state.facts.map((fact) => (
                  <article className="fact-card" key={fact.id}>
                    <div className="fact-card-heading">
                      <label htmlFor={`fact-${fact.field_path}`}>
                        {labels[fact.field_path]}
                      </label>
                      <span className={`fact-state ${fact.fact_state}`}>
                        {fact.fact_state.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <Input
                      id={`fact-${fact.field_path}`}
                      value={edits[fact.field_path] || ''}
                      disabled={busy || state.onboardingStatus === 'confirmed'}
                      onChange={(change) =>
                        setEdits((current) => ({
                          ...current,
                          [fact.field_path]: change.target.value,
                        }))
                      }
                    />
                    <div className="fact-evidence">
                      <span>{fact.confidence} confidence</span>
                      <span>Source: {fact.source_label}</span>
                      {fact.source_url?.startsWith('http') && (
                        <a
                          href={fact.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View source <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {state.onboardingStatus === 'confirmed' ? (
                <div className="confirmed-panel">
                  <Check size={20} /> Profile confirmed.
                  <Button onClick={() => router.push('/workspace')}>
                    Open my workspace <ArrowRight size={16} />
                  </Button>
                </div>
              ) : (
                <div className="review-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void saveCorrections()}
                  >
                    Save corrections
                  </Button>
                  <Button
                    disabled={busy || !state.facts.length}
                    onClick={() => void confirmProfile()}
                  >
                    Confirm and open Workbench <ArrowRight size={16} />
                  </Button>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="form-alert" role="alert">
              {error}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
