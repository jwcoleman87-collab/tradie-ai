'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createVoiceDraft,
  speechConstructor,
  type VoiceState,
} from './voice-draft';

export function useVoiceDraft(
  scope: string,
  enabled: boolean,
  onDraft: (draft: string) => void,
) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>({
    active: false,
    finishing: false,
    error: '',
  });
  const controller = useRef<ReturnType<typeof createVoiceDraft> | null>(null);
  useEffect(() => {
    const Recognition = speechConstructor(window);
    setSupported(!!Recognition);
    setState({ active: false, finishing: false, error: '' });
    const session = Recognition
      ? createVoiceDraft(Recognition, onDraft, setState)
      : null;
    controller.current = session;
    return () => {
      session?.dispose();
      controller.current = null;
    };
  }, [scope, onDraft]);
  useEffect(() => {
    if (!enabled) controller.current?.cancel();
  }, [enabled]);
  return {
    ...state,
    supported,
    isActive: () => !!controller.current?.active,
    start: (draft: string) => {
      if (enabled) controller.current?.start(draft);
    },
    cancel: () => controller.current?.cancel(),
    keep: () => controller.current?.keep(),
  };
}
