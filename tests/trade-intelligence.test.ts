import { afterEach, expect, it } from 'vitest';
import {
  loadTradeIntelligence,
  profileMatchesGreenVac,
  rateCardLeaked,
} from '../lib/server/trade-intelligence';

afterEach(() => {
  delete process.env.GREENVAC_WORKSPACE_IDS;
});

it('applies the GreenVac pack only via managed_pack or operator workspace allowlist', () => {
  expect(profileMatchesGreenVac({ display_name: 'GreenVac' })).toBe(false);
  expect(profileMatchesGreenVac({ name: 'GreenVac' })).toBe(false);
  expect(profileMatchesGreenVac({ managed_pack: 'greenvac' })).toBe(true);
  process.env.GREENVAC_WORKSPACE_IDS = 'aaa,bbb';
  expect(profileMatchesGreenVac({ workspace_id: 'bbb' })).toBe(true);
  expect(profileMatchesGreenVac({ workspace_id: 'ccc' })).toBe(false);
  expect(profileMatchesGreenVac(null)).toBe(false);
});

it('rejects owner-chosen names and other hydrovac businesses', () => {
  expect(profileMatchesGreenVac({ display_name: 'Not GreenVac' })).toBe(false);
  expect(
    profileMatchesGreenVac({ name: 'GreenVac competitor research' }),
  ).toBe(false);
  expect(profileMatchesGreenVac({ display_name: 'Old Green Vac account' })).toBe(
    false,
  );
  expect(
    profileMatchesGreenVac({
      display_name: 'GreenVac',
      services: ['hydro excavation'],
    }),
  ).toBe(false);
  expect(
    profileMatchesGreenVac({
      display_name: 'Southern Hydrovac',
      services: ['hydrovac'],
    }),
  ).toBe(false);
  expect(
    profileMatchesGreenVac({
      display_name: 'Werka Plant',
      services: ['hydrovac'],
    }),
  ).toBe(false);
});

it('loads the versioned GreenVac pack with a stable hash and withholds the rate card when unapplied', async () => {
  const greenvac = await loadTradeIntelligence({ managed_pack: 'greenvac' });
  expect(greenvac.version).toBe('1.0.1');
  expect(greenvac.applied).toBe(true);
  expect(greenvac.agent).toBe('ops');
  expect(greenvac.path).toBe('skills/trade-intelligence/GREENVAC.md');
  expect(greenvac.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(greenvac.instructions).toContain('VARIATION');
  expect(rateCardLeaked(greenvac.instructions)).toBe(true);
  const renamed = await loadTradeIntelligence({ display_name: 'GreenVac' });
  expect(renamed.applied).toBe(false);
  expect(rateCardLeaked(renamed.instructions)).toBe(false);
  const otherHydro = await loadTradeIntelligence({
    display_name: 'Southern Hydrovac',
    services: ['hydrovac'],
  });
  expect(otherHydro.applied).toBe(false);
  expect(otherHydro.sha256).toBe(greenvac.sha256);
  expect(rateCardLeaked(otherHydro.instructions)).toBe(false);
});
