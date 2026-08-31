import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type ClientConfig = {
  configured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  aiReady: boolean;
  googleReady: boolean;
};
let client: SupabaseClient | undefined;
export function authClient(config: ClientConfig) {
  return (client ??= createClient(config.supabaseUrl, config.supabaseAnonKey));
}
export async function requestApi<T>(
  token: string,
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = (await response.json()) as T & {
    error?: { message: string; code: string };
  };
  if (!response.ok)
    throw new Error(
      `${result.error?.message || 'The request failed.'} [${result.error?.code || response.status}]`,
    );
  return result as T;
}
