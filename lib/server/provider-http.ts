import { z } from 'zod';
import { AppError, requireValue, timedFetch } from './errors';
import { required } from './config';
import { adsVersion, graphVersion } from './provider-config';
export const ExternalId = z.string().regex(/^\d{1,30}$/);
export async function appSecretProof(token: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(required('META_APP_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Buffer.from(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)),
  ).toString('hex');
}
export async function graphRead(
  path: string,
  token: string,
  params: Record<string, string> = {},
) {
  requireValue(
    /^(me\/(permissions|accounts)|\d{1,30})$/.test(path),
    'INVALID_PROVIDER_PATH',
    400,
  );
  // Path comes only from fixed endpoints / validated provider IDs, never paging URLs.
  const query = new URLSearchParams({
    ...params,
    appsecret_proof: await appSecretProof(token),
  });
  const response = await timedFetch(
    'https://graph.facebook.com/' + graphVersion() + '/' + path + '?' + query,
    { headers: { Authorization: 'Bearer ' + token }, redirect: 'manual' },
  );
  if (!response.ok)
    throw new AppError(
      [400, 401, 403].includes(response.status)
        ? 'FACEBOOK_ACCESS_FAILED'
        : 'UPSTREAM_UNAVAILABLE',
      [400, 401, 403].includes(response.status) ? 409 : 503,
      [400, 401, 403].includes(response.status)
        ? 'Facebook access could not be verified. Check permissions or reconnect.'
        : 'Facebook could not be checked right now. Your saved connection was not removed.',
    );
  return response.json();
}
export async function adsRead(
  token: string,
  path: string,
  query?: string,
  loginCustomerId?: string,
) {
  requireValue(
    query
      ? /^customers\/\d{10}\/googleAds:search$/.test(path) &&
          /^SELECT /i.test(query)
      : path === 'customers:listAccessibleCustomers',
    'INVALID_PROVIDER_PATH',
    400,
  );
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + token,
    'developer-token': required('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'Content-Type': 'application/json',
  };
  if (loginCustomerId)
    headers['login-customer-id'] = z
      .string()
      .regex(/^\d{10}$/)
      .parse(loginCustomerId);
  const response = await timedFetch(
    'https://googleads.googleapis.com/' + adsVersion() + '/' + path,
    {
      method: query ? 'POST' : 'GET',
      headers,
      ...(query ? { body: JSON.stringify({ query }) } : {}),
      redirect: 'manual',
    },
  );
  if (!response.ok)
    throw new AppError(
      response.status === 401
        ? 'GOOGLE_ADS_ACCESS_FAILED'
        : 'UPSTREAM_UNAVAILABLE',
      response.status === 401 ? 409 : 503,
      response.status === 401
        ? 'Google Ads access could not be verified. Reconnect the selected Google account.'
        : 'Google Ads could not be checked right now. Your saved connection was not removed.',
    );
  return response.json();
}
