import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adsRead,
  graphRead,
  readProviderErrorBody,
  googleRefreshFailure,
} from '../lib/server/provider-http';
import { discoverAdsAccounts } from '../lib/server/google-ads';

beforeEach(() => {
  vi.stubEnv('META_APP_SECRET', 'test-secret');
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'test-developer-token');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const googleError = (code: string, field = 'authorizationError') => ({
  error: {
    status: 'PERMISSION_DENIED',
    message: 'secret-token customer@example.com',
    details: [
      {
        errors: [
          { errorCode: { [field]: code }, message: 'private customer content' },
        ],
      },
    ],
  },
});
const readAds = () =>
  adsRead(
    'valid-token',
    'customers/1234567890/googleAds:search',
    'SELECT customer.id FROM customer',
  );
const requestedUrl = (value: string | URL | Request) =>
  typeof value === 'string'
    ? value
    : value instanceof URL
      ? value.href
      : value.url;

describe('sanitized provider errors', () => {
  it.each(['google_ads', 'google_calendar'] as const)(
    'classifies %s refresh failures without revoking valid authorization',
    async (provider) => {
      for (const [status, reason, code] of [
        [400, 'invalid_grant', 'RECONNECT_REQUIRED'],
        [
          400,
          'invalid_client',
          provider.toUpperCase() + '_CONFIGURATION_REQUIRED',
        ],
        [
          401,
          'unauthorized_client',
          provider.toUpperCase() + '_CONFIGURATION_REQUIRED',
        ],
        [400, 'temporarily_unavailable', 'UPSTREAM_UNAVAILABLE'],
        [503, 'invalid_grant', 'UPSTREAM_UNAVAILABLE'],
        [429, 'invalid_grant', 'PROVIDER_RATE_LIMITED'],
        [400, 'NEW_UNKNOWN_ERROR', provider.toUpperCase() + '_CHECK_FAILED'],
      ] as const) {
        const failure = await googleRefreshFailure(
          Response.json(
            {
              error: reason,
              error_description: 'secret-token customer@example.com',
            },
            { status },
          ),
          provider,
        );
        expect(failure.code).toBe(code);
        expect(String(failure)).not.toMatch(/secret-token|customer@example/);
      }
    },
  );
  it.each([
    [400, { code: 4, is_transient: true }, 'PROVIDER_RATE_LIMITED', 429],
    [403, { code: 17 }, 'PROVIDER_RATE_LIMITED', 429],
    [400, { code: 2 }, 'UPSTREAM_UNAVAILABLE', 503],
    [400, { code: 190, is_transient: true }, 'UPSTREAM_UNAVAILABLE', 503],
    [400, { code: 190 }, 'FACEBOOK_ACCESS_FAILED', 409],
    [401, { code: 102 }, 'FACEBOOK_ACCESS_FAILED', 409],
    [403, { code: 200 }, 'FACEBOOK_PERMISSIONS_REQUIRED', 409],
    [400, { code: 100 }, 'FACEBOOK_CHECK_FAILED', 409],
    [503, { code: 190 }, 'UPSTREAM_UNAVAILABLE', 503],
  ])(
    'classifies Graph HTTP %s with %j',
    async (status, error, code, resultStatus) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(
          {
            error: {
              ...(error as object),
              message: 'secret-token customer@example.com',
            },
          },
          { status: Number(status) },
        ),
      );
      const failure = await graphRead('12345', 'saved-token').catch(
        (cause: unknown) => cause,
      );
      expect(failure).toMatchObject({ code, status: resultStatus });
      expect(String(failure)).not.toMatch(/secret-token|customer@example/);
    },
  );

  it.each([
    [
      'USER_PERMISSION_DENIED',
      'authorizationError',
      'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED',
      'account',
    ],
    [
      'CUSTOMER_NOT_ENABLED',
      'authorizationError',
      'GOOGLE_ADS_ACCOUNT_DISABLED',
      'account',
    ],
    [
      'DEVELOPER_TOKEN_NOT_APPROVED',
      'authorizationError',
      'GOOGLE_ADS_CONFIGURATION_REQUIRED',
      'global',
    ],
    [
      'DEVELOPER_TOKEN_INVALID',
      'authenticationError',
      'GOOGLE_ADS_CONFIGURATION_REQUIRED',
      'global',
    ],
    [
      'OAUTH_TOKEN_REVOKED',
      'authenticationError',
      'GOOGLE_ADS_ACCESS_FAILED',
      'global',
    ],
    [
      'NOT_ADS_USER',
      'authenticationError',
      'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED',
      'global',
    ],
    ['RESOURCE_EXHAUSTED', 'quotaError', 'PROVIDER_RATE_LIMITED', 'global'],
    ['TRANSIENT_ERROR', 'internalError', 'UPSTREAM_UNAVAILABLE', 'global'],
    [
      'NEW_UNKNOWN_CODE',
      'authorizationError',
      'GOOGLE_ADS_CHECK_FAILED',
      'global',
    ],
  ])(
    'classifies Google Ads %s without exposing provider messages',
    async (reason, field, code, scope) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(googleError(reason, field), { status: 403 }),
      );
      const failure = await readAds().catch((cause: unknown) => cause);
      expect(failure).toMatchObject({ code, scope });
      expect(String(failure) + JSON.stringify(failure)).not.toMatch(
        /secret-token|customer@example|private customer/,
      );
    },
  );

  it('recognizes missing OAuth scope in Google ErrorInfo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
              },
            ],
          },
        },
        { status: 403 },
      ),
    );
    await expect(readAds()).rejects.toMatchObject({
      code: 'GOOGLE_ADS_ACCESS_FAILED',
      scope: 'global',
    });
  });

  it('keeps mixed account and unknown errors global', async () => {
    const response = googleError('USER_PERMISSION_DENIED');
    response.error.details[0].errors.push({
      errorCode: { authorizationError: 'NEW_UNKNOWN_CODE' },
      message: 'private',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(response, { status: 403 }),
    );
    await expect(readAds()).rejects.toMatchObject({
      code: 'GOOGLE_ADS_CHECK_FAILED',
      scope: 'global',
    });
  });

  it('does not infer OAuth revocation from an oversized unclassified HTTP 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'DEVELOPER_TOKEN_INVALID',
            message: 'x'.repeat(17000),
          },
        },
        { status: 401 },
      ),
    );
    await expect(readAds()).rejects.toMatchObject({
      code: 'GOOGLE_ADS_CHECK_FAILED',
    });
  });

  it('does not mislabel an unstructured permission response as an outage or revoked token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>private</html>', { status: 403 }),
    );
    await expect(readAds()).rejects.toMatchObject({
      code: 'GOOGLE_ADS_CHECK_FAILED',
      status: 409,
    });
  });

  it('bounds error-body reads and cancels the remaining stream', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel,
    });
    await expect(
      readProviderErrorBody(new Response(stream, { status: 400 })),
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

const account = (id: string) => ({
  customerClient: {
    id,
    descriptiveName: 'Verified advertiser',
    currencyCode: 'AUD',
    timeZone: 'Australia/Sydney',
    manager: false,
  },
});
describe('Google Ads discovery isolation', () => {
  it('offers valid accounts when another root denies access', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        if (requestedUrl(url).includes('listAccessibleCustomers'))
          return Response.json({
            resourceNames: ['customers/1111111111', 'customers/2222222222'],
          });
        if (requestedUrl(url).includes('1111111111'))
          return Response.json(googleError('USER_PERMISSION_DENIED'), {
            status: 403,
          });
        return Response.json({ results: [account('3333333333')] });
      });
    await expect(discoverAdsAccounts('token')).resolves.toEqual({
      resources: [
        {
          id: '3333333333',
          name: 'Verified advertiser',
          currency: 'AUD',
          timeZone: 'Australia/Sydney',
          loginCustomerId: '2222222222',
        },
      ],
      limited: false,
      incomplete: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    'DEVELOPER_TOKEN_NOT_APPROVED',
    'OAUTH_TOKEN_REVOKED',
    'RESOURCE_EXHAUSTED',
    'UNKNOWN_ERROR',
  ])(
    'never hides the global %s failure behind another successful root',
    async (code) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (requestedUrl(url).includes('listAccessibleCustomers'))
          return Response.json({
            resourceNames: ['customers/1111111111', 'customers/2222222222'],
          });
        if (requestedUrl(url).includes('1111111111'))
          return Response.json(googleError(code), { status: 403 });
        return Response.json({ results: [account('3333333333')] });
      });
      await expect(discoverAdsAccounts('token')).rejects.toMatchObject({
        scope: 'global',
      });
    },
  );

  it('retains actionable account errors when no root succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ resourceNames: ['customers/1111111111'] }),
      )
      .mockResolvedValueOnce(
        Response.json(googleError('CUSTOMER_NOT_ENABLED'), { status: 403 }),
      );
    await expect(discoverAdsAccounts('token')).rejects.toMatchObject({
      code: 'GOOGLE_ADS_ACCOUNT_DISABLED',
    });
  });

  it('queries at most four roots concurrently and caps discovery at twenty roots', async () => {
    let active = 0,
      maximum = 0,
      queried = 0;
    const releases: (() => void)[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (requestedUrl(url).includes('listAccessibleCustomers'))
        return Response.json({
          resourceNames: Array.from(
            { length: 22 },
            (_, i) => `customers/${1000000000 + i}`,
          ),
        });
      queried++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return Response.json({ results: [account('3333333333')] });
    });
    const result = discoverAdsAccounts('token');
    for (let batch = 0; batch < 5; batch++) {
      await vi.waitFor(() => expect(releases).toHaveLength(4));
      releases.splice(0).forEach((release) => release());
    }
    expect(await result).toMatchObject({ limited: true, incomplete: false });
    expect(maximum).toBe(4);
    expect(queried).toBe(20);
  });
});
