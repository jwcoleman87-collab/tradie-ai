import { z } from 'zod';
import { AppError, requireValue, timedFetch } from './errors';
import { required } from './config';
import { adsVersion, graphVersion } from './provider-config';
export const ExternalId = z.string().regex(/^\d{1,30}$/);

// Error bodies can contain credentials, customer content and very large HTML
// responses. Read at most 16 KiB and retain only recognized machine codes.
export async function readProviderErrorBody(
  response: Response,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function googleRefreshFailure(
  response: Response,
  provider: 'google_ads' | 'google_calendar',
): Promise<AppError> {
  const name = provider === 'google_ads' ? 'Google Ads' : 'Google Calendar';
  const parsed = z
    .object({ error: z.string().max(100) })
    .safeParse(await readProviderErrorBody(response));
  const code = parsed.success ? parsed.data.error : undefined;
  if (response.status === 429)
    return new AppError(
      'PROVIDER_RATE_LIMITED',
      429,
      'Google is limiting requests. Wait before checking again. Your saved connection was not removed.',
    );
  if (
    response.status >= 500 ||
    code === 'temporarily_unavailable' ||
    code === 'server_error'
  )
    return new AppError(
      'UPSTREAM_UNAVAILABLE',
      503,
      `${name} could not be checked right now. Try again later. Your saved connection was not removed.`,
    );
  if (code === 'invalid_grant')
    return new AppError(
      'RECONNECT_REQUIRED',
      409,
      `Reconnect ${name} to restore access.`,
    );
  if (
    [
      'invalid_client',
      'unauthorized_client',
      'invalid_scope',
      'unsupported_grant_type',
    ].includes(code || '')
  )
    return new AppError(
      provider.toUpperCase() + '_CONFIGURATION_REQUIRED',
      409,
      `${name} application credentials need attention. Ask the site operator to check the OAuth client configuration.`,
    );
  return new AppError(
    provider.toUpperCase() + '_CHECK_FAILED',
    409,
    'Google rejected the authorization check. Ask the site operator to check the connection configuration, then try again.',
  );
}

export class ProviderReadError extends AppError {
  constructor(
    code: string,
    status: number,
    message: string,
    public readonly scope: 'account' | 'global' = 'global',
  ) {
    super(code, status, message);
  }
}

// https://developers.facebook.com/docs/graph-api/guides/error-handling/
function graphFailure(status: number, body: unknown): AppError {
  const parsed = z
    .object({
      error: z.object({
        code: z.number().int().optional(),
        is_transient: z.boolean().optional(),
      }),
    })
    .safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (status === 429 || (code !== undefined && [4, 17, 32, 613].includes(code)))
    return new AppError(
      'PROVIDER_RATE_LIMITED',
      429,
      'Facebook is limiting requests. Wait a few minutes, then check again. Your saved connection was not removed.',
    );
  if (
    status >= 500 ||
    (parsed.success && parsed.data.error.is_transient) ||
    code === 1 ||
    code === 2
  )
    return new AppError(
      'UPSTREAM_UNAVAILABLE',
      503,
      'Facebook could not be checked right now. Try again later. Your saved connection was not removed.',
    );
  if (code === 190 || code === 102)
    return new AppError(
      'FACEBOOK_ACCESS_FAILED',
      409,
      'Facebook rejected the saved authorization. Reconnect Facebook to restore Page access.',
    );
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299))
    return new AppError(
      'FACEBOOK_PERMISSIONS_REQUIRED',
      409,
      'Facebook denied Page permissions. Restore Page access and reconnect with the required permissions.',
    );
  return new AppError(
    'FACEBOOK_CHECK_FAILED',
    409,
    'Facebook could not verify this Page. Check Page access and application configuration, then check again.',
  );
}

const AdsErrorBody = z.object({
  error: z.object({
    status: z.string().max(80).optional(),
    details: z
      .array(
        z.object({
          reason: z.string().max(100).optional(),
          errors: z
            .array(
              z.object({
                errorCode: z.record(z.string().max(80), z.string().max(100)),
              }),
            )
            .max(32)
            .optional(),
        }),
      )
      .max(16)
      .optional(),
  }),
});

