import { z } from 'zod';
import type { AdsReport, ResourceChoice } from '../integrations';
import { adsRead } from './provider-http';
import {
  googleAdsAccess,
  markConnectionReconnectRequired,
  providerCredentials,
  recordConnectionVerification,
} from './connections';
import { AppError, requireValue } from './errors';
const Customer = z.object({
  id: z.string().regex(/^\d{10}$/),
  descriptiveName: z.string().optional(),
  currencyCode: z.string().length(3),
  timeZone: z.string(),
  manager: z.boolean().optional(),
});
export async function readAdsAccount(
  token: string,
  id: string,
  loginCustomerId?: string,
): Promise<ResourceChoice> {
  z.string()
    .regex(/^\d{10}$/)
    .parse(id);
  const data = await adsRead(
    token,
    'customers/' + id + '/googleAds:search',
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1',
    loginCustomerId,
  );
  const account = z
    .object({ results: z.array(z.object({ customer: Customer })).min(1) })
    .parse(data).results[0].customer;
  requireValue(
    account.id === id && !account.manager,
    'ADS_ADVERTISER_REQUIRED',
    409,
    'Choose an advertiser account, not a manager account.',
  );
  return {
    id,
    name: account.descriptiveName || 'Google Ads ' + id,
    currency: account.currencyCode,
    timeZone: account.timeZone,
    ...(loginCustomerId ? { loginCustomerId } : {}),
  };
}
export async function discoverAdsAccounts(token: string) {
  const data = z
    .object({
      resourceNames: z
        .array(z.string().regex(/^customers\/\d{10}$/))
        .default([]),
    })
    .parse(await adsRead(token, 'customers:listAccessibleCustomers'));
  const choices: ResourceChoice[] = [];
  let limited = data.resourceNames.length > 20;
  for (const resource of data.resourceNames.slice(0, 20)) {
    const root = resource.split('/')[1];
    // Manager hierarchy read uses the authorized root as login-customer-id.
    const response = await adsRead(
      token,
      resource + '/googleAds:search',
      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED' LIMIT 100",
      root,
    );
    const rows = z
      .object({
        results: z
          .array(
            z.object({
              customerClient: z.object({
                id: z.string().regex(/^\d{10}$/),
                descriptiveName: z.string().optional(),
                currencyCode: z.string().length(3),
                timeZone: z.string(),
                manager: z.boolean().optional(),
              }),
            }),
          )
          .default([]),
      })
      .parse(response).results;
    if (rows.length === 100) limited = true;
    for (const { customerClient: c } of rows)
      if (!c.manager && !choices.some((x) => x.id === c.id))
        choices.push({
          id: c.id,
          name: c.descriptiveName || 'Google Ads ' + c.id,
          currency: c.currencyCode,
          timeZone: c.timeZone,
          ...(root !== c.id ? { loginCustomerId: root } : {}),
        });
  }
  return {
    resources: choices.slice(0, 100),
    limited: limited || choices.length > 100,
  };
}
const Counts = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform(String);
const ReportRows = z.array(
  z.object({
    campaign: z.object({
      id: z.string().regex(/^\d+$/),
      name: z.string(),
      status: z.string(),
    }),
    metrics: z
      .object({
        impressions: Counts.default('0'),
        clicks: Counts.default('0'),
        costMicros: Counts.default('0'),
        conversions: z
          .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
          .transform(Number)
          .pipe(z.number().nonnegative())
          .optional(),
      })
      .default({ impressions: '0', clicks: '0', costMicros: '0' }),
  }),
);
export function parseAdsReport(
  data: unknown,
  account: ResourceChoice,
): AdsReport {
  const rows = ReportRows.parse(
    z.object({ results: z.unknown().optional() }).parse(data).results || [],
  );
  return {
    account,
    period: 'LAST_30_DAYS',
    fetchedAt: new Date().toISOString(),
    limited: rows.length >= 100,
    campaigns: rows.map(({ campaign: c, metrics: m }) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      impressions: m.impressions,
      clicks: m.clicks,
      costMicros: m.costMicros,
      conversions: m.conversions ?? null,
    })),
  };
}
export async function googleAdsReport(workspaceId: string) {
  const credentials = await providerCredentials(workspaceId, 'google_ads');
  try {
    const token = await googleAdsAccess(credentials.token);
    const account = await readAdsAccount(
      token,
      credentials.resource.id,
      credentials.resource.loginCustomerId,
    );
    const data = await adsRead(
      token,
      'customers/' + account.id + '/googleAds:search',
      "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED' ORDER BY campaign.id LIMIT 100",
      account.loginCustomerId,
    );
    const report = parseAdsReport(data, account);
    await recordConnectionVerification(
      workspaceId,
      'google_ads',
      credentials.connectionId,
    );
    return report;
  } catch (error) {
    if (
      error instanceof AppError &&
      ['GOOGLE_ADS_ACCESS_FAILED', 'RECONNECT_REQUIRED'].includes(error.code)
    )
      await markConnectionReconnectRequired(
        workspaceId,
        'google_ads',
        credentials.connectionId,
        'GOOGLE_ADS_ACCESS_REVOKED',
      );
    throw error;
  }
}

export async function verifyGoogleAdsConnection(
  workspaceId: string,
  connectionId: string,
) {
  try {
    const connection = await providerCredentials(
      workspaceId,
      'google_ads',
      connectionId,
    );
    const account = await readAdsAccount(
      await googleAdsAccess(connection.token),
      connection.resource.id,
      connection.resource.loginCustomerId,
    );
    await recordConnectionVerification(
      workspaceId,
      'google_ads',
      connectionId,
      {
        displayName: account.name,
        metadata: {
          currency: account.currency || null,
          timeZone: account.timeZone || null,
          loginCustomerId: account.loginCustomerId || null,
        },
      },
    );
    return account;
  } catch (error) {
    if (
      error instanceof AppError &&
      ['GOOGLE_ADS_ACCESS_FAILED', 'RECONNECT_REQUIRED'].includes(error.code)
    ) {
      await markConnectionReconnectRequired(
        workspaceId,
        'google_ads',
        connectionId,
        'GOOGLE_ADS_ACCESS_REVOKED',
      );
      throw new AppError(
        'RECONNECT_REQUIRED',
        409,
        'Reconnect Google Ads to restore reporting access.',
      );
    }
    throw error;
  }
}
