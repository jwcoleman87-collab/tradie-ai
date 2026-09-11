import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './crypto';

const SOURCE = readFileSync(
  join(process.cwd(), 'skills/trade-intelligence/GREENVAC.md'),
  'utf8',
);

const APPLIES = /greenvac|hydro\s*vac|hydro\s*excav/i;

export function profileMatchesGreenVac(profile: unknown) {
  if (profile == null) return false;
  return APPLIES.test(JSON.stringify(profile));
}

export async function loadTradeIntelligence(profile: unknown) {
  const version = SOURCE.match(/^version: (.+)$/m)?.[1] || 'invalid';
  const hash = await sha256(SOURCE);
  if (!profileMatchesGreenVac(profile)) {
    return {
      version,
      sha256: hash,
      instructions:
        'Workspace operating rules: use only owner-confirmed prices and policies from this workspace. Do not apply another business\'s rate card. A quoted job whose scope later changes is a variation (draft.save + record.create), never a silent reprice. Calendar moves require calendar.create and owner Accept.',
    };
  }
  return {
    version,
    sha256: hash,
    instructions: SOURCE,
  };
}
