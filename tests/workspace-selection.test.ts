import { describe, expect, it } from 'vitest';
import {
  preferredWorkspace,
  workspaceNeedsOnboarding,
} from '../lib/workspace-selection';

const workspaces = [
  { id: 'old-incomplete', status: 'active' as const },
  { id: 'ready', status: 'active' as const },
  { id: 'archived', status: 'archived' as const },
];

describe('preferred workspace selection', () => {
  it('honours an explicit workspace selection', () => {
    expect(
      preferredWorkspace(workspaces, new Set(['ready']), 'old-incomplete')?.id,
    ).toBe('old-incomplete');
  });

  it('opens a confirmed active workspace before an older incomplete one', () => {
    expect(preferredWorkspace(workspaces, new Set(['ready']))?.id).toBe(
      'ready',
    );
  });

  it('falls back to the first active workspace for a new account', () => {
    expect(preferredWorkspace(workspaces, new Set())?.id).toBe(
      'old-incomplete',
    );
  });

  it('does not trap a testing sandbox in business onboarding', () => {
    expect(
      workspaceNeedsOnboarding({ workspace_type: 'sandbox' }, 'in_progress'),
    ).toBe(false);
    expect(
      workspaceNeedsOnboarding({ workspace_type: 'business' }, 'in_progress'),
    ).toBe(true);
  });
});
