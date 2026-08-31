import { z } from 'zod';
export const aiProviderNames = ['openai', 'anthropic'] as const;
export const AIConsentInput = z
  .object({
    workspaceId: z.uuid(),
    allowAI: z.boolean(),
    primaryProvider: z.enum(aiProviderNames).default('openai'),
    allowedProviders: z
      .array(z.enum(aiProviderNames))
      .max(2)
      .default(['openai']),
    allowFallback: z.boolean().default(true),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.allowAI && !p.allowedProviders.includes(p.primaryProvider))
      ctx.addIssue({
        code: 'custom',
        message: 'Allow your primary provider before enabling AI.',
      });
    if (new Set(p.allowedProviders).size !== p.allowedProviders.length)
      ctx.addIssue({ code: 'custom', message: 'Choose each provider once.' });
  });
export type AIProviderName = (typeof aiProviderNames)[number];
export type AIPreferences = {
  ai_primary_provider: AIProviderName;
  ai_fallback_enabled: boolean;
  ai_allowed_providers: AIProviderName[];
};
export type AIAvailability = { openai: boolean; anthropic: boolean };
export function eligibleAIProviders(
  preferences: AIPreferences,
  available: AIAvailability,
): AIProviderName[] {
  const primary = preferences.ai_primary_provider;
  const order: AIProviderName[] = preferences.ai_fallback_enabled
    ? [primary, primary === 'openai' ? 'anthropic' : 'openai']
    : [primary];
  return order.filter(
    (p) => preferences.ai_allowed_providers.includes(p) && available[p],
  );
}
export const aiProviderLabel = (provider: AIProviderName) =>
  provider === 'anthropic' ? 'Claude (Anthropic)' : 'OpenAI';
