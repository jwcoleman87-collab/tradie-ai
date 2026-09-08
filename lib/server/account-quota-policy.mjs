// Deployment input for the authoritative database policy. Runtime requests
// never accept quota values from browser payloads or optional RPC arguments.
export const accountQuotaFields = {
  chat_burst: { env: 'ACCOUNT_CHAT_BURST_LIMIT', default: 12 },
  chat_daily: { env: 'ACCOUNT_CHAT_DAILY_LIMIT' },
  chat_concurrency: { env: 'ACCOUNT_CHAT_CONCURRENCY_LIMIT' },
  onboarding_burst: { env: 'ACCOUNT_ONBOARDING_BURST_LIMIT', default: 10 },
  onboarding_daily: { env: 'ACCOUNT_ONBOARDING_DAILY_LIMIT' },
  workspace_active: { env: 'ACCOUNT_WORKSPACE_ACTIVE_LIMIT', default: 20 },
  workspace_total: { env: 'ACCOUNT_WORKSPACE_TOTAL_LIMIT' },
  workspace_daily: { env: 'ACCOUNT_WORKSPACE_DAILY_LIMIT' },
};

/** @param {Record<string, string | undefined>} environment */
export function parseAccountQuotaPolicy(environment = process.env) {
  return Object.fromEntries(
    Object.entries(accountQuotaFields).map(([key, field]) => {
      const value = environment[field.env];
      const text =
        value === undefined && 'default' in field
          ? String(field.default)
          : value?.trim();
      if (
        typeof text !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(text) ||
        Number(text) > 2147483647
      )
        throw new Error(
          `QUOTA_CONFIG_INVALID: ${field.env} must be an explicit integer from 0 to 2147483647; zero disables this ceiling.`,
        );
      return [key, Number(text)];
    }),
  );
}
