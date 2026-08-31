import { AppError } from './errors';
export function env(name: string) {
  return process.env[name]?.trim() || '';
}
export function required(name: string) {
  const value = env(name);
  if (!value)
    throw new AppError(
      'SETUP_REQUIRED',
      503,
      'This workspace needs its service connection configured.',
    );
  return value;
}
export function publicConfig() {
  const url = env('SUPABASE_URL'),
    anonKey = env('SUPABASE_ANON_KEY');
  // Fail closed if a server key is accidentally assigned to the public slot.
  let role = '';
  try {
    role =
      JSON.parse(
        Buffer.from(anonKey.split('.')[1] || '', 'base64url').toString(),
      ).role || '';
  } catch {
    /* publishable keys are not JWTs */
  }
  if (anonKey.startsWith('sb_secret_') || role === 'service_role')
    throw new AppError(
      'PUBLIC_KEY_INVALID',
      503,
      'A public Supabase key is required. Server keys must remain private.',
    );
  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    configured: !!(url && anonKey && env('SUPABASE_SERVICE_ROLE_KEY')),
    aiReady: !!(env('OPENAI_API_KEY') || env('ANTHROPIC_API_KEY')),
    aiProviders: {
      openai: !!env('OPENAI_API_KEY'),
      anthropic: !!env('ANTHROPIC_API_KEY'),
    },
    googleReady: !!(
      env('GOOGLE_CLIENT_ID') &&
      env('GOOGLE_CLIENT_SECRET') &&
      env('TOKEN_ENCRYPTION_KEY') &&
      env('APP_ORIGIN')
    ),
  };
}
export function appOrigin() {
  const url = new URL(required('APP_ORIGIN'));
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new AppError('INVALID_ORIGIN', 503);
  return url.origin;
}
