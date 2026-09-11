import { expect, it } from 'vitest';
import {
  loadTradeIntelligence,
  profileMatchesGreenVac,
} from '../lib/server/trade-intelligence';

it('matches GreenVac and hydro excavation profiles only', () => {
  expect(
    profileMatchesGreenVac({ display_name: 'GreenVac', services: ['Hydro excavation'] }),
  ).toBe(true);
  expect(profileMatchesGreenVac({ display_name: 'Newcastle Plumbing Co' })).toBe(
    false,
  );
  expect(profileMatchesGreenVac(null)).toBe(false);
});

it('loads the versioned GreenVac pack with a stable hash', async () => {
  const greenvac = await loadTradeIntelligence({ display_name: 'GreenVac' });
  expect(greenvac.version).toBe('1.0.0');
  expect(greenvac.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(greenvac.instructions).toContain('VARIATION');
  const other = await loadTradeIntelligence({ display_name: 'Acme Electrical' });
  expect(other.instructions).not.toContain('AUD 185 inc GST on site');
  expect(other.sha256).toBe(greenvac.sha256);
});
