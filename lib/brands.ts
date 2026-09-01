export const brandIds = [
  'green_vac',
  'werka',
  'google_calendar',
  'google_ads',
  'facebook',
  'openai',
  'anthropic',
  'supabase',
] as const;

export type BrandId = (typeof brandIds)[number];

export type BrandDefinition = {
  label: string;
  asset: string;
  aliases: readonly string[];
  format: 'icon' | 'wordmark';
  imageIncludesLabel?: boolean;
};

export const brands: Record<BrandId, BrandDefinition> = {
  green_vac: {
    label: 'GreenVac',
    asset: '/brands/greenvac.png',
    aliases: ['greenvac', 'green vac'],
    format: 'wordmark',
    imageIncludesLabel: true,
  },
  werka: {
    label: 'Werka',
    asset: '/brands/werka.png',
    aliases: ['werka'],
    format: 'wordmark',
    imageIncludesLabel: true,
  },
  google_calendar: {
    label: 'Google Calendar',
    asset: '/brands/google-calendar.webp',
    aliases: ['google calendar'],
    format: 'icon',
  },
  google_ads: {
    label: 'Google Ads',
    asset: '/brands/google-ads.webp',
    aliases: ['google ads', 'google adwords'],
    format: 'icon',
  },
  facebook: {
    label: 'Facebook',
    asset: '/brands/facebook.jpg',
    aliases: ['facebook'],
    format: 'icon',
  },
  openai: {
    label: 'OpenAI',
    asset: '/brands/openai.png',
    aliases: ['openai', 'chatgpt'],
    format: 'wordmark',
    imageIncludesLabel: true,
  },
  anthropic: {
    label: 'Claude by Anthropic',
    asset: '/brands/anthropic.png',
    aliases: ['anthropic', 'claude'],
    format: 'wordmark',
  },
  supabase: {
    label: 'Supabase',
    asset: '/brands/supabase.svg',
    aliases: ['supabase'],
    format: 'icon',
  },
};

export const integrationBrands = {
  google_calendar: 'google_calendar',
  facebook: 'facebook',
  google_ads: 'google_ads',
} as const satisfies Record<string, BrandId>;

export const aiBrands = {
  openai: 'openai',
  anthropic: 'anthropic',
} as const satisfies Record<string, BrandId>;

export function findBrandIdsInText(text: string): BrandId[] {
  const lower = text.toLocaleLowerCase('en-AU');
  return brandIds
    .map((id) => ({
      id,
      index: Math.min(
        ...brands[id].aliases
          .map((alias) => lower.indexOf(alias))
          .filter((index) => index >= 0),
      ),
    }))
    .filter((match) => Number.isFinite(match.index))
    .sort((a, b) => a.index - b.index)
    .map((match) => match.id);
}

export function findWorkspaceBrand(name: string): BrandId | undefined {
  return findBrandIdsInText(name).find(
    (id) => id === 'green_vac' || id === 'werka',
  );
}
