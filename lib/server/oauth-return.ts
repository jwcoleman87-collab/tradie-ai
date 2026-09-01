import type { AdditionalProvider } from '../integrations';

export function calendarReturnUrl(
  origin: string,
  status: 'cancelled' | 'connected',
) {
  const url = new URL('/workspace', origin);
  url.searchParams.set('calendar', status);
  return url.toString();
}

export function providerReturnUrl(
  origin: string,
  provider: AdditionalProvider,
  status: 'cancelled' | 'choose',
  candidate?: string,
) {
  const url = new URL('/workspace', origin);
  url.searchParams.set('connection', provider);
  url.searchParams.set('status', status);
  if (candidate) url.searchParams.set('candidate', candidate);
  return url.toString();
}
