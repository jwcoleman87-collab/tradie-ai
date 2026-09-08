const viewportHeightProperty = '--workspace-viewport-height';
const viewportTopProperty = '--workspace-viewport-top';
const bottomInsetProperty = '--workspace-bottom-inset';

/** Keep the mobile workspace above the keyboard without interfering with zoom. */
export function bindWorkspaceViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  // Browsers without VisualViewport use the stylesheet's dynamic viewport height.
  if (!viewport) return () => {};

  const mobile = window.matchMedia('(max-width: 1024px), (pointer: coarse)');
  let frame = 0;
  const clear = () => {
    element.style.removeProperty(viewportHeightProperty);
    element.style.removeProperty(viewportTopProperty);
    element.style.removeProperty(bottomInsetProperty);
  };
  const update = () => {
    frame = 0;
    if (!mobile.matches) {
      clear();
      return;
    }
    // Pinching changes visual height too. Retain the last unzoomed height until
    // the user returns to normal scale instead of shrinking the whole layout.
    if (!Number.isFinite(viewport.scale) || Math.abs(viewport.scale - 1) > 0.02)
      return;
    if (!Number.isFinite(viewport.height) || viewport.height <= 0) return;
    element.style.setProperty(viewportHeightProperty, `${viewport.height}px`);
    // Safari can pan the visual viewport to reveal a focused input without
    // resizing it again. A fixed shell must follow that offset as well.
    const top = Number.isFinite(viewport.offsetTop)
      ? Math.max(0, viewport.offsetTop)
      : 0;
    element.style.setProperty(viewportTopProperty, `${top}px`);
    // The keyboard already protects the bottom edge; don't reserve the home
    // indicator inset a second time. Browser toolbar changes stay below this.
    if (window.innerHeight - viewport.height > 100)
      element.style.setProperty(bottomInsetProperty, '0px');
    else element.style.removeProperty(bottomInsetProperty);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  mobile.addEventListener('change', schedule);
  update();

  return () => {
    window.cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', schedule);
    mobile.removeEventListener('change', schedule);
    clear();
  };
}
