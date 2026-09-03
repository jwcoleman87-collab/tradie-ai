'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ConnectionsPanel } from './connections-panel';
import { MessageCopy } from './message-copy';
import { BrandMark, BrandMentions } from './brand';
import { eligibleAIProviders, aiProviderLabel } from '@/lib/ai-settings';
import { aiBrands } from '@/lib/brands';
import { aiProblem } from '@/lib/ai-diagnostics';
import { chatBlockedReason, submitChat } from '@/lib/chat-client';
import {
  Wallet,
  Megaphone,
  Camera,
  Wrench,
  Globe,
  ShieldCheck,
  ArrowUp,
  Plus,
  LifeBuoy,
  CalendarDays,
  FileText,
  Check,
  X,
  LogOut,
  Archive,
  RotateCcw,
  Building2,
  Mic,
  ChevronDown,
} from 'lucide-react';
import { requestApi } from '@/lib/client';
import { useWorkbenchAuth } from '@/lib/use-workbench-auth';
import { workspaceNeedsOnboarding } from '@/lib/workspace-selection';
import { supportPayload } from '@/lib/server/privacy';
import type {
  Snapshot,
  Action,
  Escalation,
  Upload,
  AgentName,
} from '@/lib/contracts';

const team = [
  {
    id: 'finance',
    name: 'Finance',
    detail: 'Know where your money goes',
    icon: Wallet,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    detail: 'Keep the next job coming',
    icon: Megaphone,
  },
  {
    id: 'social',
    name: 'Social',
    detail: 'Turn good work into good stories',
    icon: Camera,
  },
  {
    id: 'maintenance',
    name: 'Maintenance',
    detail: 'Keep your gear working',
    icon: Wrench,
  },
  {
    id: 'website',
    name: 'Website',
    detail: 'Keep your business up to date',
    icon: Globe,
  },
];
const starters = [
  'When is my excavator due for a service?',
  'Make a social post from today’s job.',
  'Help me understand this invoice.',
  'Update the services on my website.',
];
const workspacePrimarySections = [
  { id: 'actions', label: 'To do', icon: Check },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'records', label: 'Records', icon: Building2 },
] as const;
const workspaceMoreSections = [
  { id: 'cases', label: 'Support', icon: LifeBuoy },
  { id: 'connections', label: 'Connections', icon: Globe },
  { id: 'archive', label: 'History', icon: Archive },
  { id: 'audit', label: 'Audit', icon: ShieldCheck },
] as const;
const workspaceHeadings: Record<
  string,
  { title: string; description: string }
> = {
  actions: {
    title: 'Ready for your say-so',
    description: 'Only work that still needs your attention.',
  },
  files: {
    title: 'Conversation files',
    description: 'Private files attached to this conversation.',
  },
  records: {
    title: 'Business records',
    description: 'Useful business memory kept separately from the chat.',
  },
  cases: {
    title: 'Support cases',
    description: 'Ask James without exposing the whole workspace.',
  },
  connections: {
    title: 'Connected accounts',
    description: 'Connections belong only to this workspace.',
  },
  archive: {
    title: 'History & archive',
    description: 'Closed work stays available without cluttering current work.',
  },
  audit: {
    title: 'Audit trail',
    description: 'Receipts for AI requests, approvals and workspace changes.',
  },
};
const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';
type AuthView = 'sign-in' | 'reset-request' | 'password-recovery';

