export const providers = ['google_calendar', 'facebook', 'google_ads'] as const;
export type Provider = (typeof providers)[number];
export type AdditionalProvider = Exclude<Provider, 'google_calendar'>;
export const providerNames: Record<Provider, string> = {
  google_calendar: 'Google Calendar',
  facebook: 'Facebook Page',
  google_ads: 'Google Ads',
};
export type ConnectionInfo = {
  provider: Provider;
  configured: boolean;
  connectionId: string | null;
  status:
    | 'not_configured'
    | 'not_connected'
    | 'connected'
    | 'reconnect_required';
  externalId: string | null;
  displayName: string | null;
  verifiedAt: string | null;
  capabilities: string[];
};
export type ResourceChoice = {
  id: string;
  name: string;
  currency?: string;
  timeZone?: string;
  loginCustomerId?: string;
};
export type PendingConnection = {
  id: string;
  provider: AdditionalProvider;
  expiresAt: string;
  resources: ResourceChoice[];
  limited: boolean;
};
export type AdsReport = {
  account: ResourceChoice;
  period: 'LAST_30_DAYS';
  fetchedAt: string;
  limited: boolean;
  campaigns: {
    id: string;
    name: string;
    status: string;
    impressions: string;
    clicks: string;
    costMicros: string;
    conversions: number | null;
  }[];
};
