export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechConstructor = new () => SpeechRecognizer;
export type VoiceState = { active: boolean; finishing: boolean; error: string };

export function speechConstructor(browser: object): SpeechConstructor | null {
  const speech = browser as {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  const candidate = speech.SpeechRecognition || speech.webkitSpeechRecognition;
  return typeof candidate === 'function' ? candidate : null;
}

/** Dictation only edits the draft. Sending is deliberately outside this controller. */
export function createVoiceDraft(
  Recognition: SpeechConstructor,
  onDraft: (draft: string) => void,
  onState: (state: VoiceState) => void,
) {
  let session: {
    recognition: SpeechRecognizer;
    original: string;
    finishing: boolean;
  } | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const detach = () => {
    const current = session;
    session = null;
    clearTimeout(finishTimer);
    if (current) {
      current.recognition.onresult = null;
      current.recognition.onend = null;
      current.recognition.onerror = null;
    }
    return current;
  };
  const abort = (recognition: SpeechRecognizer) => {
    try {
      recognition.abort();
    } catch {
      /* Already ended. */
    }
  };
  const finish = (error = '', restore = false) => {
    const current = detach();
    if (!current || disposed) return;
    abort(current.recognition);
    if (restore) onDraft(current.original);
    onState({ active: false, finishing: false, error });
  };
  return {
    get active() {
      return session !== null;
    },
    start(original: string) {
      if (session || disposed) return;
      try {
        const recognition = new Recognition();
        const current = { recognition, original, finishing: false };
        session = current;
        recognition.lang = 'en-AU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          if (session !== current || disposed) return;
          // Results are cumulative; rebuilding avoids repeating final/interim words.
          const transcript = Array.from(
            event.results,
            (result) => result[0]?.transcript || '',
          )
            .join(' ')
            .trim();
          onDraft(
            (
              original +
              (original && transcript && !/\s$/.test(original) ? ' ' : '') +
              transcript
            ).slice(0, 12000),
          );
        };
        recognition.onend = () => {
          if (session === current) finish();
        };
        recognition.onerror = ({ error }) => {
          if (session !== current) return;
          finish(
            error === 'not-allowed' || error === 'service-not-allowed'
              ? 'Microphone access was not allowed. You can type your message.'
              : error === 'no-speech'
                ? 'No speech was heard. Your original draft is restored.'
                : 'Voice input stopped. Your original draft is restored; you can type or try again.',
            true,
          );
        };
        onState({ active: true, finishing: false, error: '' });
        recognition.start();
      } catch {
        if (session)
          finish(
            'Voice input could not start. You can type your message.',
            true,
          );
        else
          onState({
            active: false,
            finishing: false,
            error: 'Voice input is unavailable. You can type your message.',
          });
      }
    },
    cancel() {
      finish('', true);
    },
    keep() {
      if (!session || session.finishing) return;
      const current = session;
      current.finishing = true;
      onState({ active: true, finishing: true, error: '' });
      // Allow the recognizer's final result after stop(), with a bounded fallback.
      finishTimer = setTimeout(() => {
        if (session === current) finish();
      }, 2000);
      try {
        current.recognition.stop();
      } catch {
        finish();
      }
    },
    dispose() {
      disposed = true;
      const current = detach();
      if (current) abort(current.recognition);
    },
  };
}
