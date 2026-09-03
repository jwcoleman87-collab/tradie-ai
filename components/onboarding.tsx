'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Globe2,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  Pencil,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { requestApi } from '@/lib/client';
import { MessageCopy } from './message-copy';
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
const factVisuals: Record<
  OnboardingField,
  { icon: LucideIcon; tone: 'yellow' | 'navy' | 'green' | 'orange' }
> = {
  display_name: { icon: Building2, tone: 'yellow' },
  website_url: { icon: Globe2, tone: 'navy' },
  base_location: { icon: MapPin, tone: 'green' },
  service_areas: { icon: Map, tone: 'green' },
  services: { icon: Wrench, tone: 'orange' },
  preferred_job_types: { icon: BriefcaseBusiness, tone: 'orange' },
  enquiry_channels: { icon: MessageCircle, tone: 'navy' },
  primary_goal: { icon: Target, tone: 'yellow' },
  admin_bottleneck: { icon: ClipboardList, tone: 'orange' },
  brand_summary: { icon: Sparkles, tone: 'navy' },
};
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
  const [allowAI, setAllowAI] = useState(false);
  const [editingFacts, setEditingFacts] = useState<Set<string>>(new Set());
  const chatRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (requestedWorkspaceId?: string) => {
      if (!session) return;
      setLoading(true);
      try {
        const workspaceId =
          requestedWorkspaceId ||
          new URLSearchParams(window.location.search).get('workspaceId') ||
          window.localStorage.getItem('workbench.workspaceId') ||
          '';
        const query = new URLSearchParams();
        if (workspaceId) query.set('workspaceId', workspaceId);
        const next = await requestApi<OnboardingSnapshot>(
          session.access_token,
          `onboarding?${query}`,
        );
        if (next.workspaceId)
          window.localStorage.setItem(
            'workbench.workspaceId',
            next.workspaceId,
          );
        setState(next);
      } catch (caught) {
        setError(messageOf(caught));
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

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
    setEditingFacts(new Set());
  }, [state]);

  useEffect(() => {
    if (!state?.messages.length) return;
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [state?.messages.length]);

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

  const changedFactCount = useMemo(
    () =>
      state?.facts.filter(
        (fact) =>
          (edits[fact.field_path] || '').trim() &&
          edits[fact.field_path].trim() !== displayValue(fact),
      ).length || 0,
    [edits, state?.facts],
  );

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
    if (state?.aiConsentRequired && !allowAI) {
      setError('Allow Chat to process your setup answers before continuing.');
      return;
    }
    await perform(async () => {
      const next = await requestApi<OnboardingSnapshot>(
        session.access_token,
        'onboarding/turn',
        'POST',
        {
          workspaceId: state?.workspaceId || null,
          answer: answer.trim(),
          allowAI: state?.aiConsentRequired ? allowAI : false,
        },
      );
      setState(next);
      setAnswer('');
      setAllowAI(false);
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
    const workspaceId = state.workspaceId;
    await perform(async () => {
      await requestApi(session.access_token, 'onboarding/confirm', 'POST', {
        workspaceId,
      });
      window.localStorage.setItem('workbench.workspaceId', workspaceId);
      router.push('/workspace');
    });
  }

  async function changeWorkspace(workspaceId: string) {
    window.localStorage.setItem('workbench.workspaceId', workspaceId);
    window.history.replaceState(
      null,
      '',
      `/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    await load(workspaceId);
  }

  function openWorkspace() {
    if (state?.workspaceId)
      window.localStorage.setItem('workbench.workspaceId', state.workspaceId);
    router.push('/workspace');
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
        <h1>Chat is opening your setup…</h1>
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
        <section className="onboarding-main" data-reviewing={reviewing}>
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
              <span className="section-label">CHAT</span>
              <h2>
                {state.onboardingStatus === 'confirmed'
                  ? 'Your Workbench is ready.'
                  : 'G’day. Let’s get started.'}
              </h2>
              <p className="magic-subtitle">
                I’ll stay with you while we set things up. Ask me anything.
              </p>
            </div>
          </div>

          {state.workspaces.length > 1 && (
            <label className="onboarding-workspace-switcher">
              <span>Business workspace</span>
              <select
                aria-label="Business workspace"
                value={state.workspaceId || ''}
                disabled={busy}
                onChange={(change) => void changeWorkspace(change.target.value)}
              >
                {state.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    {workspace.workspace_type === 'sandbox' ? ' · Sandbox' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="onboarding-context-row">
            <span className="magic-presence-status">
              <i aria-hidden="true" />
              {reviewing
                ? 'Chat is ready · profile ready when you are'
                : 'Chat is ready · conversation saved'}
            </span>
            <details>
              <summary>About this setup</summary>
              <p>{state.discovery.detail}</p>
              <p>
                Nothing is connected, sent, booked or published during setup.
              </p>
            </details>
          </div>

          {state.onboardingStatus !== 'confirmed' && (
            <>
              <div className="onboarding-chat" aria-live="polite" ref={chatRef}>
                {conversation.map((message) => (
                  <div
                    key={message.id}
                    className={`onboarding-message ${message.role}`}
                  >
                    <MessageCopy text={message.content} />
                  </div>
                ))}
                {busy && (
                  <div className="onboarding-message assistant thinking">
                    Chat is thinking…
                  </div>
                )}
              </div>
              <form
                className="onboarding-composer"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  void sendAnswer();
                }}
              >
                <Textarea
                  aria-label="Message Chat"
                  placeholder="Ask Chat anything or tell me about your business…"
                  value={answer}
                  maxLength={4000}
                  onChange={(change) => setAnswer(change.target.value)}
                  disabled={busy}
                />
                {state.aiConsentRequired && (
                  <label className="onboarding-ai-consent">
                    <input
                      type="checkbox"
                      checked={allowAI}
                      onChange={(change) => setAllowAI(change.target.checked)}
                    />
                    Allow Chat to process my setup answers using the configured
                    OpenAI or Anthropic provider. I can pause AI later.
                  </label>
                )}
                <div>
                  <span>
                    Chat remembers this setup conversation. Nothing connects or
                    publishes without your approval.
                  </span>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      answer.trim().length < 2 ||
                      (state.aiConsentRequired && !allowAI)
                    }
                  >
                    {busy ? 'Chat is thinking…' : 'Send to Chat'}{' '}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </form>
            </>
          )}
          {reviewing && (
            <div className="profile-review">
              <div className="profile-review-heading">
                <span className="profile-review-mark" aria-hidden="true">
                  <Sparkles size={22} />
                </span>
                <div>
                  <span className="section-label">YOUR BUSINESS SNAPSHOT</span>
                  <h3>Check what Chat learned.</h3>
                  <p>Tap Edit on anything that needs changing.</p>
                </div>
                <span className="profile-ready-count">
                  <CheckCircle2 size={15} /> {state.facts.length} details ready
                </span>
              </div>
              <div className="fact-grid">
                {state.facts.map((fact) => {
                  const visual = factVisuals[fact.field_path];
                  const Icon = visual.icon;
                  const editing = editingFacts.has(fact.id);
                  const ownerSupplied =
                    fact.source_type === 'owner_message' ||
                    fact.source_type === 'owner_correction';
                  return (
                    <article
                      className="fact-card"
                      data-tone={visual.tone}
                      key={fact.id}
                    >
                      <div className="fact-card-heading">
                        <span className="fact-card-icon" aria-hidden="true">
                          <Icon size={20} />
                        </span>
                        <div className="fact-card-copy">
                          <span className="fact-card-label">
                            {labels[fact.field_path]}
                          </span>
                          {!editing && (
                            <p className="fact-card-value">
                              {edits[fact.field_path] || displayValue(fact)}
                            </p>
                          )}
                        </div>
                        {state.onboardingStatus !== 'confirmed' && (
                          <button
                            type="button"
                            className="fact-edit-button"
                            aria-expanded={editing}
                            onClick={() =>
                              setEditingFacts((current) => {
                                const next = new Set(current);
                                if (next.has(fact.id)) next.delete(fact.id);
                                else next.add(fact.id);
                                return next;
                              })
                            }
                          >
                            {editing ? (
                              <Check size={14} />
                            ) : (
                              <Pencil size={14} />
                            )}
                            {editing ? 'Done' : 'Edit'}
                          </button>
                        )}
                      </div>
                      {editing && (
                        <Input
                          id={`fact-${fact.field_path}`}
                          aria-label={labels[fact.field_path]}
                          value={edits[fact.field_path] || ''}
                          disabled={busy}
                          onChange={(change) =>
                            setEdits((current) => ({
                              ...current,
                              [fact.field_path]: change.target.value,
                            }))
                          }
                        />
                      )}
                      <div className="fact-evidence">
                        <span className={`fact-state ${fact.fact_state}`}>
                          <CheckCircle2 size={12} />
                          {ownerSupplied
                            ? 'You supplied this'
                            : fact.fact_state === 'needs_confirmation'
                              ? 'Needs a check'
                              : 'Chat found this'}
                        </span>
                        {fact.source_url?.startsWith('http') && (
                          <a
                            href={fact.source_url}
                            target="_blank"
                            rel="noreferrer"
                            title={fact.source_label}
                          >
                            Open source <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {state.onboardingStatus === 'confirmed' ? (
                <div className="confirmed-panel">
                  <Check size={20} /> Profile confirmed.
                  <Button onClick={openWorkspace}>
                    Open my workspace <ArrowRight size={16} />
                  </Button>
                </div>
              ) : (
                <div className="review-actions">
                  <Button
                    variant="outline"
                    disabled={busy || changedFactCount === 0}
                    onClick={() => void saveCorrections()}
                  >
                    {changedFactCount
                      ? `Save ${changedFactCount} change${changedFactCount === 1 ? '' : 's'}`
                      : 'No changes to save'}
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
