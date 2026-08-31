import finance from '../../skills/finance/SKILL.md?raw';
import marketing from '../../skills/marketing/SKILL.md?raw';
import social from '../../skills/social/SKILL.md?raw';
import maintenance from '../../skills/maintenance/SKILL.md?raw';
import website from '../../skills/website/SKILL.md?raw';
import type { AgentName } from '../contracts';
import { sha256 } from './crypto';
const sources: Record<AgentName, string> = {
  finance,
  marketing,
  social,
  maintenance,
  website,
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
