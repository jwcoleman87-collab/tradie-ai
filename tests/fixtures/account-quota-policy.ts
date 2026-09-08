// Explicit synthetic policy for general integration fixtures. Production has
// no invented daily/concurrency/total defaults. Limit-specific tests replace
// these values with their own asserted boundary before exercising that limit.
export const testAccountQuotaPolicy = {
  chat_burst: 12,
  chat_daily: 10000,
  chat_concurrency: 1000,
  onboarding_burst: 10,
  onboarding_daily: 10000,
  workspace_active: 20,
  workspace_total: 10000,
  workspace_daily: 10000,
};

export async function configureTestAccountQuotas(db: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}) {
  await db.query('select public.configure_account_quotas($1)', [
    JSON.stringify(testAccountQuotaPolicy),
  ]);
}
