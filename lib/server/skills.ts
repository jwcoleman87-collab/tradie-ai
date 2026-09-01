import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentName } from '../contracts';
import { sha256 } from './crypto';

function readSkill(agent: AgentName) {
  return readFileSync(
    join(process.cwd(), 'skills', agent, 'SKILL.md'),
    'utf8',
  );
}

const sources: Record<AgentName, string> = {
  finance: readSkill('finance'),
  marketing: readSkill('marketing'),
  social: readSkill('social'),
  maintenance: readSkill('maintenance'),
  website: readSkill('website'),
};
export async function loadSkills(selected: AgentName[]) {
  return Promise.all(
    [...new Set(selected)].map(async (agent) => ({
      agent,
      version: sources[agent].match(/^version: (.+)$/m)?.[1] || 'invalid',
      sha256: await sha256(sources[agent]),
      path: `skills/${agent}/SKILL.md`,
      instructions: sources[agent],
    })),
  );
}
