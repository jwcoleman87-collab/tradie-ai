import { expect, it } from 'vitest';
import {
  loadTradeIntelligence,
  profileMatchesGreenVac,
  rateCardLeaked,
} from '../lib/server/trade-intelligence';

it('matches GreenVac and hydro excavation from name or services only', () => {
  expect(
    profileMatchesGreenVac({
      display_name: 'GreenVac',
      services: ['Hydro excavation'],
    }),
  ).toBe(true);
  expect(
    profileMatchesGreenVac({
      display_name: 'Werka Plant',
      services: ['hydrovac'],
    }),
  ).toBe(true);
  expect(profileMatchesGreenVac({ display_name: 'Newcastle Plumbing Co' })).toBe(
    false,
  );
  expect(profileMatchesGreenVac(null)).toBe(false);
});

it('does not treat brand copy mentioning a hydrovac competitor as this workspace', () => {
  expect(
    profileMatchesGreenVac({
      display_name: 'Newcastle Plumbing Co',
      services: ['plumbing'],
      brand_summary: 'We compete with local hydrovac firms around Newcastle.',
      website_url: 'https://example.com/hydrovac-myths',
    }),
  ).toBe(false);
});

it('loads the versioned GreenVac pack with a stable hash and withholds the rate card when unapplied', async () => {
  const greenvac = await loadTradeIntelligence({ display_name: 'GreenVac' });
  expect(greenvac.version).toBe('1.0.0');
  expect(greenvac.applied).toBe(true);
  expect(greenvac.agent).toBe('ops');
  expect(greenvac.path).toBe('skills/trade-intelligence/GREENVAC.md');
  expect(greenvac.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(greenvac.instructions).toContain('VARIATION');
  expect(rateCardLeaked(greenvac.instructions)).toBe(true);
  const other = await loadTradeIntelligence({
    display_name: 'Newcastle Plumbing Co',
    services: ['plumbing'],
  });
  expect(other.applied).toBe(false);
  expect(other.path).toBe('skills/trade-intelligence/unapplied');
  expect(other.sha256).toBe(greenvac.sha256);
  expect(rateCardLeaked(other.instructions)).toBe(false);
  expect(other.instructions).not.toContain('AUD 185 inc GST on site');
  expect(other.instructions).toContain('rate is missing');
});
