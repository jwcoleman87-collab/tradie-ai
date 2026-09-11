import { expect, it } from 'vitest';
import {
  loadTradeIntelligence,
  profileMatchesGreenVac,
  rateCardLeaked,
} from '../lib/server/trade-intelligence';

it('applies the GreenVac pack only to an explicit GreenVac business identity', () => {
  expect(profileMatchesGreenVac({ display_name: 'GreenVac' })).toBe(true);
  expect(profileMatchesGreenVac({ name: 'Green Vac Hydro' })).toBe(true);
  expect(profileMatchesGreenVac({ managed_pack: 'greenvac' })).toBe(true);
  expect(profileMatchesGreenVac({ display_name: 'Newcastle Plumbing Co' })).toBe(
    false,
  );
  expect(profileMatchesGreenVac(null)).toBe(false);
});

it('does not infer GreenVac rates from hydrovac trade classification or brand copy', () => {
  expect(
    profileMatchesGreenVac({
      display_name: 'Werka Plant',
      services: ['hydrovac'],
      preferred_job_types: ['hydro excavation'],
    }),
  ).toBe(false);
  expect(
    profileMatchesGreenVac({
      display_name: 'Southern Hydrovac',
      services: ['hydro excavation'],
    }),
  ).toBe(false);
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
  expect(greenvac.version).toBe('1.0.1');
  expect(greenvac.applied).toBe(true);
  expect(greenvac.agent).toBe('ops');
  expect(greenvac.path).toBe('skills/trade-intelligence/GREENVAC.md');
  expect(greenvac.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(greenvac.instructions).toContain('VARIATION');
  expect(rateCardLeaked(greenvac.instructions)).toBe(true);
  const otherHydro = await loadTradeIntelligence({
    display_name: 'Southern Hydrovac',
    services: ['hydrovac'],
  });
  expect(otherHydro.applied).toBe(false);
  expect(otherHydro.path).toBe('skills/trade-intelligence/unapplied');
  expect(otherHydro.sha256).toBe(greenvac.sha256);
  expect(rateCardLeaked(otherHydro.instructions)).toBe(false);
  expect(otherHydro.instructions).not.toContain('AUD 185 inc GST on site');
  const plumbing = await loadTradeIntelligence({
    display_name: 'Newcastle Plumbing Co',
    services: ['plumbing'],
  });
  expect(plumbing.applied).toBe(false);
  expect(rateCardLeaked(plumbing.instructions)).toBe(false);
  expect(plumbing.instructions).toContain('rate is missing');
});
