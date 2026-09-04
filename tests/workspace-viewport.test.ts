import { afterEach, expect, it, vi } from 'vitest';
import { bindWorkspaceViewport } from '../lib/workspace-viewport';

afterEach(() => vi.unstubAllGlobals());

function fixture({ mobile = true, viewportAvailable = true } = {}) {
  const viewport = Object.assign(new EventTarget(), { height: 800, scale: 1 });
  const media = Object.assign(new EventTarget(), { matches: mobile });
  const browser = Object.assign(new EventTarget(), {
    visualViewport: viewportAvailable ? viewport : null,
    matchMedia: vi.fn(() => media),
  });
  const properties = new Map<string, string>();
  const element = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  } as unknown as HTMLElement;
  vi.stubGlobal('window', browser);
  return {
    element,
    viewport,
    media,
    browser,
    height: () => properties.get('--workspace-viewport-height'),
  };
}

it('follows keyboard opening and closing on a mobile viewport', () => {
  const { element, viewport, browser, height } = fixture();
  const cleanup = bindWorkspaceViewport(element);
  expect(browser.matchMedia).toHaveBeenCalledWith(
    '(max-width: 900px), (pointer: coarse)',
  );
  expect(height()).toBe('800px');
  viewport.height = 410;
  viewport.dispatchEvent(new Event('resize'));
  expect(height()).toBe('410px');
  viewport.height = 800;
  viewport.dispatchEvent(new Event('resize'));
  expect(height()).toBe('800px');
  cleanup();
});

it('ignores pinch zoom rather than resizing the app to the zoomed viewport', () => {
  const { element, viewport, browser, height } = fixture();
  const cleanup = bindWorkspaceViewport(element);
  viewport.scale = 2;
  viewport.height = 300;
  viewport.dispatchEvent(new Event('resize'));
  browser.dispatchEvent(new Event('resize'));
  expect(height()).toBe('800px');
  viewport.scale = 1;
  viewport.height = 760;
  viewport.dispatchEvent(new Event('resize'));
  expect(height()).toBe('760px');
  cleanup();
});

it('uses CSS until an already zoomed mobile page returns to normal scale', () => {
  const { element, viewport, height } = fixture();
  viewport.scale = 1.5;
  const cleanup = bindWorkspaceViewport(element);
  expect(height()).toBeUndefined();
  viewport.scale = 1.001;
  viewport.dispatchEvent(new Event('resize'));
  expect(height()).toBe('800px');
  cleanup();
});

it('clears the mobile override on desktop transitions and handles orientation resize', () => {
  const { element, viewport, media, browser, height } = fixture();
  const cleanup = bindWorkspaceViewport(element);
  viewport.height = 430;
  browser.dispatchEvent(new Event('resize'));
  expect(height()).toBe('430px');
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  expect(height()).toBeUndefined();
  viewport.height = 900;
  browser.dispatchEvent(new Event('resize'));
  expect(height()).toBeUndefined();
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(height()).toBe('900px');
  cleanup();
});

it('leaves desktop layouts and browsers without VisualViewport on their CSS height', () => {
  const desktop = fixture({ mobile: false });
  const cleanupDesktop = bindWorkspaceViewport(desktop.element);
  expect(desktop.height()).toBeUndefined();
  cleanupDesktop();
  const fallback = fixture({ viewportAvailable: false });
  const cleanupFallback = bindWorkspaceViewport(fallback.element);
  expect(fallback.height()).toBeUndefined();
  expect(fallback.browser.matchMedia).not.toHaveBeenCalled();
  cleanupFallback();
});

it('removes every listener and the inline height when unmounted', () => {
  const { element, viewport, media, browser, height } = fixture();
  const viewportRemove = vi.spyOn(viewport, 'removeEventListener');
  const browserRemove = vi.spyOn(browser, 'removeEventListener');
  const mediaRemove = vi.spyOn(media, 'removeEventListener');
  const cleanup = bindWorkspaceViewport(element);
  cleanup();
  expect(height()).toBeUndefined();
  expect(viewportRemove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(browserRemove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(mediaRemove).toHaveBeenCalledWith('change', expect.any(Function));
  viewport.height = 300;
  viewport.dispatchEvent(new Event('resize'));
  browser.dispatchEvent(new Event('resize'));
  media.dispatchEvent(new Event('change'));
  expect(height()).toBeUndefined();
});
