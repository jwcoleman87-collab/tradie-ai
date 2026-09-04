import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OnboardingCorrectionInput,
  OnboardingTurnInput,
} from '../lib/contracts';
import type { ModelProvider } from '../lib/server/ai';
import {
  extractIdentityFacts,
  onboardingGoalProgress,
  prepareOnboardingAnswer,
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

  it('does not guess the first business when an owner lists several', () => {
    const mixed = extractIdentityFacts(
      'I own Werka (www.werka.com.au), GreenVac (www.greenvac.com.au) and Paddockme.',
    );
    expect(mixed.find((fact) => fact.fieldPath === 'display_name')).toBeFalsy();
    expect(
      mixed.find((fact) => fact.fieldPath === 'brand_summary'),
    ).toBeFalsy();

    const correction = extractIdentityFacts(
      'The business name is called GreenVac.',
    );
    expect(correction).toContainEqual(
      expect.objectContaining({
        fieldPath: 'display_name',
        value: 'GreenVac',
      }),
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
    expect(result.identityChanged).toBe(false);
  });

  it('uses saved facts to choose an unanswered follow-up goal', async () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    const structured = vi.fn().mockResolvedValue({
      reply:
        'Most enquiries arrive by phone and Facebook — got it. What admin task costs you the most time?',
      facts: [
        {
          fieldPath: 'enquiry_channels',
          value: ['Phone', 'Facebook'],
          confidence: 'high',
          factState: 'owner_supplied',
        },
      ],
      goalsCovered: [],
      nextGoal: 'identity_anchor',
      reviewReady: false,
      webSearch: false,
      searchQuery: null,
    });
    const result = await runOnboardingMagic(
      { model: 'test-model', structured } as ModelProvider,
      {
        messages: [
          {
            role: 'user',
            content: 'Most enquiries arrive by phone and Facebook.',
          },
        ],
        existingFacts: [
          { field_path: 'display_name', value: 'Coastal Sparkies' },
          { field_path: 'services', value: ['Electrical maintenance'] },
          { field_path: 'preferred_job_types', value: ['Commercial work'] },
        ],
        timeZone: 'Australia/Sydney',
      },
    );

    expect(structured.mock.calls[0][1]).toContain('PROFILE PROGRESS');
    expect(result.goalsCovered).toEqual([
      'identity_anchor',
      'preferred_work',
      'enquiry_admin',
    ]);
    expect(result.nextGoal).toBe('first_bottleneck');
  });

  it('keeps a submitted answer stable across retries', () => {
    const requestId = crypto.randomUUID();
    const createdAt = '2026-09-04T07:00:00.000Z';
    const first = prepareOnboardingAnswer([], {
      requestId,
      answer: 'We are Coastal Sparkies and handle commercial maintenance.',
      createdAt,
    });
    expect(first.isNew).toBe(true);
    expect(first.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: requestId,
        role: 'user',
        content:
          'We are Coastal Sparkies and handle commercial maintenance.',
      }),
    );

    const retry = prepareOnboardingAnswer(first.messages, {
      requestId,
      answer: 'We are Coastal Sparkies and handle commercial maintenance.',
      createdAt,
    });
    expect(retry.isNew).toBe(false);
    expect(retry.alreadyInterpreted).toBe(false);
    expect(retry.messages).toHaveLength(first.messages.length);

    const completed = prepareOnboardingAnswer(
      [
        ...first.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Commercial maintenance — understood.',
          createdAt,
        },
      ],
      {
        requestId,
        answer: 'We are Coastal Sparkies and handle commercial maintenance.',
        createdAt,
      },
    );
    expect(completed.alreadyInterpreted).toBe(true);
  });

  it('tracks profile progress from facts rather than a fixed question count', () => {
    expect(
      onboardingGoalProgress([
        'display_name',
        'services',
        'preferred_job_types',
      ]),
    ).toEqual(
      expect.objectContaining({
        coveredGoals: ['identity_anchor', 'preferred_work'],
        openGoals: ['enquiry_admin', 'first_bottleneck'],
        suggestedNextGoal: 'enquiry_admin',
      }),
    );
  });

  it('overrides a stale business identity and recovers its matching website', async () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    const provider = {
      model: 'test-model',
      structured: vi.fn().mockResolvedValue({
        reply: 'I still need the business name.',
        facts: [],
        goalsCovered: [],
        nextGoal: 'identity_anchor',
        reviewReady: true,
        webSearch: false,
        searchQuery: null,
      }),
    } as ModelProvider;
    const result = await runOnboardingMagic(provider, {
      messages: [
        {
          role: 'user',
          content:
            'I own Werka (www.werka.com.au) and GreenVac hydro excavation (www.greenvac.com.au).',
        },
        { role: 'user', content: 'The business name is called GreenVac.' },
      ],
      existingFacts: [
        { field_path: 'display_name', value: 'Werka' },
        { field_path: 'brand_summary', value: 'Old Werka information' },
      ],
      timeZone: 'Australia/Sydney',
    });
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'display_name',
          value: 'GreenVac',
        }),
        expect.objectContaining({
          fieldPath: 'website_url',
          value: 'https://www.greenvac.com.au',
        }),
      ]),
    );
    expect(result.identityChanged).toBe(true);
    expect(result.reviewReady).toBe(false);
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
        requestId: crypto.randomUUID(),
        answer: 'x'.repeat(4001),
      }).success,
    ).toBe(false);
    const legacyInput = OnboardingTurnInput.safeParse({
      workspaceId: null,
      answer: 'A valid answer from a cached client',
    });
    expect(legacyInput.success).toBe(true);
    if (legacyInput.success)
      expect(legacyInput.data.requestId).toHaveLength(36);
    expect(
      OnboardingCorrectionInput.safeParse({
        workspaceId: crypto.randomUUID(),
        facts: [{ fieldPath: 'insurance_status', value: 'covered' }],
      }).success,
    ).toBe(false);
  });
});
