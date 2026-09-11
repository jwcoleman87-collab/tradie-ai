import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './crypto';

const SOURCE = readFileSync(
  join(process.cwd(), 'skills/trade-intelligence/GREENVAC.md'),
  'utf8',
);

const APPLIES = /greenvac|hydro\s*vac|hydro\s*excav/i;
const RATE_MARKERS = [
  'AUD 185 inc GST on site',
  'AUD 650 inc GST',
  'AUD 165 + AUD 2.20',
  '50% of the minimum (AUD 325)',
];

export const UNAVAILABLE_INSTRUCTIONS =
  'Workspace operating rules: use only owner-confirmed prices and policies from this workspace. Do not apply another business\'s rate card. A quoted job whose scope later changes is a variation (draft.save + record.create), never a silent reprice. Calendar moves require calendar.create and owner Accept. If this workspace has no recorded hourly rate or minimum charge, say the rate is missing and ask for it. Do not invent a rate.';

type ProfileFields = {
  display_name?: unknown;
  name?: unknown;
  services?: unknown;
  preferred_job_types?: unknown;
};

function textList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(' ');
  if (value == null) return '';
  return String(value);
}

export function profileMatchesGreenVac(profile: unknown) {
  if (profile == null || typeof profile !== 'object') return false;
  const fields = profile as ProfileFields;
  const applicable = `${textList(fields.display_name)} ${textList(fields.name)} ${textList(fields.services)} ${textList(fields.preferred_job_types)}`;
  return APPLIES.test(applicable);
}

export function rateCardLeaked(instructions: string) {
  return RATE_MARKERS.some((marker) => instructions.includes(marker));
}

export async function loadTradeIntelligence(profile: unknown) {
  const version = SOURCE.match(/^version: (.+)$/m)?.[1] || 'invalid';
  const hash = await sha256(SOURCE);
  const applied = profileMatchesGreenVac(profile);
  return {
    agent: 'ops' as const,
    version,
    sha256: hash,
    path: applied
      ? 'skills/trade-intelligence/GREENVAC.md'
      : 'skills/trade-intelligence/unapplied',
    pack: 'greenvac' as const,
    applied,
    instructions: applied ? SOURCE : UNAVAILABLE_INSTRUCTIONS,
  };
}
