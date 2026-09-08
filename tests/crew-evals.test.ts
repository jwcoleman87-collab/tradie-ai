import { expect, it, vi } from 'vitest';
import { runTeam, type ModelProvider } from '../lib/server/ai';
import { crewCases, gradeCrewCase } from './fixtures/crew-eval-cases';

// Regression/evaluator checks: candidate replies here are fixtures. The same
// cases exercise real providers only in the separately enabled live suite.
for (const scenario of crewCases) {
  it(scenario.name, async () => {
    const provider: ModelProvider = {
      model: 'fixture',
      structured: vi
        .fn()
        .mockResolvedValueOnce({
          agents: [scenario.agent],
          reason: 'scenario',
          calendarContext: false,
          webSearch: false,
          searchQuery: null,
        })
        .mockResolvedValueOnce(scenario.candidate),
    };
    const result = await runTeam(provider, scenario.context);
    expect(gradeCrewCase(scenario, result)).toEqual([]);
  });
  it(`${scenario.agent}: its task rubric rejects a bare future promise`, () => {
    expect(
      gradeCrewCase(scenario, {
        reply: 'I will prepare that for you.',
        proposals: [],
        escalation: 'none',
      }).length,
    ).toBeGreaterThan(0);
  });
}
it('the Finance rubric catches a wrong subtotal, even when the disclosure is present', async () => {
  const scenario = crewCases[0];
  const candidate = {
    ...scenario.candidate,
    reply:
      'Data coverage: based on 2 of 63 records; not a complete period total.\n\nThe subtotal is AUD 999.',
  };
  expect(gradeCrewCase(scenario, candidate)).toContain(
    'correct supplied subtotal',
  );
});
it('the Social rubric rejects an unsupported success claim even with a valid proposal', () => {
  const scenario = crewCases.find((candidate) => candidate.agent === 'social')!;
  expect(
    gradeCrewCase(scenario, {
      ...scenario.candidate,
      reply: 'Your post is live. The approval is ready.',
    }),
  ).toContain('does not claim publication before execution');
});
it('the Website rubric rejects unchanged source copy', () => {
  const scenario = crewCases.find(
    (candidate) => candidate.agent === 'website',
  )!;
  const candidate = {
    ...scenario.candidate,
    proposals: [
      {
        type: 'draft.save' as const,
        agent: 'website' as const,
        summary: 'Services',
        payload: {
          kind: 'website' as const,
          title: 'Services',
          body: 'We offer lawn mowing, hedge trimming and stump removal.',
        },
      },
    ],
  };
  expect(gradeCrewCase(scenario, candidate)).toContain(
    'replacement retains the other services',
  );
});
it('the Marketing rubric rejects a future promise containing every requested keyword', () => {
  const scenario = crewCases.find(
    (candidate) => candidate.agent === 'marketing',
  )!;
  expect(
    gradeCrewCase(scenario, {
      reply:
        'I will prepare a Newcastle homeowners audience, next week timing and AUD 100 budget, then write an advert asking customers to call.',
      proposals: [],
      escalation: 'none',
    }),
  ).toContain('finished audience, timing, budget and local copy');
});
it('passes action receipts and confirmed profile facts into the model on follow-up', async () => {
  const structured = vi
    .fn()
    .mockResolvedValueOnce({
      agents: ['social'],
      reason: 'status',
      calendarContext: false,
      webSearch: false,
      searchQuery: null,
    })
    .mockResolvedValueOnce({
      reply: 'The recorded post was sent.',
      proposals: [],
      escalation: 'none',
    });
  await runTeam(
    { model: 'fixture', structured },
    {
      history: [{ role: 'user', content: 'Did that post send?' }],
      timeZone: 'Australia/Sydney',
      businessProfile: {
        services: ['Lawn mowing'],
        base_location: 'Newcastle',
        confirmed_at: '2026-09-05',
      },
      actionHistory: {
        coverage: { outstandingTotal: 0, historyTotal: 1 },
        actions: [
          {
            id: 'action-a',
            agent: 'social',
            type: 'facebook.publish',
            summary: 'Lawn post',
            status: 'completed',
            displayState: 'Sent',
            outcome: 'Published to Facebook.',
            approvedAt: '2026-09-05T00:00:00Z',
            completedAt: '2026-09-05T00:00:05Z',
            errorCode: null,
            publicationStatus: null,
            publicationConfirmedAt: null,
            receiptUrl: 'https://www.facebook.com/12345_678',
            payload: '{}',
            payloadShortened: false,
          },
        ],
      },
    },
  );
  const modelContext = JSON.parse(structured.mock.calls[1][2][0].content);
  expect(modelContext.recordedActions.actions[0]).toMatchObject({
    status: 'completed',
    receiptUrl: 'https://www.facebook.com/12345_678',
  });
  expect(modelContext.confirmedBusinessProfile.base_location).toBe('Newcastle');
  expect(JSON.stringify(structured.mock.calls[0][2])).toContain('Sent');
});
