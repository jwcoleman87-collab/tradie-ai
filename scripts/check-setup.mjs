// Prints readiness only. Never prints secret values or upstream response bodies.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const value = (name) => process.env[name]?.trim() || '';
const present = (name) => !!value(name);
const encryption =
  Buffer.from(value('TOKEN_ENCRYPTION_KEY'), 'base64').length === 32;
const result = {
  supabaseConfigured: [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].every(present),
  encryptionKeyValid: encryption,
  openaiKeyConfigured: present('OPENAI_API_KEY'),
  claudeKeyConfigured: present('ANTHROPIC_API_KEY'),
  calendarConfigured:
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_ORIGIN'].every(present) &&
    encryption,
  facebookConfigured:
    [
      'META_APP_ID',
      'META_APP_SECRET',
      'META_LOGIN_CONFIG_ID',
      'META_GRAPH_VERSION',
      'APP_ORIGIN',
    ].every(present) && encryption,
  facebookPublishingEnabled: value('FACEBOOK_PUBLISHING_ENABLED') === 'true',
  googleAdsConfigured:
    present('GOOGLE_ADS_DEVELOPER_TOKEN') &&
    !!(value('GOOGLE_ADS_CLIENT_ID') || value('GOOGLE_CLIENT_ID')) &&
    !!(value('GOOGLE_ADS_CLIENT_SECRET') || value('GOOGLE_CLIENT_SECRET')) &&
    encryption,
};
result.backupKeysConfigured =
  result.openaiKeyConfigured && result.claudeKeyConfigured;
result.liveModelCallsVerified = false;
if (process.argv.includes('--remote') && result.supabaseConfigured) {
  const base = new URL(value('SUPABASE_URL'));
  if (
    base.protocol !== 'https:' ||
    !base.hostname.endsWith('.supabase.co') ||
    base.username ||
    base.password
  )
    throw new Error('Expected the intended HTTPS Supabase project URL.');
  const headers = {
    apikey: value('SUPABASE_SERVICE_ROLE_KEY'),
    Authorization: 'Bearer ' + value('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const checks = {
    providerPreferences:
      'workspaces?select=ai_primary_provider,ai_fallback_enabled,ai_allowed_providers&limit=0',
    runTrace: 'agent_runs?select=usage,provider_trace&limit=0',
    multiProviderCredentials:
      'integration_credentials?select=provider,credential_kind,external_id&limit=0',
    publicationReceipts: 'external_publish_attempts?select=action_id&limit=0',
    intelligentOnboarding:
      'business_profile_facts?select=workspace_id,field_path,confidence,fact_state&limit=0',
  };
  result.schema = {};
  for (const [name, path] of Object.entries(checks)) {
    try {
      const response = await fetch(new URL('/rest/v1/' + path, base), {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      result.schema[name] = response.ok
        ? 'ready'
        : 'not_ready_http_' + response.status;
      await response.body?.cancel();
    } catch {
      result.schema[name] = 'unreachable';
    }
  }
  if (Object.values(result.schema).some((v) => v !== 'ready'))
    process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
if (!result.supabaseConfigured || !encryption) process.exitCode = 1;
