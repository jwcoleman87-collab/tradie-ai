import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OnboardingCorrectionInput,
  OnboardingTurnInput,
} from '../lib/contracts';
import type { ModelProvider } from '../lib/server/ai';
import {
  extractIdentityFacts,
  runOnboardingMagic,
} from '../lib/server/onboarding';

afterEach(() => vi.unstubAllEnvs());

describe('continuous Magic onboarding', () => {
  it('keeps local extraction only for a safe provisional workspace name', () => {
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

  it('gives the model the whole conversation and honours the latest correction', async () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    const calls: unknown[][] = [];
    const provider = {
      model: 'test-model',
      structured: vi
        .fn()
        .mockImplementation(async (_schema, _prompt, input) => {
          calls.push(input);
          return {
            reply:
              'Got it — this workspace is for GreenVac. What work would you most like more of?',
            facts: [
              {
                fieldPath: 'display_name',
                value: 'GreenVac',
                confidence: 'high',
                factState: 'owner_supplied',
              },
            ],
            goalsCovered: ['identity_anchor'],
            nextGoal: 'preferred_work',
            reviewReady: false,
            webSearch: false,
            searchQuery: null,
          };
        }),
    } as ModelProvider;
    const result = await runOnboardingMagic(provider, {
      messages: [
        { role: 'assistant', content: 'Tell me about the business.' },
        {
          role: 'user',
          content: 'I own Werka, GreenVac and I am building Paddockme.',
        },
        { role: 'assistant', content: 'Which business is this workspace for?' },
        { role: 'user', content: 'The business name is called GreenVac.' },
      ],
      existingFacts: [
        { field_path: 'brand_summary', value: 'Several owner businesses' },
      ],
      timeZone: 'Australia/Sydney',
    });
    expect(JSON.stringify(calls[0])).toContain('Werka');
    expect(JSON.stringify(calls[0])).toContain(
      'The business name is called GreenVac.',
    );
    expect(result.reply).toContain('this workspace is for GreenVac');
    expect(result.facts).toEqual([
      expect.objectContaining({ fieldPath: 'display_name', value: 'GreenVac' }),
    ]);
  });

  it('uses cited live research for a current connection question', async () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'true');
    const structured = vi
      .fn()
      .mockResolvedValueOnce({
        reply: 'I’ll check the current steps.',
        facts: [],
        goalsCovered: [],
        nextGoal: 'identity_anchor',
        reviewReady: false,
        webSearch: true,
        searchQuery: 'current steps connect Facebook Ads account',
      })
      .mockResolvedValueOnce({
        reply:
          'Open Meta Business Settings, then Accounts and Ad accounts. Use the account selector before granting access.',
        facts: [],
        goalsCovered: [],
        nextGoal: 'identity_anchor',
        reviewReady: false,
        webSearch: false,
        searchQuery: null,
      });
    const research = vi.fn().mockResolvedValue({
      provider: 'openai',
      summary: 'Current public Meta setup steps.',
      searchedAt: '2026-09-02T07:00:00.000Z',
      sources: [
        {
          title: 'Meta Business Help',
          url: 'https://www.facebook.com/business/help/',
        },
      ],
    });
    const result = await runOnboardingMagic(
      { model: 'test-model', structured, research } as ModelProvider,
      {
        messages: [
          {
            role: 'user',
            content: 'How do I get to my Facebook Ads account to connect it?',
          },
        ],
        existingFacts: [],
        timeZone: 'Australia/Sydney',
      },
    );
    expect(research).toHaveBeenCalledWith(
      'current steps connect Facebook Ads account',
      'Australia/Sydney',
    );
    expect(result.reply).toContain('Meta Business Settings');
    expect(result.reply).toContain(
      '[Meta Business Help](https://www.facebook.com/business/help/)',
    );
    expect(result.researchUsed).toBe(true);
  });

  it('does not open profile review from a name alone', async () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    const provider = {
      model: 'test-model',
      structured: vi.fn().mockResolvedValue({
        reply: 'GreenVac — got it. What does GreenVac mainly do?',
        facts: [
          {
            fieldPath: 'display_name',
            value: 'GreenVac',
            confidence: 'high',
            factState: 'owner_supplied',
          },
        ],
        goalsCovered: [],
        nextGoal: 'identity_anchor',
        reviewReady: true,
        webSearch: false,
        searchQuery: null,
      }),
    } as ModelProvider;
    const result = await runOnboardingMagic(provider, {
      messages: [{ role: 'user', content: 'The business is GreenVac.' }],
      existingFacts: [],
      timeZone: 'Australia/Sydney',
    });
    expect(result.reviewReady).toBe(false);
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
