import { describe, expect, it } from 'vitest';
import { OpenAIProvider, runTeam } from '../../lib/server/ai';
import { ClaudeProvider } from '../../lib/server/claude';
import { crewCases, gradeCrewCase } from '../fixtures/crew-eval-cases';

const enabled = process.env.WORKBENCH_LIVE_CREW_EVAL === '1';
const providerName = process.env.WORKBENCH_EVAL_PROVIDER || 'openai';
// This suite uses synthetic records and runTeam only. It never calls approval,
// execution, customer databases, Facebook or Google Calendar.
describe.skipIf(!enabled)('live crew completion', () => {
  it('requires the explicitly selected provider to be configured', () => {
    expect(['openai', 'anthropic']).toContain(providerName);
    expect(
      Boolean(
        process.env[
          providerName === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
        ],
      ),
    ).toBe(true);
  });
  for (const scenario of crewCases)
    it(
      scenario.name,
      async () => {
        const provider =
          providerName === 'anthropic'
            ? new ClaudeProvider()
            : new OpenAIProvider();
        const result = await runTeam(provider, scenario.context);
        expect(result.agents).toContain(scenario.agent);
        expect(gradeCrewCase(scenario, result), scenario.name).toEqual([]);
      },
      120000,
    );
});