export default function Workspace() {
  const {
    config,
    session,
    client,
    event: authEvent,
    loading: authLoading,
    error: authError,
  } = useWorkbenchAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [text, setText] = useState(''),
    [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [mobile, setMobile] = useState('chat'),
    [view, setView] = useState('actions'),
    [moreOpen, setMoreOpen] = useState(false),
    [authView, setAuthView] = useState<AuthView>('sign-in'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [passwordConfirmation, setPasswordConfirmation] = useState(''),
    [business, setBusiness] = useState('My business'),
    [workspaceName, setWorkspaceName] = useState(''),
    [newWorkspaceName, setNewWorkspaceName] = useState(''),
    [newWorkspaceType, setNewWorkspaceType] = useState<'business' | 'sandbox'>(
      'business',
    );
  const [problem, setProblem] = useState(''),
    [caseAgent, setCaseAgent] = useState<AgentName>('maintenance'),
    [category, setCategory] = useState('general'),
    [share, setShare] = useState(false);
  const clientRef = useRef<SupabaseClient | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    historyRef = useRef<HTMLDivElement>(null),
    loadSequence = useRef(0),
    scope = useRef({ workspaceId: '', conversationId: '' }),
    sendRequest = useRef<{ key: string; id: string } | null>(null),
    sending = useRef(false);
  const token = session?.access_token || '',
    workspaceId = snapshot?.workspace.id || '',
    owner = snapshot?.role === 'owner';
  const currentConversation = snapshot?.conversations.find(
      (conversation) => conversation.id === snapshot.conversationId,
    ),
    lifecycleBlockedReason =
      snapshot?.workspace.status === 'archived'
        ? 'This workspace is archived. Restore it to add new work.'
        : currentConversation?.status === 'archived'
          ? 'This conversation is archived. Restore it to add messages.'
          : '',
    blockedReason =
      lifecycleBlockedReason ||
      chatBlockedReason(
        !!session,
        snapshot?.workspace,
        config?.aiProviders,
        busy,
      );
  const canChat =
    authView !== 'password-recovery' &&
    !blockedReason &&
    !!snapshot?.conversationId;

  useEffect(() => {
    clientRef.current = client;
  }, [client]);
  useEffect(() => {
    if (authLoading) return;
    if (authError) {
      setError(authError);
      setLoading(false);
      return;
    }
    const recovering =
      authEvent === 'PASSWORD_RECOVERY' ||
      new URLSearchParams(window.location.hash.replace(/^#/, '')).get(
        'type',
      ) === 'recovery';
    if (recovering) {
      window.location.replace(`/sign-in?view=recovery${window.location.hash}`);
      return;
    }
    if (config?.configured && !session) {
      window.location.replace('/sign-in?next=/workspace');
      return;
    }
    if (!config?.configured) setLoading(false);
  }, [authError, authEvent, authLoading, config, session]);
  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get('calendar');
    const connectionState = new URLSearchParams(window.location.search).get(
      'connection',
    );
    if (connectionState || state) {
      setView('connections');
      setMoreOpen(true);
      setMobile('actions');
      if (connectionState)
        setNotice(
          'Review your connection status and choose the account or Page to finish connecting.',
        );
    }
    if (state)
      setNotice(
        state === 'connected'
          ? 'Google Calendar connected. Prepare a new booking to use this connection.'
          : 'Google Calendar connection was cancelled.',
      );
    return undefined;
  }, []);

  const refresh = useCallback(
    async (w = scope.current.workspaceId, c = scope.current.conversationId) => {
      if (!token) return;
      const seq = ++loadSequence.current;
      const query = new URLSearchParams();
      if (w) query.set('workspaceId', w);
      if (c) query.set('conversationId', c);
      const data = await requestApi<Snapshot>(token, `state?${query}`);
      if (seq !== loadSequence.current) return;
      if (data.workspace?.id)
        window.localStorage.setItem('workbench.workspaceId', data.workspace.id);
      if (
        !data.workspaces.length ||
        workspaceNeedsOnboarding(data.workspace, data.onboardingStatus)
      ) {
        const onboardingQuery = data.workspace?.id
          ? `?workspaceId=${encodeURIComponent(data.workspace.id)}`
          : '';
        window.location.replace(`/onboarding${onboardingQuery}`);
        return;
      }
      setSnapshot(data.workspaces.length ? data : null);
      setWorkspaceName(data.workspace?.name || '');
      scope.current = {
        workspaceId: data.workspace?.id || '',
        conversationId: data.conversationId || '',
      };
      setLoading(false);
    },
    [token],
  );
  useEffect(() => {
    if (token) {
      setLoading(true);
      const rememberedWorkspace = window.localStorage.getItem(
        'workbench.workspaceId',
      );
      void refresh(rememberedWorkspace || '').catch(async (e) => {
        if (rememberedWorkspace) {
          window.localStorage.removeItem('workbench.workspaceId');
          try {
            await refresh('', '');
            return;
          } catch (fallbackError) {
            setError(messageOf(fallbackError));
          }
        } else setError(messageOf(e));
        setLoading(false);
      });
    } else {
      setSnapshot(null);
      setLoading(false);
    } /* token refresh reloads persisted state */
  }, [token, refresh]);
  useEffect(() => {
    historyRef.current?.scrollTo({
      top: historyRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [snapshot?.messages.length, busy]);

  async function perform(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: { preventDefault(): void }, signUp = false) {
    event.preventDefault();
    await perform(async () => {
      const client = clientRef.current;
      if (!client) throw Error('Supabase is not configured.');
      const { error } = signUp
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
      if (error) throw error;
      setPassword('');
      if (signUp)
        setNotice(
          'Check your email to confirm your account, then sign in here.',
        );
    });
  }
  async function requestPasswordReset(event: { preventDefault(): void }) {
    event.preventDefault();
    await perform(async () => {
      const client = clientRef.current;
      if (!client) throw Error('Supabase is not configured.');
      const normalizedEmail = email.trim();
      if (!normalizedEmail) throw Error('Enter your email address first.');
      const { error } = await client.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: new URL(
            '/sign-in?view=recovery',
            window.location.origin,
          ).toString(),
        },
      );
      if (error) throw error;
      setAuthView('sign-in');
      setPassword('');
      setNotice(
        'If an account exists for that email, a password reset link is on its way.',
      );
    });
  }
  async function updatePassword(event: { preventDefault(): void }) {
    event.preventDefault();
    await perform(async () => {
      const client = clientRef.current;
      if (!client) throw Error('Supabase is not configured.');
      if (password.length < 10)
        throw Error('Use at least 10 characters for your new password.');
      if (password !== passwordConfirmation)
        throw Error('The two passwords do not match.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      const { error: signOutError } = await client.auth.signOut({
        scope: 'local',
      });
      if (signOutError) throw signOutError;
      setPassword('');
      setPasswordConfirmation('');
      setAuthView('sign-in');
      window.history.replaceState({}, document.title, window.location.pathname);
      setNotice('Password updated. Sign in with your new password.');
    });
  }
  async function send(event?: { preventDefault(): void }) {
    event?.preventDefault();
    if (
      sending.current ||
      !canChat ||
      !text.trim() ||
      !snapshot?.conversationId
    )
      return;
    sending.current = true;
    const key = JSON.stringify([
      workspaceId,
      snapshot.conversationId,
      text,
      selectedFiles,
    ]);
    if (sendRequest.current?.key !== key)
      sendRequest.current = { key, id: crypto.randomUUID() };
    try {
      await perform(async () => {
        try {
          const result = await submitChat(
            token,
            {
              workspaceId,
              conversationId: snapshot.conversationId,
              requestId: sendRequest.current!.id,
              text: text.trim(),
              attachmentIds: selectedFiles,
            },
            () => {
              setText('');
              setSelectedFiles([]);
              sendRequest.current = null;
            },
          );
          if (result.status === 'failed') {
            throw Error(
              `Your message is saved, but no reply was completed. ${aiProblem(result.error?.code)}${result.error?.code ? ` [${result.error.code}]` : ''}`,
            );
          }
          if (result.status === 'working') {
            setNotice(
              'The previous request is still running. Refresh in a moment.',
            );
            return;
          }
          setNotice(result.notice || '');
        } finally {
          try {
            await refresh();
          } catch {
            setNotice(
              'The conversation could not refresh. Your message receipt is unchanged; reload to see the latest history.',
            );
          }
        }
      });
    } finally {
      sending.current = false;
    }
  }
  async function upload(files: FileList | null) {
    if (!files || !snapshot?.conversationId) return;
    await perform(async () => {
      for (const file of Array.from(files).slice(0, 4)) {
        if (file.size > 10 * 1024 * 1024)
          throw Error('Each file must be 10 MB or less.');
        const query = new URLSearchParams({
          workspaceId,
          conversationId: snapshot.conversationId!,
          filename: file.name,
        });
        const response = await fetch(`/api/uploads?${query}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type':
              file.type ||
              (/\.csv$/i.test(file.name)
                ? 'text/csv'
                : /\.txt$/i.test(file.name)
                  ? 'text/plain'
                  : 'application/octet-stream'),
          },
          body: file,
        });
        const data = (await response.json()) as {
          id: string;
          error?: { message: string };
        };
        if (!response.ok)
          throw Error(data.error?.message || 'The upload failed.');
        setSelectedFiles((prev) => [...prev, data.id].slice(-4));
      }
      await refresh();
      setNotice(
        'Files saved privately. Selected attachments will be sent to your Workbench crew with your next message.',
      );
    });
    if (fileInput.current) fileInput.current.value = '';
  }
  async function decide(action: Action, decision: 'accept' | 'deny') {
    await perform(async () => {
      try {
        const result = await requestApi<Action>(
          token,
          `actions/${action.id}/decision`,
          'POST',
          {
            decision,
          },
        );
        if (result.status === 'approved')
          await requestApi(token, `actions/${action.id}/execute`, 'POST', {});
        else if (result.status === 'expired')
          setNotice(
            'This proposal expired. Ask your team to prepare a new one.',
          );
      } finally {
        await refresh();
      }
    });
  }
  const chooseView = (next: string) => {
    setView(next);
    setMoreOpen(workspaceMoreSections.some((section) => section.id === next));
    setMobile('actions');
  };
  const focusMagic = (starter = '') => {
    if (starter) setText((current) => current || starter);
    setMobile('chat');
    window.requestAnimationFrame(() => {
      document.getElementById('magic-message')?.focus();
    });
  };
  const activeActions =
      snapshot?.actions.filter((action) =>
        ['waiting_approval', 'approved', 'executing', 'failed'].includes(
          action.status,
        ),
      ) || [],
    activeAgents = snapshot?.runs[0]?.agents || [],
    actionHistory =
      snapshot?.actions.filter((action) =>
        ['completed', 'denied', 'expired'].includes(action.status),
      ) || [],
    activeRecords =
      snapshot?.records.filter((record) => record.status === 'active') || [],
    archivedRecords =
      snapshot?.records.filter((record) => record.status === 'archived') || [],
    activeCases =
      snapshot?.cases.filter((value) => value.status === 'open') || [],
    resolvedCases =
      snapshot?.cases.filter((value) => value.status === 'resolved') || [],
    activeConversations =
      snapshot?.conversations.filter(
        (conversation) => conversation.status === 'active',
      ) || [],
    archivedConversations =
      snapshot?.conversations.filter(
        (conversation) => conversation.status === 'archived',
      ) || [],
    activeWorkspaceHeading =
      workspaceHeadings[view] || workspaceHeadings.actions;
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Workbench home">
          <Image
            className="workbench-lockup"
            src="/workbench/lockup.png"
            alt="Workbench"
            width={212}
            height={40}
            unoptimized
            priority
          />
        </Link>
        <span className="top-tag">Your business. Your crew. One place.</span>
        <span className="privacy-badge">
          <ShieldCheck size={15} /> Private workspace
          {session && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() =>
                perform(async () => {
                  await clientRef.current?.auth.signOut();
                  setSnapshot(null);
                })
              }
            >
              <LogOut size={14} />
            </Button>
          )}
        </span>
      </header>
      <div className="workspace-grid" data-mobile={mobile}>
        <nav className="mobile-tabs" aria-label="Workspace panels">
          {['team', 'chat', 'actions'].map((t) => (
            <Button
              key={t}
              variant={mobile === t ? 'default' : 'ghost'}
              aria-current={mobile === t ? 'page' : undefined}
              onClick={() => setMobile(t)}
            >
              {t === 'team' ? 'Crew' : t === 'chat' ? 'Magic' : 'Workspace'}
            </Button>
          ))}
        </nav>
        <aside className="team-panel">
          <div className="crew-only-heading">
            <span className="section-label">YOUR AI CREW</span>
            <p>Pick a specialist for a focused request.</p>
          </div>
          <div className="team-list" aria-label="Your AI crew">
            {team.map(({ id, name, detail, icon: Icon }) => (
              <button
                type="button"
                className={`agent-card ${activeAgents.includes(id as AgentName) ? 'active' : ''}`}
                key={id}
                onClick={() => focusMagic(`Ask ${name} to help me with `)}
              >
                <span className="agent-icon">
                  <Icon size={17} />
                </span>
                <span className="crew-agent-copy">
                  <strong>{name}</strong>
                  <small>{detail}</small>
                </span>
                <span className="agent-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>
        <section className="conversation-panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">MAGIC CHAT</span>
              <h1>G’day. What can I get done?</h1>
            </div>
            <span className="status-pill">
              {busy
                ? 'Crew working…'
                : authView === 'password-recovery'
                  ? 'Password recovery'
                  : snapshot
                    ? snapshot.workspace.workspace_type === 'sandbox'
                      ? 'Sandbox · testing'
                      : `${snapshot.workspace.name} · Business`
                    : 'Setup & sign in'}
            </span>
          </div>
          {snapshot && authView !== 'password-recovery' && (
            <div className="conversation-toolbar">
              <select
                aria-label="Conversation history"
                className="workspace-select !mt-0 !w-auto max-w-[55%]"
                value={snapshot.conversationId || ''}
                disabled={busy}
                onChange={(e) =>
                  perform(async () => {
                    setSelectedFiles([]);
                    setText('');
                    await refresh(workspaceId, e.target.value);
                  })
                }
              >
                {!snapshot.conversationId && (
                  <option value="">No active conversation</option>
                )}
                <optgroup label="Active conversations">
                  {activeConversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversation.title} ·{' '}
                      {new Date(conversation.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </optgroup>
                {archivedConversations.length > 0 && (
                  <optgroup label="Archived conversations">
                    {archivedConversations.map((conversation) => (
                      <option key={conversation.id} value={conversation.id}>
                        {conversation.title} · Archived
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <Button
                variant="ghost"
                disabled={busy || snapshot.workspace.status === 'archived'}
                onClick={() =>
                  perform(async () => {
                    const c = await requestApi<{ id: string }>(
                      token,
                      'conversations',
                      'POST',
                      {
                        workspaceId,
                      },
                    );
                    setSelectedFiles([]);
                    setText('');
                    await refresh(workspaceId, c.id);
                  })
                }
              >
                <Plus size={14} /> New
              </Button>
              {currentConversation && owner && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const status =
                        currentConversation.status === 'active'
                          ? 'archived'
                          : 'active';
                      await requestApi(
                        token,
                        `conversations/${currentConversation.id}/status`,
                        'PATCH',
                        { workspaceId, status },
                      );
                      setSelectedFiles([]);
                      setText('');
                      await refresh(
                        workspaceId,
                        status === 'active' ? currentConversation.id : '',
                      );
                      setNotice(
                        status === 'active'
                          ? 'Conversation restored.'
                          : 'Conversation archived. Its messages, files and receipts remain available.',
                      );
                    })
                  }
                >
                  {currentConversation.status === 'active' ? (
                    <>
                      <Archive size={14} /> Archive
                    </>
                  ) : (
                    <>
                      <RotateCcw size={14} /> Restore
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => perform(() => refresh())}
              >
                Refresh
              </Button>
            </div>
          )}
          <div className="message-history" ref={historyRef}>
            {error && (
              <div className="error-notice" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <output className="setup-notice !mt-0 !mb-4 block">
                {notice}
              </output>
            )}
            {loading ? (
              <p className="muted">Opening your Workbench…</p>
            ) : authView === 'password-recovery' ? (
              <form className="auth-form" onSubmit={updatePassword}>
                <h2>Choose a new password</h2>
                <p className="muted">
                  Use at least 10 characters, then sign in again.
                </p>
                <label htmlFor="new-password">
                  New password
                  <Input
                    id="new-password"
                    type="password"
                    minLength={10}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <label htmlFor="confirm-new-password">
                  Confirm new password
                  <Input
                    id="confirm-new-password"
                    type="password"
                    minLength={10}
                    autoComplete="new-password"
                    value={passwordConfirmation}
                    onChange={(e) => setPasswordConfirmation(e.target.value)}
                    required
                  />
                </label>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    password.length < 10 ||
                    password !== passwordConfirmation
                  }
                >
                  Update password
                </Button>
              </form>
            ) : (
              <>
                {!snapshot?.messages.length && (
                  <>
                    <div className="welcome-mark">
                      <Image
                        src="/workbench/mark.png"
                        alt=""
                        width={50}
                        height={50}
                        unoptimized
                      />
                    </div>
                    <h2>Magic is ready.</h2>
                    <p className="muted">
                      Tell Workbench what needs doing. Your crew will sort out
                      who should handle it.
                      <br />
                      Simple, practical, under your control.
                    </p>
                  </>
                )}
                {config && !config.configured && (
                  <div className="setup-notice">
                    <h3>Your workspace is ready to connect.</h3>
                    <p>
                      Supabase must be configured before sign-in and private
                      storage are available. The AI and Google Calendar also
                      need their own service credentials. No sample data is
                      presented as your business data.
                    </p>
                    <p>
                      Required: Supabase URL, public key and server key; AI API
                      key; Google OAuth client and encryption key.
                    </p>
                    <BrandMentions text="Supabase and Google Calendar" />
                  </div>
                )}
                {config?.configured &&
                  !session &&
                  authView === 'reset-request' && (
                    <form className="auth-form" onSubmit={requestPasswordReset}>
                      <h2>Reset your password</h2>
                      <p className="muted">
                        Enter your account email and we’ll send a secure reset
                        link.
                      </p>
                      <label htmlFor="reset-email">
                        Email
                        <Input
                          id="reset-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </label>
                      <div className="button-row">
                        <Button type="submit" disabled={busy || !email.trim()}>
                          Send reset link
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setAuthView('sign-in');
                            setError('');
                            setNotice('');
                          }}
                        >
                          Back to sign in
                        </Button>
                      </div>
                      <p className="auth-hint">
                        For privacy, the same confirmation is shown whether or
                        not an account exists.
                      </p>
                    </form>
                  )}
                {config?.configured && !session && authView === 'sign-in' && (
                  <form className="auth-form" onSubmit={(e) => signIn(e)}>
                    <span className="section-label">MAGIC CHAT SETUP</span>
                    <h2>G’day. Let’s open your Workbench.</h2>
                    <p className="muted">
                      Sign in, or create an account and tell Magic about your
                      business.
                    </p>
                    <label htmlFor="account-email">
                      Email
                      <Input
                        id="account-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </label>
                    <label htmlFor="account-password">
                      Password
                      <Input
                        id="account-password"
                        type="password"
                        minLength={10}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </label>
                    <button
                      type="button"
                      className="auth-link"
                      disabled={busy}
                      onClick={() => {
                        setAuthView('reset-request');
                        setPassword('');
                        setError('');
                        setNotice('');
                      }}
                    >
                      Forgot password?
                    </button>
                    <div className="button-row">
                      <Button type="submit" disabled={busy}>
                        Sign in
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || password.length < 10 || !email}
                        onClick={(e) => signIn(e, true)}
                      >
                        Create account
                      </Button>
                    </div>
                    <p className="auth-hint">
                      New accounts require email confirmation. Use at least 10
                      characters for your password.
                    </p>
                  </form>
                )}
                {session && !snapshot && !loading && (
                  <form
                    className="auth-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        await requestApi(token, 'bootstrap', 'POST', {
                          name: business,
                        });
                        await refresh('', '');
                      });
                    }}
                  >
                    <span className="section-label">YOUR BUSINESS</span>
                    <h2>Tell Magic what you call the business.</h2>
                    <p className="muted">
                      Start with the name. The rest can be gathered naturally in
                      Magic Chat.
                    </p>
                    <label htmlFor="business-name">
                      Your business name
                      <Input
                        id="business-name"
                        value={business}
                        maxLength={120}
                        onChange={(e) => setBusiness(e.target.value)}
                        required
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
                      Create my Workbench
                    </Button>
                  </form>
                )}
                {snapshot && !snapshot.workspace.ai_consent_at && (
                  <div className="setup-notice">
                    <h3>Your choice before AI processing.</h3>
                    <p>
                      Choose OpenAI, Claude or both in Connections, and decide
                      whether a backup provider may process this workspace. No
                      AI request is sent until you allow it.
                    </p>
                    <BrandMentions text="OpenAI and Claude by Anthropic" />
                    {owner && (
                      <Button
                        className="mt-3"
                        disabled={busy}
                        onClick={() => chooseView('connections')}
                      >
                        Choose my AI providers
                      </Button>
                    )}
                  </div>
                )}
                {snapshot && !config?.aiReady && (
                  <div className="setup-notice">
                    Your records are connected. An OpenAI or Anthropic API key
                    is still needed to activate the team. Add both for backup.
                    <BrandMentions text="OpenAI and Anthropic" />
                  </div>
                )}
                {snapshot &&
                  config?.aiReady &&
                  snapshot.workspace.ai_consent_at &&
                  !eligibleAIProviders(snapshot.workspace, config.aiProviders)
                    .length && (
                    <div className="setup-notice">
                      No configured API provider matches this workspace’s
                      permissions.{' '}
                      <Button
                        variant="link"
                        onClick={() => chooseView('connections')}
                      >
                        Review AI connections
                      </Button>
                    </div>
                  )}
                {!snapshot?.messages.length && (
                  <div className="starter-grid">
                    {starters.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        className="starter"
                        disabled={!canChat}
                        onClick={() => setText(s)}
                      >
                        {s}
                      </Button>
                    ))}
                  </div>
                )}
                {(Boolean(snapshot?.messages.length) || busy) && (
                  <div
                    className="message-thread"
                    role="log"
                    aria-label="Conversation messages"
                    aria-live="polite"
                  >
                    {snapshot?.messages.map((m) => {
                      const attachments = m.attachment_ids
                        .map((id) =>
                          snapshot.uploads.find((file) => file.id === id),
                        )
                        .filter((file): file is Upload => Boolean(file));
                      return (
                        <article className={`message ${m.role}`} key={m.id}>
                          <span className="meta">
                            {m.role === 'user' ? 'You' : 'Magic + your crew'} ·{' '}
                            {new Date(m.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <MessageCopy text={m.content} />
                          <BrandMentions text={m.content} />
                          {m.attachment_ids.length > 0 && (
                            <div className="message-attachments">
                              {attachments.map((file) =>
                                isImageUpload(file) ? (
                                  <PrivateImagePreview
                                    key={file.id}
                                    file={file}
                                    token={token}
                                    variant="message"
                                  />
                                ) : (
                                  <span
                                    className="attachment-file"
                                    key={file.id}
                                  >
                                    <FileText size={13} /> {file.filename}
                                  </span>
                                ),
                              )}
                              {attachments.length === 0 && (
                                <span className="meta">
                                  {m.attachment_ids.length} private
                                  attachment(s)
                                </span>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {busy && (
                      <output className="pending-state block">
                        Working on your request…
                      </output>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <form className="composer" onSubmit={send}>
            <Textarea
              id="magic-message"
              aria-label="Message Magic"
              placeholder={blockedReason || 'Message Magic…'}
              aria-describedby="composer-help"
              value={text}
              maxLength={12000}
              disabled={!canChat}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {selectedFiles.length > 0 && (
              <div className="agent-tags">
                {selectedFiles.map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() =>
                      setSelectedFiles((p) => p.filter((f) => f !== id))
                    }
                  >
                    {snapshot?.uploads.find((f) => f.id === id)?.filename ||
                      'Attachment'}{' '}
                    ×
                  </button>
                ))}
              </div>
            )}
            <div className="composer-footer">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv,.csv,.txt"
                hidden
                onChange={(e) => upload(e.target.files)}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Attach files"
                disabled={!canChat}
                onClick={() => fileInput.current?.click()}
              >
                <Plus />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="voice-button"
                aria-label="Voice input is coming soon"
                title="Voice input is coming soon"
                disabled
              >
                <Mic />
              </Button>
              <span>You stay in control.</span>
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={!canChat || !text.trim()}
              >
                <ArrowUp />
              </Button>
            </div>
          </form>
          <output id="composer-help" className="composer-caption block">
            {blockedReason}
            {snapshot &&
              !busy &&
              blockedReason &&
              (owner ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => chooseView('connections')}
                >
                  Review AI settings
                </Button>
              ) : (
                <span> Ask your workspace owner to review AI settings.</span>
              ))}
          </output>
          <p className="composer-caption">
            Workbench prepares. You decide. Nothing external changes without
            your approval.
          </p>
        </section>
        <aside className="actions-panel">
          {snapshot && snapshot.workspaces.length > 1 && (
            <label className="workspace-switcher">
              <span>
                <Building2 size={14} /> Business workspace
              </span>
              <select
                aria-label="Business workspace"
                value={workspaceId}
                disabled={busy}
                onChange={(event) =>
                  perform(async () => {
                    setSelectedFiles([]);
                    setText('');
                    setNotice('');
                    await refresh(event.target.value, '');
                  })
                }
              >
                {snapshot.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    {workspace.workspace_type === 'sandbox' ? ' · Sandbox' : ''}
                    {workspace.status === 'archived' ? ' · Archived' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="workspace-panel-intro">
            <div className="section-label">
              {snapshot?.workspace.name || 'YOUR WORKSPACE'}
            </div>
            <h2>{activeWorkspaceHeading.title}</h2>
            <p className="muted small">{activeWorkspaceHeading.description}</p>
          </div>
          <nav className="workspace-simple-nav" aria-label="Workspace sections">
            {workspacePrimarySections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'active' : ''}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => chooseView(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              className={
                workspaceMoreSections.some((section) => section.id === view)
                  ? 'active'
                  : ''
              }
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Plus size={15} />
              <span>More</span>
            </button>
          </nav>
          {moreOpen && (
            <div className="workspace-more-nav">
              {workspaceMoreSections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={view === id ? 'active' : ''}
                  aria-current={view === id ? 'page' : undefined}
                  onClick={() => chooseView(id)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="workspace-view-body">
            {view === 'connections' &&
              snapshot &&
              snapshot.workspace.status === 'active' &&
              config && (
                <ConnectionsPanel
                  key={workspaceId}
                  snapshot={snapshot}
                  config={config}
                  token={token}
                  onSaved={refresh}
                />
              )}
            {view === 'connections' &&
              snapshot?.workspace.status === 'archived' && (
                <div className="empty-actions">
                  <Archive size={22} />
                  <h3>Workspace archived</h3>
                  <p>Restore it from Archive before changing connections.</p>
                </div>
              )}
            {view === 'connections' && !snapshot && (
              <p className="auth-hint">
                Sign in and create your private workspace to manage connections.
              </p>
            )}
            {view === 'audit' &&
              snapshot?.runs.map((run, runIndex) => (
                <article className="action-card" key={run.id}>
                  <h3>
                    {runIndex === 0 ? 'Latest AI request' : 'AI request'} ·{' '}
                    {run.status}
                  </h3>
                  <p className="auth-hint">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                  {run.status === 'failed' && (
                    <p>{aiProblem(run.error_code)}</p>
                  )}
                  {run.status === 'working' && (
                    <p>
                      Reply pending. No proposed actions have been executed.
                    </p>
                  )}
                  {run.provider_trace.map((r, i) => (
                    <div key={i} className="mt-2">
                      <div className="provider-trace-line">
                        <BrandMark brand={aiBrands[r.provider]} />
                        <p>
                          {aiProviderLabel(r.provider)} · {r.model} ·{' '}
                          {r.step || 'request'} · {r.status}
                          {r.errorCode ? ` (${r.errorCode})` : ''}
                        </p>
                      </div>
                      {(r.httpStatus || r.elapsedMs !== undefined) && (
                        <p className="auth-hint">
                          {r.httpStatus
                            ? `Provider HTTP ${r.httpStatus}`
                            : 'No provider HTTP response'}
                          {r.elapsedMs !== undefined
                            ? ` · ${(r.elapsedMs / 1000).toFixed(1)}s`
                            : ''}
                        </p>
                      )}
                      {r.providerRequestId && (
                        <p className="auth-hint break-all">
                          Provider reference: {r.providerRequestId}
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="auth-hint break-all mt-2">Request: {run.id}</p>
                </article>
              ))}
            {view === 'actions' && (
              <>
                {!activeActions.length && (
                  <div className="empty-actions">
                    <span className="agent-icon">
                      <CalendarDays size={23} />
                    </span>
                    <h3>You’re in control.</h3>
                    <p>
                      Proposed bookings, drafts and updates appear here. Review
                      the details, then Accept or Deny.
                    </p>
                    <span className="outline-pill">
                      Nothing awaiting approval
                    </span>
                  </div>
                )}
                {activeActions.map((a) => (
                  <ActionCard
                    key={a.id}
                    action={a}
                    token={token}
                    imageFile={snapshot?.uploads.find(
                      (file) => file.id === a.payload.imageFileId,
                    )}
                    disabled={
                      busy ||
                      !owner ||
                      snapshot?.workspace.status === 'archived'
                    }
                    onDecision={(d) => decide(a, d)}
                    onRetry={() =>
                      perform(async () => {
                        try {
                          await requestApi(
                            token,
                            `actions/${a.id}/execute`,
                            'POST',
                            {},
                          );
                        } finally {
                          await refresh();
                        }
                      })
                    }
                  />
                ))}
              </>
            )}
            {view === 'files' && (
              <div className="file-list">
                <p className="auth-hint">
                  Up to four files per message; 10 MB each. Select only the
                  files your team needs.
                </p>
                {!!snapshot?.uploads.length && (
                  <div className="file-grid">
                    {snapshot.uploads.map((f) => (
                      <FileCard
                        key={f.id}
                        file={f}
                        token={token}
                        selected={selectedFiles.includes(f.id)}
                        onSelect={() =>
                          setSelectedFiles((p) =>
                            p.includes(f.id)
                              ? p.filter((id) => id !== f.id)
                              : [...p, f.id].slice(-4),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
                {!snapshot?.uploads.length && (
                  <p className="muted mt-4">
                    Attach your first photo or document using +.
                  </p>
                )}
              </div>
            )}
            {view === 'records' && (
              <>
                {!activeRecords.length && (
                  <div className="empty-actions">
                    <h3>Start with what you know.</h3>
                    <p>
                      Tell your crew about a machine, customer, invoice or
                      service. Review and accept the proposed record to save it
                      here.
                    </p>
                  </div>
                )}
                {activeRecords.map((r) => (
                  <article className="action-card" key={r.id}>
                    <span className="section-label">
                      {r.kind} ·{' '}
                      {r.source === 'approved_ai_draft'
                        ? 'AI DRAFT'
                        : 'OWNER SUPPLIED'}
                    </span>
                    <h3>{r.title}</h3>
                    <p>{r.body}</p>
                    <BrandMentions text={`${r.title} ${r.body}`} />
                    {owner && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={
                          busy ||
                          r.legal_hold ||
                          snapshot?.workspace.status === 'archived'
                        }
                        onClick={() =>
                          perform(async () => {
                            await requestApi(
                              token,
                              `records/${r.id}/status`,
                              'PATCH',
                              {
                                workspaceId,
                                status: 'archived',
                              },
                            );
                            await refresh();
                          })
                        }
                      >
                        <Archive size={13} /> Archive record
                      </Button>
                    )}
                  </article>
                ))}
              </>
            )}
            {view === 'audit' && (
              <>
                {snapshot?.audit.map((a) => (
                  <div className="audit-item" key={a.id}>
                    {a.event.replaceAll('.', ' · ')}
                    {a.errorCode && (
                      <p>
                        {aiProblem(a.errorCode)} ({a.errorCode})
                      </p>
                    )}
                    <br />
                    <span className="muted">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
                {!snapshot?.audit.length && (
                  <p className="muted mt-4">
                    Your workspace receipts will appear here.
                  </p>
                )}
              </>
            )}
            {view === 'cases' && (
              <>
                <form
                  className="case-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      const c = await requestApi<Escalation>(
                        token,
                        'cases',
                        'POST',
                        {
                          workspaceId,
                          conversationId: snapshot?.conversationId || null,
                          agent: caseAgent,
                          category,
                          problem,
                          shareWithSupport: share,
                        },
                      );
                      setProblem('');
                      setShare(false);
                      setNotice(
                        `${c.case_id} saved. ${c.shared_with_support ? 'A limited summary is in the support queue. No email or conversation was sent.' : 'This case is private; it has not been sent to support.'}`,
                      );
                      await refresh();
                    });
                  }}
                >
                  <label className="auth-hint">
                    Agent
                    <select
                      aria-label="Case agent"
                      className="workspace-select !mt-1"
                      value={caseAgent}
                      onChange={(e) =>
                        setCaseAgent(e.target.value as AgentName)
                      }
                    >
                      {team.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <select
                    aria-label="Case category"
                    className="workspace-select !mt-0"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="general">General help</option>
                    <option value="missing_information">
                      Missing information or approval
                    </option>
                    <option value="integration_error">
                      Connection problem
                    </option>
                    <option value="safety_review">Safety review</option>
                  </select>
                  <Textarea
                    aria-label="Private problem description"
                    placeholder="What do you need help with? (kept private)"
                    value={problem}
                    maxLength={2000}
                    onChange={(e) => setProblem(e.target.value)}
                    required
                  />
                  <label className="auth-hint flex gap-2">
                    <input
                      type="checkbox"
                      checked={share}
                      onChange={(e) => setShare(e.target.checked)}
                    />
                    Share a limited summary with Ask James
                  </label>
                  {share && (
                    <p className="auth-hint">
                      Support sees: Case ID, {caseAgent},{' '}
                      {category.replaceAll('_', ' ')}, and “
                      {supportPayload('preview', caseAgent, category).problem}”
                      — no problem text, conversation or files.
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      !owner ||
                      busy ||
                      !problem.trim() ||
                      snapshot?.workspace.status === 'archived'
                    }
                  >
                    Create case
                  </Button>
                </form>
                {activeCases.map((c) => (
                  <CaseCard
                    key={c.id}
                    value={c}
                    disabled={!owner || busy}
                    onResolve={(solution, outcome) =>
                      perform(async () => {
                        await requestApi(token, `cases/${c.id}`, 'PATCH', {
                          solution,
                          outcome,
                        });
                        await refresh();
                      })
                    }
                  />
                ))}
              </>
            )}
            {view === 'archive' && snapshot && (
              <div className="archive-stack">
                <article className="archive-policy-card">
                  <Archive size={20} />
                  <div>
                    <h3>Archive, don’t delete</h3>
                    <p>
                      Archived work is read-only, searchable and restorable.
                      Approval and audit receipts are always retained
                      separately.
                    </p>
                  </div>
                </article>

                <section className="archive-section">
                  <span className="section-label">CURRENT WORKSPACE</span>
                  <form
                    className="archive-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(async () => {
                        await requestApi(
                          token,
                          `workspaces/${workspaceId}`,
                          'PATCH',
                          {
                            name: workspaceName,
                            workspaceType: snapshot.workspace.workspace_type,
                          },
                        );
                        await refresh();
                        setNotice('Workspace details saved.');
                      });
                    }}
                  >
                    <label htmlFor="current-workspace-name">
                      Workspace name
                      <Input
                        id="current-workspace-name"
                        value={workspaceName}
                        maxLength={120}
                        disabled={!owner || busy}
                        onChange={(event) =>
                          setWorkspaceName(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Purpose
                      <select
                        className="workspace-select !mt-1"
                        value={snapshot.workspace.workspace_type}
                        disabled={!owner || busy}
                        onChange={(event) =>
                          void perform(async () => {
                            await requestApi(
                              token,
                              `workspaces/${workspaceId}`,
                              'PATCH',
                              {
                                name: workspaceName || snapshot.workspace.name,
                                workspaceType: event.target.value,
                              },
                            );
                            await refresh();
                          })
                        }
                      >
                        <option value="business">Business operations</option>
                        <option value="sandbox">Sandbox / learning</option>
                      </select>
                    </label>
                    <div className="button-row">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!owner || busy || !workspaceName.trim()}
                      >
                        Save details
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!owner || busy}
                        onClick={() =>
                          perform(async () => {
                            const status =
                              snapshot.workspace.status === 'active'
                                ? 'archived'
                                : 'active';
                            await requestApi(
                              token,
                              `workspaces/${workspaceId}/status`,
                              'PATCH',
                              {
                                status,
                              },
                            );
                            await refresh(
                              status === 'active' ? workspaceId : '',
                              '',
                            );
                            setNotice(
                              status === 'active'
                                ? 'Workspace restored.'
                                : 'Workspace archived. Nothing was deleted.',
                            );
                          })
                        }
                      >
                        {snapshot.workspace.status === 'active' ? (
                          <>
                            <Archive size={14} /> Archive workspace
                          </>
                        ) : (
                          <>
                            <RotateCcw size={14} /> Restore workspace
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </section>

                <section className="archive-section">
                  <span className="section-label">NEW WORKSPACE</span>
                  <form
                    className="archive-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(async () => {
                        const created = await requestApi<{ id: string }>(
                          token,
                          'workspaces',
                          'POST',
                          {
                            name: newWorkspaceName,
                            workspaceType: newWorkspaceType,
                          },
                        );
                        setNewWorkspaceName('');
                        await refresh(created.id, '');
                        setNotice(
                          'Workspace created. Connections and private records start separate by design.',
                        );
                      });
                    }}
                  >
                    <label htmlFor="new-workspace-name">
                      Name
                      <Input
                        id="new-workspace-name"
                        placeholder="e.g. GreenVac"
                        value={newWorkspaceName}
                        maxLength={120}
                        disabled={!owner || busy}
                        onChange={(event) =>
                          setNewWorkspaceName(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Purpose
                      <select
                        className="workspace-select !mt-1"
                        value={newWorkspaceType}
                        disabled={!owner || busy}
                        onChange={(event) =>
                          setNewWorkspaceType(
                            event.target.value as 'business' | 'sandbox',
                          )
                        }
                      >
                        <option value="business">Business operations</option>
                        <option value="sandbox">Sandbox / learning</option>
                      </select>
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!owner || busy || !newWorkspaceName.trim()}
                    >
                      <Building2 size={14} /> Create separate workspace
                    </Button>
                  </form>
                </section>

                <section className="archive-section">
                  <span className="section-label">ARCHIVED CONVERSATIONS</span>
                  {!archivedConversations.length && (
                    <p className="auth-hint">No archived conversations.</p>
                  )}
                  {archivedConversations.map((conversation) => (
                    <article className="archive-row" key={conversation.id}>
                      <div>
                        <h3>{conversation.title}</h3>
                        <BrandMentions text={conversation.title} />
                        <p>
                          {new Date(
                            conversation.created_at,
                          ).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="button-row">
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              await refresh(workspaceId, conversation.id);
                              setMobile('chat');
                            })
                          }
                        >
                          Open read-only
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            !owner ||
                            busy ||
                            snapshot.workspace.status === 'archived'
                          }
                          onClick={() =>
                            perform(async () => {
                              await requestApi(
                                token,
                                `conversations/${conversation.id}/status`,
                                'PATCH',
                                { workspaceId, status: 'active' },
                              );
                              await refresh(workspaceId, conversation.id);
                            })
                          }
                        >
                          <RotateCcw size={13} /> Restore
                        </Button>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="archive-section">
                  <span className="section-label">ACTION HISTORY</span>
                  {!actionHistory.length && (
                    <p className="auth-hint">
                      No completed action history yet.
                    </p>
                  )}
                  {actionHistory.map((action) => (
                    <article className="archive-row" key={action.id}>
                      <div>
                        <h3>{action.summary}</h3>
                        <BrandMentions text={action.summary} />
                        <p>
                          {action.status.replaceAll('_', ' ')} ·{' '}
                          {new Date(action.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="archive-section">
                  <span className="section-label">ARCHIVED RECORDS</span>
                  {!archivedRecords.length && (
                    <p className="auth-hint">No archived business records.</p>
                  )}
                  {archivedRecords.map((record) => (
                    <article className="archive-row" key={record.id}>
                      <div>
                        <h3>{record.title}</h3>
                        <BrandMentions text={record.title} />
                        <p>
                          {record.kind} ·{' '}
                          {record.retention_class.replaceAll('_', ' ')}
                          {record.legal_hold ? ' · Legal hold' : ''}
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!owner || busy}
                        onClick={() =>
                          perform(async () => {
                            await requestApi(
                              token,
                              `records/${record.id}/status`,
                              'PATCH',
                              {
                                workspaceId,
                                status: 'active',
                              },
                            );
                            await refresh();
                          })
                        }
                      >
                        <RotateCcw size={13} /> Restore
                      </Button>
                    </article>
                  ))}
                </section>

                <section className="archive-section">
                  <span className="section-label">RESOLVED SUPPORT CASES</span>
                  {!resolvedCases.length && (
                    <p className="auth-hint">No resolved cases.</p>
                  )}
                  {resolvedCases.map((value) => (
                    <article className="archive-row" key={value.id}>
                      <div>
                        <h3>{value.case_id}</h3>
                        <p>{value.outcome || 'Resolved'}</p>
                        <BrandMentions text={value.outcome || ''} />
                      </div>
                    </article>
                  ))}
                </section>
              </div>
            )}
            {view === 'connections' && (
              <>
                <div className="connection-card mt-6">
                  <BrandMark brand="google_calendar" />
                  <div>
                    <h3>Google Calendar</h3>
                    <p>
                      {snapshot?.calendarConnected
                        ? 'Connected'
                        : 'Not connected'}
                    </p>
                  </div>
                  {snapshot && owner && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={
                        busy ||
                        !config?.googleReady ||
                        snapshot.workspace.status === 'archived'
                      }
                      onClick={() =>
                        perform(async () => {
                          if (snapshot.calendarConnected) {
                            await requestApi(
                              token,
                              'google/disconnect',
                              'POST',
                              {
                                workspaceId,
                              },
                            );
                            await refresh();
                          } else {
                            const result = await requestApi<{ url: string }>(
                              token,
                              'google/start',
                              'POST',
                              { workspaceId },
                            );
                            window.location.assign(result.url);
                          }
                        })
                      }
                    >
                      {snapshot.calendarConnected ? 'Disconnect' : 'Connect'}
                    </Button>
                  )}
                </div>
                {!config?.googleReady && (
                  <p className="auth-hint mt-2">
                    Google OAuth setup is required before connecting.
                  </p>
                )}
                <div className="how-it-works">
                  <span>01</span>
                  <p>Tell us what you need</p>
                  <span>02</span>
                  <p>Your team prepares it</p>
                  <span>03</span>
                  <p>You review and approve</p>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ActionCard({
  action: a,
  token,
  imageFile,
  disabled,
  onDecision,
  onRetry,
}: {
  action: Action;
  token: string;
  imageFile?: Upload;
  disabled: boolean;
  onDecision: (d: 'accept' | 'deny') => void;
  onRetry: () => void;
}) {
  const storageKey = `workbench:action-card:${a.id}:open`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(storageKey) === 'true');
    } catch {
      // The card still works for this session when browser storage is blocked.
    }
  }, [storageKey]);

  const calendar = a.action_type === 'calendar.create',
    facebook = a.action_type === 'facebook.publish',
    expired = Date.parse(a.expires_at) <= Date.now();
  const brandText = [
    calendar ? 'Google Calendar' : facebook ? 'Facebook' : '',
    a.summary,
    ...Object.values(a.payload).filter(
      (value): value is string => typeof value === 'string',
    ),
  ].join(' ');
  return (
    <details
      className="action-card collapsible-action-card"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        try {
          window.localStorage.setItem(storageKey, String(nextOpen));
        } catch {
          // The in-memory state still keeps the card open until it is minimised.
        }
      }}
    >
      <summary className="action-card-summary">
        <div className="action-card-summary-main">
          <span className="section-label">
            {a.agent} · {a.status.replaceAll('_', ' ')}
          </span>
          <BrandMentions text={brandText} />
          <h3 className="mt-2">{a.summary}</h3>
        </div>
        <span className="action-card-toggle-hint" aria-hidden="true">
          <span>{open ? 'Minimise' : 'Open'}</span>
          <ChevronDown size={16} />
        </span>
      </summary>
      <div className="action-card-content">
        <div className="action-details">
          {calendar ? (
            <dl>
              <dt>Calendar</dt>
              <dd>Primary calendar of the connected account</dd>
              <dt>Event</dt>
              <dd>{String(a.payload.summary)}</dd>
              <dt>Starts</dt>
              <dd>{String(a.payload.start)}</dd>
              <dt>Ends</dt>
              <dd>{String(a.payload.end)}</dd>
              <dt>Time zone</dt>
              <dd>{String(a.payload.timeZone)}</dd>
              <dt>Description</dt>
              <dd>
                {typeof a.payload.description === 'string'
                  ? a.payload.description
                  : 'No description'}
              </dd>
            </dl>
          ) : facebook ? (
            <>
              <dl>
                <dt>Facebook Page ID</dt>
                <dd>{String(a.payload.pageId)}</dd>
                <dt>Exact post</dt>
                <dd className="whitespace-pre-wrap">
                  {String(a.payload.message)}
                </dd>
                {typeof a.payload.link === 'string' && (
                  <>
                    <dt>Link</dt>
                    <dd className="break-all">{a.payload.link}</dd>
                  </>
                )}
                {typeof a.payload.imageFileId === 'string' && (
                  <>
                    <dt>Selected photo</dt>
                    <dd>{imageFile?.filename || 'Private workspace image'}</dd>
                  </>
                )}
              </dl>
              {typeof a.payload.imageFileId === 'string' && imageFile && (
                <FacebookImagePreview file={imageFile} token={token} />
              )}
              <p className="auth-hint">
                Accept publishes this exact caption
                {typeof a.payload.imageFileId === 'string'
                  ? ' and selected photo'
                  : '/link'}{' '}
                immediately to the selected Page. It is not a private draft.
              </p>
            </>
          ) : (
            <>
              <strong>{String(a.payload.title)}</strong>
              <p>{String(a.payload.body)}</p>
              {typeof a.payload.imageFileId === 'string' && imageFile && (
                <PrivateImagePreview
                  file={imageFile}
                  token={token}
                  variant="feature"
                />
              )}
              <span className="auth-hint">
                {a.action_type === 'draft.save'
                  ? 'Accept saves this draft privately. It will not publish or send.'
                  : 'Accept adds this owner-supplied record to your business memory.'}
              </span>
            </>
          )}
        </div>
        {a.status === 'waiting_approval' && (
          <>
            <p className="auth-hint">
              {expired
                ? 'This proposal has expired.'
                : `Approval expires ${new Date(a.expires_at).toLocaleString()}.`}
            </p>
            <div className="action-buttons">
              <Button
                variant="outline"
                disabled={disabled || expired}
                onClick={() => onDecision('deny')}
              >
                <X size={14} /> Deny
              </Button>
              <Button
                disabled={disabled || expired}
                onClick={() => onDecision('accept')}
              >
                <Check size={14} />{' '}
                {facebook ? 'Publish to Facebook' : 'Accept'}
              </Button>
            </div>
          </>
        )}
        {a.status === 'completed' && (
          <p className="ready-badge">
            {calendar
              ? 'Booking confirmed.'
              : facebook
                ? 'Published to Facebook.'
                : 'Saved privately.'}
          </p>
        )}
        {a.error_code && (
          <output className="block">
            {a.error_code === 'PUBLICATION_UNCERTAIN'
              ? 'Facebook may already have published this post. Automatic retry is blocked. Check the Page and Ask James before creating a replacement.'
              : `Action not completed (${a.error_code}). Check the connection before retrying.`}
          </output>
        )}
        {a.error_code !== 'PUBLICATION_UNCERTAIN' &&
          ['approved', 'failed', 'executing'].includes(a.status) && (
            <Button variant="outline" disabled={disabled} onClick={onRetry}>
              {a.status === 'executing'
                ? 'Check / resume safely'
                : 'Retry approved action'}
            </Button>
          )}
        {typeof a.execution_result?.url === 'string' &&
          /^https:\/\/(www\.google\.com\/calendar\/|calendar\.google\.com\/|www\.facebook\.com\/\d+_\d+$)/.test(
            a.execution_result.url,
          ) && (
            <a
              href={a.execution_result.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs mt-3 underline"
            >
              {facebook ? 'Open published post' : 'Open calendar booking'}
            </a>
          )}
      </div>
    </details>
  );
}

function FacebookImagePreview({
  file,
  token,
}: {
  file: Upload;
  token: string;
}) {
  return <PrivateImagePreview file={file} token={token} variant="feature" />;
}

function isImageUpload(file: Upload) {
  return file.mime_type.startsWith('image/');
}

function PrivateImagePreview({
  file,
  token,
  variant = 'thumbnail',
}: {
  file: Upload;
  token: string;
  variant?: 'thumbnail' | 'feature' | 'message';
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const loadPreview = useCallback(async () => {
    try {
      const result = await requestApi<{ signedUrl: string }>(
        token,
        `uploads/${file.id}/url?preview=1`,
      );
      setUrl(result.signedUrl);
      setError('');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [file.id, token]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  if (error)
    return (
      <div className={`private-image-fallback ${variant}`} role="alert">
        <Camera size={20} />
        <span>Private image preview unavailable</span>
      </div>
    );
  if (!url)
    return (
      <div className={`private-image-loading ${variant}`}>Loading image…</div>
    );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void loadPreview();
      }}
    >
      <DialogTrigger
        className={`private-image-trigger ${variant}`}
        aria-label={`Open a larger preview of ${file.filename}`}
      >
        {/* Private storage URLs are short-lived and cannot be configured as stable image hosts. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.filename} />
        <span>View larger</span>
      </DialogTrigger>
      <DialogContent className="private-image-dialog">
        <DialogHeader>
          <DialogTitle className="break-all">{file.filename}</DialogTitle>
          <DialogDescription>
            Private image · {Math.ceil(file.size_bytes / 1024)} KB
          </DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="private-image-full"
          src={url}
          alt={`Large preview of ${file.filename}`}
        />
      </DialogContent>
    </Dialog>
  );
}

function FileCard({
  file,
  token,
  selected,
  onSelect,
}: {
  file: Upload;
  token: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const image = isImageUpload(file);
  return (
    <article
      className={`action-card file-card ${image ? 'image-file-card' : ''}`}
    >
      {image ? (
        <PrivateImagePreview file={file} token={token} />
      ) : (
        <FileText size={17} />
      )}
      <h3 className="mt-2 break-all">{file.filename}</h3>
      <BrandMentions text={file.filename} />
      <p>{Math.ceil(file.size_bytes / 1024)} KB · Private</p>
      <div className="button-row">
        <Button
          size="xs"
          variant={selected ? 'default' : 'outline'}
          onClick={onSelect}
        >
          {selected ? 'Attached to next message' : 'Attach to message'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={async () => {
            try {
              const r = await requestApi<{ signedUrl: string }>(
                token,
                `uploads/${file.id}/url`,
              );
              setUrl(r.signedUrl);
              setError('');
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        >
          Get download link
        </Button>
      </div>
      {url && (
        <a
          className="text-xs underline block mt-2"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Download (link expires in 60 seconds)
        </a>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function CaseCard({
  value: c,
  disabled,
  onResolve,
}: {
  value: Escalation;
  disabled: boolean;
  onResolve: (s: string, o: string) => void;
}) {
  const [solution, setSolution] = useState(''),
    [outcome, setOutcome] = useState('');
  return (
    <article className="action-card">
      <span className="section-label">
        {c.case_id} · {c.status}
      </span>
      <p>
        {c.shared_with_support
          ? 'Limited summary shared'
          : 'Private case — not shared'}
      </p>
      <h3>Problem</h3>
      <p>{c.problem}</p>
      {c.status === 'resolved' ? (
        <>
          <h3>Solution</h3>
          <p>{c.solution}</p>
          <h3>Outcome</h3>
          <p>{c.outcome}</p>
        </>
      ) : (
        <form
          className="case-form"
          onSubmit={(e) => {
            e.preventDefault();
            onResolve(solution, outcome);
          }}
        >
          <Textarea
            placeholder="Solution (private)"
            aria-label={`Solution for ${c.case_id}`}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            maxLength={2000}
            required
          />
          <Textarea
            placeholder="Outcome (private)"
            aria-label={`Outcome for ${c.case_id}`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            maxLength={2000}
            required
          />
          <Button size="sm" variant="outline" disabled={disabled}>
            Record resolution
          </Button>
        </form>
      )}
    </article>
  );
}
