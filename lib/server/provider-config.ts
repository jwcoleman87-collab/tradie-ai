import type { AdditionalProvider } from '../integrations';
import { env, required } from './config';
import { requireValue } from './errors';
export const facebookScopes = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
];
export const adsScope = 'https://www.googleapis.com/auth/adwords';
export function providerReady(provider: AdditionalProvider) {
  const common = !!(env('TOKEN_ENCRYPTION_KEY') && env('APP_ORIGIN'));
  if (provider === 'facebook')
    return (
      common &&
      !!(
        env('META_APP_ID') &&
        env('META_APP_SECRET') &&
        /^v\d+\.\d+$/.test(env('META_GRAPH_VERSION')) &&
        env('META_LOGIN_CONFIG_ID')
      )
    );
  return (
    common &&
    !!(
      (env('GOOGLE_ADS_CLIENT_ID') || env('GOOGLE_CLIENT_ID')) &&
      (env('GOOGLE_ADS_CLIENT_SECRET') || env('GOOGLE_CLIENT_SECRET')) &&
      env('GOOGLE_ADS_DEVELOPER_TOKEN')
    )
  );
}
export function graphVersion() {
  const version = required('META_GRAPH_VERSION');
  requireValue(/^v\d+\.\d+$/.test(version), 'PROVIDER_VERSION_INVALID', 503);
  return version;
}
export function adsVersion() {
  const version = env('GOOGLE_ADS_API_VERSION') || 'v25';
  requireValue(/^v\d+$/.test(version), 'PROVIDER_VERSION_INVALID', 503);
  return version;
}
export function googleAdsClient() {
  return {
    id: env('GOOGLE_ADS_CLIENT_ID') || required('GOOGLE_CLIENT_ID'),
    secret: env('GOOGLE_ADS_CLIENT_SECRET') || required('GOOGLE_CLIENT_SECRET'),
  };
}
