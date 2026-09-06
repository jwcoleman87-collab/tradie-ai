import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVoiceDraft,
  speechConstructor,
  type SpeechRecognizer,
} from '../lib/voice-draft';

class FakeRecognition implements SpeechRecognizer {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: SpeechRecognizer['onresult'] = null;
  onend: SpeechRecognizer['onend'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  result(...transcripts: string[]) {
    this.onresult?.({
      results: transcripts.map((transcript) => [{ transcript }]),
    });
  }
}

function harness(Recognition = FakeRecognition) {
  FakeRecognition.instances = [];
  const draft = vi.fn();
  const state = vi.fn();
  const controller = createVoiceDraft(Recognition, draft, state);
  return {
    controller,
    draft,
    state,
    get recognition() {
      return FakeRecognition.instances.at(-1)!;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('dictation sessions', () => {
  it('detects standard and prefixed recognition and treats unsupported browsers as unsupported', () => {
    expect(speechConstructor({ SpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(
      speechConstructor({ webkitSpeechRecognition: FakeRecognition }),
    ).toBe(FakeRecognition);
    expect(speechConstructor({})).toBeNull();
    expect(speechConstructor({ SpeechRecognition: {} })).toBeNull();
  });

  it('restores the exact prior draft after cancellation, including whitespace', () => {
    const h = harness();
    const original = '  Existing draft\nwith a trailing tab\t';
    h.controller.start(original);
    h.recognition.result('new interim words');
    h.recognition.result('new final words');
    h.controller.cancel();
    expect(h.draft).toHaveBeenLastCalledWith(original);
    expect(h.recognition.abort).toHaveBeenCalledOnce();
    expect(h.recognition.stop).not.toHaveBeenCalled();
    expect(h.controller.active).toBe(false);
    expect(h.state).toHaveBeenLastCalledWith({
      active: false,
      finishing: false,
      error: '',
    });
  });

  it('rebuilds cumulative results without duplicating or retaining revised interim words', () => {
    const h = harness();
    h.controller.start('Draft:');
    h.recognition.result('Book', 'tomor');
    expect(h.draft).toHaveBeenLastCalledWith('Draft: Book tomor');
    h.recognition.result('Book', 'tomorrow morning');
    expect(h.draft).toHaveBeenLastCalledWith('Draft: Book tomorrow morning');
    h.recognition.result('Book');
    expect(h.draft).toHaveBeenLastCalledWith('Draft: Book');
    h.controller.cancel();
  });

  it('waits for final recognition after Keep, then leaves the result in the draft', () => {
    const h = harness();
    h.controller.start('');
    h.recognition.result('Meet at');
    h.controller.keep();
    expect(h.recognition.stop).toHaveBeenCalledOnce();
    expect(h.controller.active).toBe(true);
    expect(h.state).toHaveBeenLastCalledWith({
      active: true,
      finishing: true,
      error: '',
    });
    h.recognition.result('Meet at ten');
    h.recognition.onend?.();
    expect(h.draft).toHaveBeenLastCalledWith('Meet at ten');
    expect(h.controller.active).toBe(false);
    expect(h.state).toHaveBeenLastCalledWith({
      active: false,
      finishing: false,
      error: '',
    });
  });

  it('allows cancellation during Keep finalization and restores the pre-voice draft', () => {
    const h = harness();
    h.controller.start('Original');
    h.recognition.result('interim');
    h.controller.keep();
    const lateResult = h.recognition.onresult;
    h.controller.cancel();
    lateResult?.({ results: [[{ transcript: 'late final' }]] });
    expect(h.draft).toHaveBeenLastCalledWith('Original');
    expect(h.controller.active).toBe(false);
  });

  it('ignores late result, end and error callbacks from a cancelled session after a new session starts', () => {
    const h = harness();
    h.controller.start('First');
    const stale = {
      result: h.recognition.onresult,
      end: h.recognition.onend,
      error: h.recognition.onerror,
    };
    h.controller.cancel();
    h.controller.start('Second');
    h.recognition.result('current');
    const drafts = h.draft.mock.calls.length;
    const states = h.state.mock.calls.length;
    stale.result?.({ results: [[{ transcript: 'old text' }]] });
    stale.end?.();
    stale.error?.({ error: 'not-allowed' });
    expect(h.draft).toHaveBeenCalledTimes(drafts);
    expect(h.state).toHaveBeenCalledTimes(states);
    expect(h.draft).toHaveBeenLastCalledWith('Second current');
    expect(h.controller.active).toBe(true);
    h.controller.cancel();
  });

  it('disposes without restoring an old draft into a new scope, including queued callbacks and finish timers', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.start('Old scope');
    h.recognition.result('words');
    h.controller.keep();
    const stale = {
      result: h.recognition.onresult,
      end: h.recognition.onend,
      error: h.recognition.onerror,
    };
    h.draft.mockClear();
    h.state.mockClear();
    h.controller.dispose();
    stale.result?.({ results: [[{ transcript: 'late words' }]] });
    stale.end?.();
    stale.error?.({ error: 'network' });
    vi.runAllTimers();
    h.controller.start('New scope');
    expect(h.draft).not.toHaveBeenCalled();
    expect(h.state).not.toHaveBeenCalled();
    expect(h.recognition.abort).toHaveBeenCalledOnce();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(h.controller.active).toBe(false);
  });

  it('keeps the available draft and releases the controls if stop never reports an end', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.start('');
    h.recognition.result('Available words');
    h.controller.keep();
    vi.advanceTimersByTime(5000);
    expect(h.controller.active).toBe(false);
    expect(h.draft).toHaveBeenLastCalledWith('Available words');
    expect(h.state).toHaveBeenLastCalledWith({
      active: false,
      finishing: false,
      error: '',
    });
    expect(h.recognition.abort).toHaveBeenCalledOnce();
  });

  it('ignores repeated Start and Keep without opening overlapping recognition sessions', () => {
    const h = harness();
    h.controller.start('Original');
    h.controller.start('Replacement');
    h.controller.keep();
    h.controller.keep();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(h.recognition.start).toHaveBeenCalledOnce();
    expect(h.recognition.stop).toHaveBeenCalledOnce();
    h.controller.cancel();
    expect(h.draft).toHaveBeenLastCalledWith('Original');
  });

  for (const error of [
    'not-allowed',
    'service-not-allowed',
    'no-speech',
    'audio-capture',
    'network',
  ]) {
    it(`restores the original draft and releases the session after ${error}`, () => {
      const h = harness();
      h.controller.start('Original draft');
      h.recognition.result('partially recognised');
      h.recognition.onerror?.({ error });
      expect(h.draft).toHaveBeenLastCalledWith('Original draft');
      expect(h.controller.active).toBe(false);
      expect(h.state).toHaveBeenLastCalledWith({
        active: false,
        finishing: false,
        error: expect.any(String),
      });
      expect(h.state.mock.lastCall?.[0].error).not.toBe('');
    });
  }

  it('settles a natural end with recognized words still editable in the draft', () => {
    const h = harness();
    h.controller.start('');
    h.recognition.result('Recognized words');
    h.recognition.onend?.();
    expect(h.draft).toHaveBeenLastCalledWith('Recognized words');
    expect(h.controller.active).toBe(false);
  });

  it('recovers from a synchronous recognition start failure', () => {
    class StartFailure extends FakeRecognition {
      override start = vi.fn(() => {
        throw new Error('Cannot start');
      });
    }
    const h = harness(StartFailure);
    expect(() => h.controller.start('Original draft')).not.toThrow();
    expect(h.draft).toHaveBeenLastCalledWith('Original draft');
    expect(h.controller.active).toBe(false);
    expect(h.state.mock.lastCall?.[0].error).not.toBe('');
  });

  it('handles constructor and stop/abort exceptions without locking the composer', () => {
    class ConstructionFailure extends FakeRecognition {
      constructor() {
        super();
        throw new Error('Unavailable');
      }
    }
    const unavailable = harness(ConstructionFailure);
    expect(() => unavailable.controller.start('Draft')).not.toThrow();
    expect(unavailable.controller.active).toBe(false);
    expect(unavailable.draft).not.toHaveBeenCalled();
    const h = harness();
    h.controller.start('Draft');
    h.recognition.result('words');
    h.recognition.stop.mockImplementation(() => {
      throw new Error('Already stopped');
    });
    h.recognition.abort.mockImplementation(() => {
      throw new Error('Already ended');
    });
    expect(() => h.controller.keep()).not.toThrow();
    expect(h.controller.active).toBe(false);
    expect(h.draft).toHaveBeenLastCalledWith('Draft words');
  });

  it('does not exceed the draft length limit and still restores the complete original on Cancel', () => {
    const h = harness();
    const original = 'x'.repeat(11999);
    h.controller.start(original);
    h.recognition.result('more words');
    expect(h.draft.mock.lastCall?.[0]).toHaveLength(12000);
    h.controller.cancel();
    expect(h.draft).toHaveBeenLastCalledWith(original);
  });
});
