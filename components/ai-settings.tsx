'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { BrandMark } from './brand';
import {
  aiProviderNames,
  aiProviderLabel,
  type AIProviderName,
  type AIAvailability,
} from '@/lib/ai-settings';
import type { WorkspaceData } from '@/lib/contracts';
import { requestApi } from '@/lib/client';
import { aiBrands } from '@/lib/brands';

export function AISettings({
  workspace,
  available,
  token,
  owner,
  onSaved,
}: {
  workspace: WorkspaceData;
  available: AIAvailability;
  token: string;
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const [primary, setPrimary] = useState(workspace.ai_primary_provider);
  const [allowed, setAllowed] = useState(workspace.ai_allowed_providers);
  const [fallback, setFallback] = useState(workspace.ai_fallback_enabled);
  const [enabled, setEnabled] = useState(!!workspace.ai_consent_at);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <article className="action-card">
      <span className="section-label">AI CONNECTIONS</span>
      <div className="brand-lockup-row" aria-label="OpenAI and Anthropic">
        <BrandMark brand="openai" showLabel />
        <span aria-hidden="true">+</span>
        <BrandMark brand="anthropic" showLabel />
      </div>
      <p>
        Choose who may process this workspace. Relevant conversation history,
        saved records, selected files, calendar busy times and connection names
        may be sent to the providers you allow. Provider retention policies
        apply. OpenAI response storage is disabled. Ask James does not receive
        this context.
      </p>
      <p className="auth-hint">
        API billing is separate from ChatGPT, Codex and Claude subscriptions.
        Backup needs its own funded API key. A message may use both providers
        and incur charges with both. When live research is needed, the chosen
        provider also receives a short public search query and applies its web
        search charges.
      </p>
      <fieldset disabled={!owner || busy} className="connection-form">
        <legend className="sr-only">
          Workspace AI privacy and backup settings
        </legend>
        {aiProviderNames.map((name) => (
          <label key={name} className="checkbox-label">
            <input
              type="checkbox"
              checked={allowed.includes(name)}
              onChange={(e) =>
                setAllowed(
                  e.target.checked
                    ? [...allowed, name]
                    : allowed.filter((p) => p !== name),
                )
              }
            />
            <span className="ai-provider-option">
              <BrandMark brand={aiBrands[name]} />
              <span>
                Allow {aiProviderLabel(name)}{' '}
                <small className="block">
                  {available[name]
                    ? 'API key configured · test a request to verify access'
                    : 'API key not configured'}
                </small>
              </span>
            </span>
          </label>
        ))}
        <label>
          First choice
          <select
            aria-label="Primary AI provider"
            value={primary}
            onChange={(e) => setPrimary(e.target.value as AIProviderName)}
          >
            {aiProviderNames.map((name) => (
              <option key={name} value={name}>
                {aiProviderLabel(name)}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fallback}
            onChange={(e) => setFallback(e.target.checked)}
          />
          <span>
            Use the other allowed provider if the first is unavailable or out of
            API quota.
          </span>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enable AI processing for this workspace.</span>
        </label>
        <p className="auth-hint">
          Backup never overrides these permissions or a safety refusal. Pausing
          stops new requests; an already-started request may finish.
        </p>
        {owner && (
          <Button
            size="sm"
            disabled={enabled && !allowed.includes(primary)}
            onClick={async () => {
              setBusy(true);
              setMessage('');
              try {
                await requestApi(token, 'consent', 'POST', {
                  workspaceId: workspace.id,
                  allowAI: enabled,
                  primaryProvider: primary,
                  allowedProviders: allowed,
                  allowFallback: fallback,
                });
                await onSaved();
                setMessage('AI preferences saved.');
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Could not save preferences.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save AI preferences'}
          </Button>
        )}
      </fieldset>
      {!owner && (
        <p className="auth-hint">
          Only the workspace owner can change these permissions.
        </p>
      )}
      {message && <output className="block">{message}</output>}
    </article>
  );
}
