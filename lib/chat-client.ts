import { ApiError, requestApi } from './client';
import { aiProblem } from './ai-diagnostics';
import {
  eligibleAIProviders,
  type AIAvailability,
  type AIPreferences,
} from './ai-settings';

export type ChatResult = {
  status: 'completed' | 'failed' | 'working';
  runId: string;
  messageSaved?: boolean;
  agents?: string[];
  notice?: string;
  error?: { code: string; message: string };
};
export async function submitChat(
  token: string,
  input: unknown,
  onSaved: () => void = () => {},
): Promise<ChatResult> {
  let result: ChatResult;
  try {
    result = await requestApi<ChatResult>(token, 'chat', 'POST', input);
  } catch (error) {
    // Only an explicit server receipt may clear a saved message after failure.
    // An ambiguous network failure keeps the input and the same request ID.
    if (error instanceof ApiError && error.messageSaved && error.runId)
      result = {
        status: 'failed',
        runId: error.runId,
        messageSaved: true,
        error: { code: error.code, message: aiProblem(error.code) },
      };
    else throw error;
  }
  if (
    !result.messageSaved ||
    !/^[0-9a-f-]{36}$/i.test(result.runId || '') ||
    !['completed', 'failed', 'working'].includes(result.status)
  )
    throw new Error(
      'The message receipt could not be confirmed. Your text is kept; retrying Send will use the same request reference.',
    );
  onSaved();
  return result;
}
export function chatBlockedReason(
  signedIn: boolean,
  workspace:
    | (AIPreferences & { ai_consent_at: string | null })
    | null
    | undefined,
  availability: AIAvailability | undefined,
  busy: boolean,
): string {
  if (!signedIn) return 'Sign in to use Chat.';
  if (!workspace) return 'Create your Workbench to use Chat.';
  if (!workspace.ai_consent_at)
    return 'AI processing is off. Open Connections to choose your providers and enable it.';
  if (!availability || !eligibleAIProviders(workspace, availability).length)
    return 'No permitted AI provider is configured. Review AI providers in Connections.';
  return busy
    ? 'Your crew is working. Please wait before sending another message.'
    : '';
}
