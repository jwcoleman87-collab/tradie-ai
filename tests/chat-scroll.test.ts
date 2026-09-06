import { afterEach, expect, it, vi } from 'vitest';
import { bindChatScroll } from '../lib/chat-scroll';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let resize = () => {};
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  class ScrollArea extends EventTarget {
    clientHeight = 600;
    scrollHeight = 1600;
    private top = 0;
    get scrollTop() {
      return this.top;
    }
    set scrollTop(top: number) {
      this.top = Math.max(
        0,
        Math.min(top, this.scrollHeight - this.clientHeight),
      );
    }
  }
  const history = new ScrollArea();
  const content = {} as HTMLElement;
  const controller = bindChatScroll(history as unknown as HTMLElement, content);
  const scroll = (top: number) => {
    history.scrollTop = top;
    history.dispatchEvent(new Event('scroll'));
  };
  const bottomVisible = () =>
    history.scrollTop + history.clientHeight >= history.scrollHeight;
  return {
    history,
    content,
    controller,
    scroll,
    resize: () => resize(),
    bottomVisible,
    observe,
    disconnect,
  };
}

it('keeps the latest message visible throughout keyboard opening and closing', () => {
  const { history, resize, bottomVisible } = fixture();
  expect(bottomVisible()).toBe(true);
  for (const height of [510, 410, 300, 420, 600]) {
    history.clientHeight = height;
    // Safari may dispatch a scroll at the old position before layout observers.
    history.dispatchEvent(new Event('scroll'));
    resize();
    expect(bottomVisible()).toBe(true);
  }
});

it('follows replies, notices and delayed attachment sizing at the bottom', () => {
  const { history, resize, bottomVisible } = fixture();
  for (const height of [1900, 2350, 2200]) {
    history.scrollHeight = height;
    resize();
    expect(bottomVisible()).toBe(true);
  }
});

it('keeps the reader in earlier messages through incoming content and keyboard resize', () => {
  const { history, scroll, resize } = fixture();
  scroll(450);
  history.scrollHeight = 2000;
  history.clientHeight = 350;
  resize();
  expect(history.scrollTop).toBe(450);
  scroll(600);
  history.scrollHeight = 2400;
  resize();
  expect(history.scrollTop).toBe(600);
});

it('resumes following when the reader returns to the bottom', () => {
  const { history, scroll, resize, bottomVisible } = fixture();
  scroll(400);
  scroll(1000);
  history.scrollHeight = 1900;
  resize();
  expect(bottomVisible()).toBe(true);
});

it('focus, send and conversation changes can explicitly return to latest', () => {
  const { history, scroll, controller, bottomVisible } = fixture();
  scroll(200);
  // A different conversation can have the same message count and height.
  controller.scrollToLatest();
  expect(bottomVisible()).toBe(true);
  expect(history.scrollTop).toBe(1000);
});

it('retains bottom-following while Chat is hidden and restores it on return', () => {
  const { history, resize, controller, bottomVisible } = fixture();
  history.clientHeight = 0;
  history.scrollHeight = 0;
  history.scrollTop = 0;
  history.dispatchEvent(new Event('scroll'));
  resize();
  controller.scrollToLatest();
  history.clientHeight = 350;
  history.scrollHeight = 1900;
  resize();
  expect(bottomVisible()).toBe(true);
});

it('handles short content and then a conversation longer than the viewport', () => {
  const { history, resize, bottomVisible } = fixture();
  history.scrollHeight = 600;
  resize();
  expect(history.scrollTop).toBe(0);
  history.scrollHeight = 1700;
  resize();
  expect(bottomVisible()).toBe(true);
});

it('restores an earlier reading position if hiding Chat resets the scroll offset', () => {
  const { history, scroll, resize } = fixture();
  scroll(450);
  history.clientHeight = 0;
  history.scrollHeight = 0;
  history.scrollTop = 0;
  history.dispatchEvent(new Event('scroll'));
  resize();
  history.clientHeight = 350;
  history.scrollHeight = 1900;
  history.dispatchEvent(new Event('scroll'));
  resize();
  expect(history.scrollTop).toBe(450);
});

it('observes both content and available space and cleans up on unmount', () => {
  const { history, content, observe, disconnect, controller } = fixture();
  const remove = vi.spyOn(history, 'removeEventListener');
  expect(observe).toHaveBeenCalledWith(history);
  expect(observe).toHaveBeenCalledWith(content);
  controller.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
});
