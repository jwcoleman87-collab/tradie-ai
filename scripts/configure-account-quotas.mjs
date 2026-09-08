import { pathToFileURL } from 'node:url';
import { parseAccountQuotaPolicy } from '../lib/server/account-quota-policy.mjs';

// --check only validates. --apply is the explicit administrative operation.
// All values validate before the first network call. No secrets or upstream
// response bodies are printed. No runtime request mutates account policy.
/** @param {{environment?: Record<string, string | undefined>, apply?: boolean, fetcher?: typeof fetch}} options */
export async function configureAccountQuotas({
  environment = process.env,
  apply = false,
  fetcher = fetch,
} = {}) {
  const policy = parseAccountQuotaPolicy(environment);
  if (!apply) return { validated: true, applied: false, policy };
  let destination;
  try {
    destination = new URL(environment.SUPABASE_URL || '');
    if (
      destination.username ||
      destination.password ||
      destination.search ||
      destination.hash ||
      destination.pathname !== '/' ||
      !(
        destination.protocol === 'https:' ||
        (destination.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname))
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      'QUOTA_CONFIG_INVALID: SUPABASE_URL must name the intended HTTPS project or isolated loopback service.',
    );
  }
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key)
    throw new Error(
      'QUOTA_CONFIG_INVALID: a service-role credential is required to apply policy.',
    );
  const response = await fetcher(
    new URL('/rest/v1/rpc/configure_account_quotas', destination),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_policy: policy }),
    },
  );
  if (!response.ok)
    throw new Error(`Quota policy was not applied (HTTP ${response.status}).`);
  return { validated: true, applied: true, policy };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--check', '--apply'].includes(args[0]))
      throw new Error(
        'Usage: node --env-file=.env.local scripts/configure-account-quotas.mjs --check|--apply',
      );
    console.log(
      JSON.stringify(
        await configureAccountQuotas({ apply: args[0] === '--apply' }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
