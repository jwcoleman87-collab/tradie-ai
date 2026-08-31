import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AIAvailability } from './ai-settings';
export type ClientConfig = {
  configured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  aiReady: boolean;
  aiProviders: AIAvailability;
  googleReady: boolean;
};
let client: SupabaseClient | undefined;
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public messageSaved = false,
    public runId?: string,
  ) {
    super(message);
  }
}
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
    messageSaved?: boolean;
    runId?: string;
  };
  if (!response.ok)
    throw new ApiError(
      `${result.error?.message || 'The request failed.'} [${result.error?.code || response.status}]`,
      result.error?.code || String(response.status),
      response.status,
      result.messageSaved === true,
      result.runId,
    );
  return result as T;
}
