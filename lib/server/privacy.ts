import type { AgentName } from '../contracts';

// Support receives a categorical package, never free text. Regex redaction alone
// cannot reliably anonymise names, addresses or commercially sensitive details.
export function supportPayload(
  caseId: string,
  agent: AgentName,
  category: string,
) {
  const safe: Record<string, string> = {
    missing_information: 'A task needs more information or owner approval.',
    integration_error:
      'An external integration could not complete an approved operation.',
    safety_review: 'A request needs a safety or specialist review.',
    general: 'The owner requested help with their AI team.',
  };
  return {
    schemaVersion: 1,
    caseId,
    agent,
    category: Object.hasOwn(safe, category) ? category : 'general',
    problem: safe[category] || safe.general,
    solution: null,
    outcome: null,
  };
}
