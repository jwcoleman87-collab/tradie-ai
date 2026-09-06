'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Snapshot } from './contracts';
import {
  chatStageLabel,
  chatStatus,
  submitChat,
  type ChatResult,
} from './chat-client';

type Pending = {
  requestId: string;
  workspaceId: string;
  conversationId: string;
  runId?: string;
  stage: string;
};
type LocalMessage = ChatMessage & {
  workspaceId: string;
  conversationId: string;
  pending?: boolean;
};
export function useChatRun(
  token: string,
  snapshot: Snapshot | null,
  onComplete: (result: ChatResult) => void,
) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [settledRuns, setSettledRuns] = useState<string[]>([]);
  const activeStream = useRef<AbortController | null>(null);
  const completion = useRef(onComplete);
  const workspaceId = snapshot?.workspace.id || '';
  const conversationId = snapshot?.conversationId || '';
  const currentScope = useRef({ token, workspaceId, conversationId });
  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    if (
      currentScope.current.workspaceId !== workspaceId ||
      currentScope.current.conversationId !== conversationId
    ) {
      setPending(null);
      setLocalMessages((messages) =>
        messages.filter(
          (message) =>
            message.workspaceId === workspaceId &&
            message.conversationId === conversationId,
        ),
      );
    }
    currentScope.current = { token, workspaceId, conversationId };
    if (!token) {
      setLocalMessages([]);
      setPending(null);
      setSettledRuns([]);
    }
    return () => {
      activeStream.current?.abort();
      activeStream.current = null;
    };
  }, [token, workspaceId, conversationId]);
  const sameScope = useCallback(
    (w: string, c: string) =>
      currentScope.current.workspaceId === w &&
      currentScope.current.conversationId === c,
    [],
  );
  const finish = useCallback(
    (result: ChatResult, w: string, c: string) => {
      if (!sameScope(w, c)) return;
      if (
        result.assistantMessage &&
        result.assistantMessage.role === 'assistant' &&
        result.assistantMessage.run_id === result.runId &&
        typeof result.assistantMessage.content === 'string'
      ) {
        const message = result.assistantMessage;
        setLocalMessages((messages) => [
          ...messages.filter((m) => m.id !== message.id),
          { ...message, workspaceId: w, conversationId: c },
        ]);
      }
      setPending(null);
      setSettledRuns((runs) => [...runs, result.runId].slice(-100));
      completion.current(result);
    },
    [sameScope],
  );
  const workingRun = snapshot?.runs.find(
    (run) =>
      run.status === 'working' &&
      run.request_id &&
      !settledRuns.includes(run.id),
  );
  const watchedRequest =
    pending &&
    pending.workspaceId === workspaceId &&
    pending.conversationId === conversationId
      ? pending.requestId
      : workingRun?.request_id;
  // Replays, dropped streams and page reloads all recover through the same durable receipt.
  useEffect(() => {
    if (!token || !workspaceId || !conversationId || !watchedRequest) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (activeStream.current) {
        timer = setTimeout(() => void poll(), 2000);
        return;
      }
      try {
        const result = await chatStatus(
          token,
          workspaceId,
          watchedRequest,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        failures = 0;
        if (result.status !== 'working') {
          finish(result, workspaceId, conversationId);
          return;
        }
        setPending({
          workspaceId,
          conversationId,
          requestId: watchedRequest,
          runId: result.runId,
          stage: 'Message saved. Your crew is working…',
        });
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        setPending((value) =>
          value && sameScope(value.workspaceId, value.conversationId)
            ? {
                ...value,
                stage:
                  'The status check could not connect. Retrying automatically…',
              }
            : value,
        );
      }
      timer = setTimeout(
        () => void poll(),
        Math.min(15000, 2000 * 2 ** Math.min(failures, 3)),
      );
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, workspaceId, conversationId, watchedRequest, finish, sameScope]);

  const send = async (
    input: {
      workspaceId: string;
      conversationId: string;
      requestId: string;
      text: string;
      attachmentIds: string[];
    },
    onSaved: () => void,
  ) => {
    if (activeStream.current) return;
    const controller = new AbortController();
    activeStream.current = controller;
    let saved = false;
    setPending({ ...input, stage: 'Sending your message…' });
    setLocalMessages((messages) => [
      ...messages.filter((m) => m.id !== input.requestId),
      {
        id: input.requestId,
        run_id: null,
        role: 'user',
        content: input.text,
        attachment_ids: input.attachmentIds,
        created_at: new Date().toISOString(),
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        pending: true,
      },
    ]);
    try {
      const result = await submitChat(
        token,
        input,
        (receipt) => {
          saved = true;
          if (!sameScope(input.workspaceId, input.conversationId)) return;
          onSaved();
          setLocalMessages((messages) =>
            messages.map((m) =>
              m.id === input.requestId
                ? {
                    ...m,
                    id: receipt.userMessageId || m.id,
                    run_id: receipt.runId,
                    pending: false,
                  }
                : m,
            ),
          );
          setPending({
            ...input,
            runId: receipt.runId,
            stage: 'Message saved. Your crew is working…',
          });
        },
        (progress) => {
          if (sameScope(input.workspaceId, input.conversationId))
            setPending({
              ...input,
              runId: progress.runId,
              stage: chatStageLabel(progress.stage),
            });
        },
        controller.signal,
      );
      if (result && result.status !== 'working')
        finish(result, input.workspaceId, input.conversationId);
    } catch (error) {
      if (!saved)
        setLocalMessages((messages) =>
          messages.filter((m) => m.id !== input.requestId),
        );
      if (sameScope(input.workspaceId, input.conversationId) && !saved)
        setPending(null);
      if (!controller.signal.aborted) throw error;
    } finally {
      if (activeStream.current === controller) activeStream.current = null;
    }
  };
  const visiblePending =
    pending?.workspaceId === workspaceId &&
    pending.conversationId === conversationId
      ? pending
      : null;
  const visibleLocal = localMessages.filter(
    (m) =>
      m.workspaceId === workspaceId &&
      m.conversationId === conversationId &&
      !snapshot?.messages.some(
        (saved) =>
          saved.id === m.id ||
          (m.run_id && m.run_id === saved.run_id && m.role === saved.role),
      ),
  );
  return {
    send,
    messages: [...(snapshot?.messages || []), ...visibleLocal].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    ),
    busy: !!visiblePending || !!workingRun,
    accepted: !!visiblePending?.runId || !!workingRun,
    stage:
      visiblePending?.stage ||
      (workingRun ? 'Message saved. Checking your crew’s progress…' : ''),
    pendingMessageIds: new Set(
      visibleLocal.filter((m) => m.pending).map((m) => m.id),
    ),
  };
}
