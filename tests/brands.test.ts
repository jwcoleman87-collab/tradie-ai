import { describe, expect, it } from 'vitest';
import { findBrandIdsInText, findWorkspaceBrand } from '../lib/brands';

describe('brand matching', () => {
  it('finds known brands once and in reading order', () => {
    expect(
      findBrandIdsInText(
        'Publish Werka on Facebook, then review Werka in Google Ads.',
      ),
    ).toEqual(['werka', 'facebook', 'google_ads']);
  });

  it('recognises product and provider names without treating generic words as brands', () => {
    expect(
      findBrandIdsInText(
        'Claude and OpenAI can use Supabase records. Metadata stays private.',
      ),
    ).toEqual(['anthropic', 'openai', 'supabase']);
  });

  it('recognises approved business workspace names', () => {
    expect(findWorkspaceBrand('Green Vac — Operations')).toBe('green_vac');
    expect(findWorkspaceBrand('Werka marketing')).toBe('werka');
    expect(findWorkspaceBrand('James sandbox')).toBeUndefined();
  });
});
