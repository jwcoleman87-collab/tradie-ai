import { eligibleAIProviders, type AIPreferences } from '../../ai-settings';
import { env } from '../config';
import { requireValue } from '../errors';

// This gate narrows rollout only. Membership, consent and authority still run
// independently at entry and on EVERY tool invocation.
export function managerEnabled(
  workspaceId: string,
  userId: string,
  role: string,
) {
  const contains = (key: string, value: string) =>
    env(key)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(value);
  return (
    env('MANAGER_ENABLED') === 'true' &&
    role === 'owner' &&
    contains('MANAGER_WORKSPACE_IDS', workspaceId) &&
    contains('MANAGER_OWNER_IDS', userId)
  );
}
export function managerConfiguration(preferences: AIPreferences) {
  // Workspace consent remains the authority for provider order. Optional model
  // override applies only to the eligible primary, never to its backup.
  const order = eligibleAIProviders(preferences, {
    openai: !!env('OPENAI_API_KEY'),
    anthropic: !!env('ANTHROPIC_API_KEY'),
  });
  requireValue(order.length > 0, 'SETUP_REQUIRED', 503);
  return order.map((provider, index) => ({
    provider,
    model:
      (index === 0 ? env('MANAGER_MODEL') : '') ||
      (provider === 'openai'
        ? env('OPENAI_MODEL') || 'gpt-6-astra'
        : env('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001'),
  }));
}
