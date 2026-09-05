/** Keep one scroll container at the latest message until the reader scrolls up. */
export function bindChatScroll(history: HTMLElement, content: HTMLElement) {
  let following = true;
  let lastTop = history.scrollTop;
  let hidden = false;
  const atBottom = () =>
    history.scrollHeight - history.clientHeight - history.scrollTop <= 24;
  const sync = () => {
    // Crew and Workspace hide Chat. Retain the intent until it has a size again.
    if (!history.clientHeight) {
      hidden = true;
      return;
    }
    if (following) history.scrollTop = history.scrollHeight;
    else if (hidden) history.scrollTop = lastTop;
    hidden = false;
    lastTop = history.scrollTop;
  };
  const onScroll = () => {
    if (!history.clientHeight) {
      hidden = true;
      return;
    }
    if (hidden) return;
    // A viewport shrink can fire scroll before ResizeObserver. An unchanged
    // scrollTop must not look like the reader intentionally left the bottom.
    if (atBottom()) following = true;
    else if (history.scrollTop < lastTop) following = false;
    lastTop = history.scrollTop;
  };
  const observer = new ResizeObserver(sync);
  observer.observe(history);
  observer.observe(content);
  history.addEventListener('scroll', onScroll, { passive: true });
  sync();
  return {
    scrollToLatest() {
      following = true;
      sync();
    },
    dispose() {
      observer.disconnect();
      history.removeEventListener('scroll', onScroll);
    },
  };
}