// https://developers.google.com/google-ads/api/docs/common-errors
function adsFailure(status: number, body: unknown): ProviderReadError {
  const parsed = AdsErrorBody.safeParse(body);
  const details = parsed.success ? parsed.data.error.details || [] : [];
  const codes = details.flatMap((detail) => [
    ...(detail.reason ? [detail.reason] : []),
    ...(detail.errors || []).flatMap((error) => Object.values(error.errorCode)),
  ]);
  const has = (...values: string[]) =>
    codes.some((code) => values.includes(code));
  const configuration =
    codes.some((code) => code.startsWith('DEVELOPER_TOKEN_')) ||
    has(
      'ORGANIZATION_NOT_ASSOCIATED_WITH_DEVELOPER_TOKEN',
      'PROJECT_DISABLED',
      'PROJECT_NOT_PERMITTED',
      'SERVICE_DISABLED',
      'API_DISABLED',
    );
  if (configuration)
    return new ProviderReadError(
      'GOOGLE_ADS_CONFIGURATION_REQUIRED',
      409,
      'Google Ads application access needs attention. Ask the site operator to check the developer token, API access and Google Cloud project.',
    );
  if (
    has(
      'OAUTH_TOKEN_INVALID',
      'OAUTH_TOKEN_EXPIRED',
      'OAUTH_TOKEN_REVOKED',
      'OAUTH_TOKEN_DISABLED',
      'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
      'OAUTH_TOKEN_SCOPE_INSUFFICIENT',
    )
  )
    return new ProviderReadError(
      'GOOGLE_ADS_ACCESS_FAILED',
      409,
      'Google Ads rejected the saved authorization. Reconnect the selected Google account and allow reporting access.',
    );
  if (
    status === 429 ||
    has(
      'RESOURCE_EXHAUSTED',
      'RESOURCE_TEMPORARILY_EXHAUSTED',
      'EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION',
      'EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION',
    )
  )
    return new ProviderReadError(
      'PROVIDER_RATE_LIMITED',
      429,
      'Google Ads is limiting requests. Wait before checking again. Your saved connection was not removed.',
    );
  if (
    status >= 500 ||
    has('INTERNAL_ERROR', 'TRANSIENT_ERROR', 'DEADLINE_EXCEEDED')
  )
    return new ProviderReadError(
      'UPSTREAM_UNAVAILABLE',
      503,
      'Google Ads could not be checked right now. Try again later. Your saved connection was not removed.',
    );
  // Isolate a root only when every structured failure is account-specific.
  // Unknown, mixed and global failures must still stop OAuth discovery.
  const accountCodes = [
    'USER_PERMISSION_DENIED',
    'CUSTOMER_NOT_ENABLED',
    'CUSTOMER_NOT_FOUND',
    'CUSTOMER_NOT_ACTIVE',
    'CUSTOMER_NOT_ALLOWED',
    'LOGIN_CUSTOMER_ID_INVALID',
    'INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION',
  ];
  const accountOnly =
    codes.length > 0 && codes.every((code) => accountCodes.includes(code));
  if (accountOnly && has('CUSTOMER_NOT_ENABLED', 'CUSTOMER_NOT_ACTIVE'))
    return new ProviderReadError(
      'GOOGLE_ADS_ACCOUNT_DISABLED',
      409,
      'This Google Ads account is not enabled. Complete account setup or reactivate it in Google Ads, then check again.',
      'account',
    );
  if (accountOnly)
    return new ProviderReadError(
      'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED',
      409,
      'Google Ads account access could not be verified. Check the selected account and manager access in Google Ads, then check again or switch accounts.',
      'account',
    );
  if (has('NOT_ADS_USER'))
    return new ProviderReadError(
      'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED',
      409,
      'This Google account has no Google Ads access. Ask an account administrator to grant access, or switch Google accounts.',
    );
  if (status === 401 && parsed.success && codes.length === 0)
    return new ProviderReadError(
      'GOOGLE_ADS_ACCESS_FAILED',
      409,
      'Google Ads rejected the saved authorization. Reconnect the selected Google account.',
    );
  return new ProviderReadError(
    'GOOGLE_ADS_CHECK_FAILED',
    409,
    'Google Ads rejected the account check. Ask the site operator to check account access and application configuration before trying again.',
  );
}
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
    throw graphFailure(response.status, await readProviderErrorBody(response));
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
    throw adsFailure(response.status, await readProviderErrorBody(response));
  return response.json();
}
