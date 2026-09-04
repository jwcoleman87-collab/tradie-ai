const viewportHeightProperty = '--workspace-viewport-height';

/** Keep the mobile workspace above the keyboard without interfering with zoom. */
export function bindWorkspaceViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  // Browsers without VisualViewport use the stylesheet's dynamic viewport height.
  if (!viewport) return () => {};

  const mobile = window.matchMedia('(max-width: 900px), (pointer: coarse)');
  const update = () => {
    if (!mobile.matches) {
      viewport.removeEventListener('resize', update);
      element.style.removeProperty(viewportHeightProperty);
      return;
    }
    viewport.addEventListener('resize', update);
    // Pinching changes visual height too. Retain the last unzoomed height until
    // the user returns to normal scale instead of shrinking the whole layout.
    if (!Number.isFinite(viewport.scale) || Math.abs(viewport.scale - 1) > 0.02)
      return;
    if (Number.isFinite(viewport.height) && viewport.height > 0)
      element.style.setProperty(viewportHeightProperty, `${viewport.height}px`);
  };

  window.addEventListener('resize', update);
  mobile.addEventListener('change', update);
  update();

  return () => {
    viewport.removeEventListener('resize', update);
    window.removeEventListener('resize', update);
    mobile.removeEventListener('change', update);
    element.style.removeProperty(viewportHeightProperty);
  };
}
