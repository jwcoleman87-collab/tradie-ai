import { ApiError, requestApi } from './client';
import { aiProblem } from './ai-diagnostics';
import type { ChatMessage } from './contracts';
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
  requestId?: string;
  userMessageId?: string;
  assistantMessage?: ChatMessage;
};
export type ChatProgress = {
  runId: string;
  stage:
    | 'context'
    | 'routing'
    | 'calendar'
    | 'research'
    | 'response'
    | 'persistence';
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const receiptProblem =
  'The message receipt could not be confirmed. Your text is kept; retrying Send will use the same request reference.';
export function confirmedChatReceipt(value: unknown): value is ChatResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as ChatResult;
  return (
    result.messageSaved === true &&
    uuid.test(result.runId || '') &&
    ['completed', 'failed', 'working'].includes(result.status)
  );
}
export const chatStageLabel = (stage: ChatProgress['stage']) =>
  ({
    context: 'Reading the relevant workspace details…',
    routing: 'Choosing the crew for your request…',
    calendar: 'Checking current calendar availability…',
    research: 'Checking current public sources…',
    response: 'Your crew is preparing a reply…',
    persistence: 'Saving your reply and proposals…',
  })[stage];

export async function submitChat(
  token: string,
  input: unknown,
  onSaved: (receipt: ChatResult) => void = () => {},
  onProgress: (progress: ChatProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ChatResult> {
  let result: ChatResult;
  let saved: ChatResult | undefined;
  const startedAt = performance.now();
  const requestId =
    input &&
    typeof input === 'object' &&
    'requestId' in input &&
    typeof input.requestId === 'string'
      ? input.requestId
      : undefined;
  const confirm = (receipt: unknown): ChatResult => {
    if (!confirmedChatReceipt(receipt)) throw new Error(receiptProblem);
    if (receipt.requestId && requestId && receipt.requestId !== requestId)
      throw new Error(receiptProblem);
    if (saved && receipt.runId !== saved.runId) throw new Error(receiptProblem);
    if (!saved) {
      onSaved(receipt);
      try {
        performance.measure('workbench.chat.acknowledgement', {
          start: startedAt,
          end: performance.now(),
          detail: { requestId, runId: receipt.runId, status: receipt.status },
        });
      } catch {
        /* Optional browser diagnostics cannot invalidate a saved receipt. */
      }
    }
    saved = receipt;
    return receipt;
  };
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(165_000),
      ]),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(input),
    });
    if (
      response.ok &&
      response.headers.get('content-type')?.includes('application/x-ndjson')
    ) {
      if (!response.body) throw new Error(receiptProblem);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal: ChatResult | undefined;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'progress') {
          if (
            saved &&
            event.runId === saved.runId &&
            typeof event.stage === 'string' &&
            [
              'context',
              'routing',
              'calendar',
              'research',
              'response',
              'persistence',
            ].includes(event.stage)
          )
            onProgress({
              runId: saved.runId,
              stage: event.stage as ChatProgress['stage'],
            });
          return;
        }
        const receipt = confirm(event);
        if (receipt.status !== 'working') terminal = receipt;
      };
      try {
        while (!terminal) {
          const { value, done } = await reader.read();
          buffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true });
          if (buffer.length > 256_000)
            throw new Error(
              'The reply stream was too large. Checking the saved request.',
            );
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            consume(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
          if (done) {
            if (buffer.trim()) consume(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      result =
        terminal ||
        saved ||
        (() => {
          throw new Error(receiptProblem);
        })();
    } else {
      const data = await response.json();
      if (!response.ok)
        throw new ApiError(
          data.error?.message || 'The request failed.',
          data.error?.code || String(response.status),
          response.status,
          data.messageSaved === true,
          data.runId,
        );
      result = confirm(data);
    }
  } catch (error) {
    // Only an explicit server receipt may clear a saved message after failure.
    // An ambiguous network failure keeps the input and the same request ID.
    if (signal?.aborted) throw error;
    if (saved) return saved;
    if (error instanceof ApiError && error.messageSaved && error.runId)
      result = {
        status: 'failed',
        runId: error.runId,
        messageSaved: true,
        error: { code: error.code, message: aiProblem(error.code) },
      };
    else throw error;
  }
  const receipt = confirm(result);
  if (receipt.status !== 'working') {
    try {
      performance.measure('workbench.chat.reply', {
        start: startedAt,
        end: performance.now(),
        detail: { requestId, runId: receipt.runId, status: receipt.status },
      });
    } catch {
      /* Diagnostics must never hide a completed reply. */
    }
  }
  return receipt;
}
export async function chatStatus(
  token: string,
  workspaceId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const query = new URLSearchParams({ workspaceId, requestId });
  const result = await requestApi<ChatResult>(
    token,
    `chat/status?${query}`,
    'GET',
    undefined,
    AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
  );
  if (!confirmedChatReceipt(result))
    throw new Error(
      'The saved request status could not be checked. Retrying shortly.',
    );
  if (result.requestId && result.requestId !== requestId)
    throw new Error(
      'The saved request status did not match this message. Retrying shortly.',
    );
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
