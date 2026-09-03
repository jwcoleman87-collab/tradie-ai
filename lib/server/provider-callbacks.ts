import type { Provider } from '../integrations';
import { appOrigin } from './config';

export const providerCallbackPaths: Record<Provider, string> = {
  google_calendar: '/api/google/callback',
  facebook: '/api/integrations/facebook/callback',
  google_ads: '/api/integrations/google_ads/callback',
};

export function providerCallback(provider: Provider) {
  return appOrigin() + providerCallbackPaths[provider];
}
