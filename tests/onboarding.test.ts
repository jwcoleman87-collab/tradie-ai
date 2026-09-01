import { describe, expect, it } from 'vitest';
import {
  OnboardingCorrectionInput,
  OnboardingTurnInput,
} from '../lib/contracts';
import { businessDiscovery } from '../lib/server/discovery';
import {
  buildOnboardingTurn,
  extractIdentityFacts,
} from '../lib/server/onboarding';

describe('bounded intelligent onboarding', () => {
  it('extracts only schema-validated owner-supplied identity anchors', () => {
    const facts = extractIdentityFacts(
      'I run Coastal Sparkies, based in Newcastle and we do switchboard upgrades and commercial maintenance. Website https://coastal.example.',
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'display_name',
          value: 'Coastal Sparkies',
          factState: 'owner_supplied',
        }),
        expect.objectContaining({
          fieldPath: 'base_location',
          value: 'Newcastle',
        }),
        expect.objectContaining({
          fieldPath: 'website_url',
          value: 'https://coastal.example',
          confidence: 'high',
        }),
      ]),
    );
  });

  it('skips information goals already covered by reliable facts', () => {
    const turn = buildOnboardingTurn({
      answer: 'Switchboard upgrades for strata managers',
      currentGoal: 'preferred_work',
      goalsCovered: ['identity_anchor'],
      existingFacts: [
        { field_path: 'display_name', value: 'Coastal Sparkies' },
        { field_path: 'base_location', value: 'Newcastle' },
        { field_path: 'services', value: ['electrical'] },
        { field_path: 'enquiry_channels', value: ['phone', 'email'] },
      ],
    });
    expect(turn.goalsCovered).toEqual(
      expect.arrayContaining([
        'identity_anchor',
        'preferred_work',
        'enquiry_admin',
      ]),
    );
    expect(turn.nextGoal).toBe('first_bottleneck');
    expect(turn.reviewReady).toBe(false);
  });

  it('reaches profile review without a five-agent persona loop', () => {
    const turn = buildOnboardingTurn({
      answer: 'Following up quotes after a long day on site',
      currentGoal: 'first_bottleneck',
      goalsCovered: ['identity_anchor', 'preferred_work', 'enquiry_admin'],
      existingFacts: [
        { field_path: 'display_name', value: 'Coastal Sparkies' },
        { field_path: 'base_location', value: 'Newcastle' },
        { field_path: 'services', value: ['electrical'] },
        { field_path: 'preferred_job_types', value: ['switchboards'] },
        { field_path: 'enquiry_channels', value: ['phone'] },
      ],
    });
    expect(turn.reviewReady).toBe(true);
    expect(turn.nextGoal).toBeNull();
    expect(turn.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'admin_bottleneck',
          factState: 'owner_supplied',
        }),
        expect.objectContaining({
          fieldPath: 'primary_goal',
          factState: 'inferred',
        }),
      ]),
    );
  });

  it('does not pretend public research ran', async () => {
    expect(businessDiscovery.status()).toMatchObject({
      status: 'unavailable',
      label: 'Public-source research not connected',
    });
    await expect(
      businessDiscovery.discover({
        workspaceId: crypto.randomUUID(),
        queries: [],
      }),
    ).resolves.toEqual([]);
  });

  it('rejects oversized prompts and correction fields outside the allow-list', () => {
    expect(
      OnboardingTurnInput.safeParse({
        workspaceId: null,
        answer: 'x'.repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      OnboardingCorrectionInput.safeParse({
        workspaceId: crypto.randomUUID(),
        facts: [{ fieldPath: 'insurance_status', value: 'covered' }],
      }).success,
    ).toBe(false);
  });
});
