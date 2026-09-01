'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { AISettings } from './ai-settings';
import { requestApi, type ClientConfig } from '@/lib/client';
import type { Snapshot } from '@/lib/contracts';
import {
  providerNames,
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
    [report, setReport] = useState<AdsReport | null>(null);
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
      <p className="auth-hint">
        External connections are private to this workspace. Connecting never
        posts, books or changes ad spending.
      </p>
      {error && <p role="alert">{error}</p>}
      {!state && <output className="block">Loading connections…</output>}
      {state?.connections.map((c) => (
        <article key={c.provider} className="action-card">
          <h3>{providerNames[c.provider]}</h3>
          <p>{c.status.replaceAll('_', ' ')}</p>
          {c.displayName && (
            <p>
              {c.displayName}
              <small className="block">{c.externalId}</small>
            </p>
          )}
          {c.verifiedAt && (
            <p className="auth-hint">
              Last checked {new Date(c.verifiedAt).toLocaleString()}
            </p>
          )}
          <p>
            {c.provider === 'google_calendar'
              ? 'Create bookings after you approve the exact details.'
              : c.provider === 'facebook'
                ? c.capabilities.includes('facebook.publish')
                  ? 'Publishing enabled: immediate text, HTTPS link or one JPEG/PNG photo under 4 MB. Every post needs your explicit approval; scheduling and Instagram are not connected.'
                  : 'Connect and select a Facebook Page. Publishing remains unavailable until the operator enables it.'
                : 'Read-only campaign reporting. This app cannot create ads, change budgets or spend money.'}
          </p>
          {c.provider === 'facebook' &&
            c.status === 'connected' &&
            !c.capabilities.includes('facebook.publish') && (
              <p className="auth-hint">
                Publishing is disabled until the app’s permissions and test
                process are completed.
              </p>
            )}
          {!c.configured && (
            <p className="auth-hint">
              The site operator still needs to configure this service’s
              credentials.
            </p>
          )}
          <div className="button-row mt-3">
            {owner && (
              <Button
                size="sm"
                disabled={busy || !c.configured}
                onClick={() =>
                  act(async () => {
                    const route =
                      c.provider === 'google_calendar'
                        ? 'google/start'
                        : `integrations/${c.provider}/start`;
                    const result = await requestApi<{ url: string }>(
                      token,
                      route,
                      'POST',
                      { workspaceId },
                    );
                    const target = new URL(result.url);
                    const host =
                      c.provider === 'facebook'
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
                  })
                }
              >
                {c.connectionId ? 'Reconnect' : 'Connect'}
              </Button>
            )}
            {owner && c.connectionId && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await requestApi(token, 'integrations/disconnect', 'POST', {
                      workspaceId,
                      provider: c.provider,
                      connectionId: c.connectionId,
                    });
                    setReport(null);
                    await load();
                    await onSaved();
                  })
                }
              >
                Disconnect
              </Button>
            )}
            {c.provider === 'google_ads' && c.status === 'connected' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
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
                Load campaign report
              </Button>
            )}
          </div>
        </article>
      ))}
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
      <h3>Choose your {providerNames[candidate.provider]}</h3>
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
