'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { AISettings } from './ai-settings';
import { BrandMark } from './brand';
import { requestApi, type ClientConfig } from '@/lib/client';
import type { Snapshot } from '@/lib/contracts';
import { integrationBrands } from '@/lib/brands';
import {
  providerNames,
  type Provider,
  type ConnectionInfo,
  type PendingConnection,
  type AdsReport,
} from '@/lib/integrations';
type State = { connections: ConnectionInfo[]; pending: PendingConnection[] };
export function ConnectionsPanel({
  snapshot,
  config,
  token,
  onSaved,
}: {
  snapshot: Snapshot;
  config: ClientConfig;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState<AdsReport | null>(null),
    [checking, setChecking] = useState<Set<Provider>>(new Set()),
    [temporaryErrors, setTemporaryErrors] = useState<
      Partial<Record<Provider, string>>
    >({}),
    [managedProvider, setManagedProvider] = useState<Provider | null>(null);
  const autoChecked = useRef(new Set<string>());
  const workspaceId = snapshot.workspace.id,
    owner = snapshot.role === 'owner';
  const load = useCallback(async () => {
    const data = await requestApi<State>(
      token,
      `integrations?workspaceId=${workspaceId}`,
    );
    setState(data);
  }, [token, workspaceId]);
  useEffect(() => {
    let alive = true;
    requestApi<State>(token, `integrations?workspaceId=${workspaceId}`)
      .then((data) => {
        if (alive) setState(data);
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    return () => {
      alive = false;
    };
  }, [token, workspaceId]);
  useEffect(() => {
    if (!owner || !state) return;
    const stale = state.connections.filter(
      (connection) =>
        connection.connectionId &&
        connection.status === 'connected' &&
        (!connection.verifiedAt ||
          Date.now() - Date.parse(connection.verifiedAt) > 24 * 60 * 60 * 1000) &&
        !autoChecked.current.has(connection.connectionId),
    );
    if (!stale.length) return;
    stale.forEach((connection) =>
      autoChecked.current.add(connection.connectionId!),
    );
    setChecking((current) =>
      new Set([...current, ...stale.map((connection) => connection.provider)]),
    );
    void Promise.all(
      stale.map(async (connection) => {
        try {
          const result = await requestApi<{ connection: ConnectionInfo }>(
            token,
            'integrations/check',
            'POST',
            {
              workspaceId,
              provider: connection.provider,
              connectionId: connection.connectionId,
            },
          );
          return result.connection;
        } catch {
          setTemporaryErrors((current) => ({
            ...current,
            [connection.provider]:
              'Could not check right now. Your saved connection was not removed.',
          }));
          return null;
        }
      }),
    )
      .then((results) => {
        const updates = results.filter(Boolean) as ConnectionInfo[];
        if (updates.length)
          setState((current) =>
            current
              ? {
                  ...current,
                  connections: current.connections.map(
                    (connection) =>
                      updates.find(
                        (update) => update.provider === connection.provider,
                      ) || connection,
                  ),
                }
              : current,
          );
      })
      .finally(() =>
        setChecking((current) => {
          const next = new Set(current);
          stale.forEach((connection) => next.delete(connection.provider));
          return next;
        }),
      );
  }, [owner, state, token, workspaceId]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection request failed.');
    } finally {
      setBusy(false);
    }
  }
  async function startConnection(connection: ConnectionInfo) {
    const route =
      connection.provider === 'google_calendar'
        ? 'google/start'
        : `integrations/${connection.provider}/start`;
    const result = await requestApi<{ url: string }>(
      token,
      route,
      'POST',
      { workspaceId },
    );
    const target = new URL(result.url);
    const host =
      connection.provider === 'facebook'
        ? 'www.facebook.com'
        : 'accounts.google.com';
    if (
      target.protocol !== 'https:' ||
      target.hostname !== host ||
      target.username ||
      target.password
    )
      throw new Error('Invalid connection redirect.');
    window.location.assign(target.href);
  }
  async function checkConnection(connection: ConnectionInfo) {
    if (!connection.connectionId) return;
    setChecking((current) => new Set(current).add(connection.provider));
    setTemporaryErrors((current) => ({
      ...current,
      [connection.provider]: undefined,
    }));
    try {
      const result = await requestApi<{ connection: ConnectionInfo }>(
        token,
        'integrations/check',
        'POST',
        {
          workspaceId,
          provider: connection.provider,
          connectionId: connection.connectionId,
        },
      );
      setState((current) =>
        current
          ? {
              ...current,
              connections: current.connections.map((item) =>
                item.provider === result.connection.provider
                  ? result.connection
                  : item,
              ),
            }
          : current,
      );
    } catch (cause) {
      setTemporaryErrors((current) => ({
        ...current,
        [connection.provider]:
          cause instanceof Error
            ? cause.message
            : 'Could not check this connection right now.',
      }));
    } finally {
      setChecking((current) => {
        const next = new Set(current);
        next.delete(connection.provider);
        return next;
      });
    }
  }
  return (
    <div>
      <AISettings
        key={`${workspaceId}:${snapshot.workspace.ai_consent_at}:${snapshot.workspace.ai_primary_provider}:${snapshot.workspace.ai_allowed_providers.join(',')}:${snapshot.workspace.ai_fallback_enabled}`}
        workspace={snapshot.workspace}
        available={config.aiProviders}
        token={token}
        owner={owner}
        onSaved={onSaved}
      />
      <article className="action-card">
        <span className="section-label">LIVE WEB RESEARCH</span>
        <h3>
          {config.webSearchReady
            ? 'Ready when current facts matter'
            : 'Not enabled'}
        </h3>
        <p>
          {config.webSearchReady
            ? 'The central chat can search current public information through your allowed AI provider and will attach clickable sources. Search pages are treated as untrusted data.'
            : 'The site operator must enable web research before the central chat can verify current public information.'}
        </p>
        <p className="auth-hint">
          Workbench sends only a short public search query. It blocks queries
          that appear to contain credentials, contact details or private
          workspace identifiers. Provider search and token charges apply.
        </p>
      </article>
      <p className="auth-hint">
        External connections are private to this workspace. Connecting never
        posts, books or changes ad spending.
      </p>
      <p className="auth-hint brand-disclaimer">
        Service logos identify the account being connected; they do not imply
        endorsement.
      </p>
      {error && <p role="alert">{error}</p>}
      {!state && <output className="block">Loading connections…</output>}
      {state?.connections.map((c) => {
        const isChecking = checking.has(c.provider),
          checkDelayed = !!temporaryErrors[c.provider],
          isReady =
            c.configured &&
            c.status === 'connected' &&
            !!c.verifiedAt &&
            !checkDelayed,
          needsCheck = c.status === 'connected' && !c.verifiedAt,
          needsReconnect = c.status === 'reconnect_required',
          stateLabel = !c.configured
            ? 'Setup needed'
            : isChecking
              ? 'Checking connection…'
              : checkDelayed
                ? 'Connection check delayed'
                : isReady
                ? 'Connected and ready'
                : needsCheck
                  ? 'Saved connection — check needed'
                  : needsReconnect
                    ? 'Needs attention'
                    : 'Not connected';
        return (
          <article
            key={c.provider}
            className={`action-card provider-connection provider-${
              isReady ? 'ready' : needsReconnect ? 'attention' : 'idle'
            }`}
          >
            <div className="provider-connection-heading">
              <div className="brand-heading">
                <BrandMark brand={integrationBrands[c.provider]} />
                <h3>{providerNames[c.provider]}</h3>
              </div>
              <output className="connection-state">
                <span aria-hidden="true" className="connection-state-dot" />
                {stateLabel}
              </output>
            </div>
            {c.displayName && (
              <div className="connected-resource">
                <span>Connected account</span>
                <strong>{c.displayName}</strong>
                {c.externalId && c.externalId !== 'primary' && (
                  <small>{c.externalId}</small>
                )}
              </div>
            )}
            {c.verifiedAt && (
              <p className="auth-hint">
                Last checked {friendlyCheckedAt(c.verifiedAt)}
              </p>
            )}
            {temporaryErrors[c.provider] && (
              <output className="connection-temporary-note">
                {temporaryErrors[c.provider]}
              </output>
            )}
            <p>
              {c.provider === 'google_calendar'
                ? 'Create bookings only after you approve the exact event details.'
                : c.provider === 'facebook'
                  ? c.capabilities.includes('facebook.publish')
                    ? 'Ready to publish approved text, links or one photo to this Page.'
                    : 'The Page is paired. Publishing will unlock after the operator completes Meta approval.'
                  : 'Read-only campaign reporting. Workbench cannot create ads, change budgets or spend money.'}
            </p>
            {!c.configured && (
              <p className="auth-hint">
                The site operator still needs to configure this service.
              </p>
            )}
            <div className="button-row mt-3">
              {owner && (!c.connectionId || needsReconnect) && (
                <Button
                  size="sm"
                  disabled={busy || !c.configured}
                  onClick={() => act(() => startConnection(c))}
                >
                  {needsReconnect ? 'Reconnect' : 'Connect'}
                </Button>
              )}
              {owner && c.connectionId && c.status === 'connected' && (
                <Button
                  size="sm"
                  disabled={busy || isChecking}
                  onClick={() => checkConnection(c)}
                >
                  {isChecking ? 'Checking…' : 'Check connection'}
                </Button>
              )}
              {owner && c.connectionId && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={managedProvider === c.provider}
                  onClick={() =>
                    setManagedProvider((current) =>
                      current === c.provider ? null : c.provider,
                    )
                  }
                >
                  Manage
                </Button>
              )}
              {c.provider === 'google_ads' && isReady && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || isChecking}
                  onClick={() =>
                    act(async () => {
                      setReport(null);
                      setReport(
                        await requestApi<AdsReport>(
                          token,
                          `integrations/google_ads/report?workspaceId=${workspaceId}`,
                        ),
                      );
                      await load();
                    })
                  }
                >
                  View campaign report
                </Button>
              )}
            </div>
            {managedProvider === c.provider && c.connectionId && (
              <div className="connection-manage-panel">
                <p>
                  Switching accounts keeps this connection in place unless the
                  new connection completes successfully.
                </p>
                <div className="button-row">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !c.configured}
                    onClick={() => act(() => startConnection(c))}
                  >
                    Switch account
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await requestApi(
                          token,
                          'integrations/disconnect',
                          'POST',
                          {
                            workspaceId,
                            provider: c.provider,
                            connectionId: c.connectionId,
                          },
                        );
                        setManagedProvider(null);
                        setReport(null);
                        await load();
                        await onSaved();
                      })
                    }
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </article>
        );
      })}
      {owner &&
        state?.pending.map((candidate) => (
          <ResourcePicker
            key={candidate.id}
            candidate={candidate}
            disabled={busy}
            onSelect={(resourceId) =>
              act(async () => {
                await requestApi(token, 'integrations/select', 'POST', {
                  workspaceId,
                  candidateId: candidate.id,
                  resourceId,
                });
                setReport(null);
                await load();
                await onSaved();
              })
            }
          />
        ))}
      {report && (
        <article className="action-card">
          <h3>{report.account.name}</h3>
          <p>
            Last 30 days · {report.account.currency} · {report.account.timeZone}
          </p>
          <p className="auth-hint">
            Fetched {new Date(report.fetchedAt).toLocaleString()}. This report
            is not automatically sent to AI.{' '}
            {report.limited ? 'The result is limited to 100 campaigns.' : ''}
          </p>
          {!report.campaigns.length && (
            <p>No campaigns returned for this period.</p>
          )}
          {report.campaigns.map((c) => (
            <div className="action-details" key={c.id}>
              <strong>{c.name}</strong>
              <dl>
                <dt>Status</dt>
                <dd>{c.status}</dd>
                <dt>Impressions</dt>
                <dd>{c.impressions}</dd>
                <dt>Clicks</dt>
                <dd>{c.clicks}</dd>
                <dt>Cost</dt>
                <dd>{formatCost(c.costMicros, report.account.currency)}</dd>
                <dt>Conversions</dt>
                <dd>{c.conversions ?? 'Not reported'}</dd>
              </dl>
            </div>
          ))}
        </article>
      )}
    </div>
  );
}
function ResourcePicker({
  candidate,
  disabled,
  onSelect,
}: {
  candidate: PendingConnection;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [choice, setChoice] = useState('');
  return (
    <article className="action-card connection-form">
      <div className="brand-heading">
        <BrandMark brand={integrationBrands[candidate.provider]} />
        <h3>Choose your {providerNames[candidate.provider]}</h3>
      </div>
      <p>
        Nothing is connected until you select it. Expires{' '}
        {new Date(candidate.expiresAt).toLocaleTimeString()}.
      </p>
      <label>
        Account or Page
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose…</option>
          {candidate.resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.id})
            </option>
          ))}
        </select>
      </label>
      {candidate.limited && (
        <p className="auth-hint">
          The account list is limited. If yours is missing, check provider
          access before reconnecting.
        </p>
      )}
      <Button
        size="sm"
        disabled={
          disabled || !choice || Date.parse(candidate.expiresAt) <= Date.now()
        }
        onClick={() => onSelect(choice)}
      >
        Connect selected resource
      </Button>
    </article>
  );
}
function formatCost(micros: string, currency?: string) {
  const n = Number(micros);
  if (!Number.isSafeInteger(n) || !currency) return `${micros} micros`;
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
    }).format(n / 1000000);
  } catch {
    return `${n / 1000000} ${currency}`;
  }
}

function friendlyCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
