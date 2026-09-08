# Mobile Chat layout repair

The workspace owns one fixed viewport, sized and positioned from VisualViewport
height and offsetTop on mobile. Resize and scroll events are coalesced per frame;
pinch zoom does not rescale the layout. Dynamic viewport CSS remains the fallback.
Safe-area padding is not counted again when the keyboard occludes the bottom edge.

The shell lays out its header and remaining workspace with flex sizing instead of
separately subtracting hard-coded header heights. Only message history scrolls
inside Chat. Public routes retain normal document scrolling.

Mobile navigation shares the brand row, Chat has a compact title, conversation
actions fit beside the history picker, and the composer uses one row with bounded
multiline growth. Short landscape viewports put the heading and toolbar beside
each other and keep selected attachments in the composer row. No controls are
removed in response to input focus.

A ResizeObserver watches history and its content. When following the latest
message, viewport changes, replies and decoded images keep the bottom visible
without smooth scrolling. Scrolling upward preserves reading position and native
scroll anchoring. Focus, sending and conversation changes resume following.
Hidden panels retain the reader's position and release observers on unmount.

Behavior references:

- [VisualViewport height, offset and events](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- [Keyboard resizing and layout vs visual viewports](https://developer.chrome.com/blog/viewport-resize-behavior/)

## Verification

Validated 5 September 2026: lint, TypeScript and the final production build pass.
All 349 tests pass across the full run (348) and a targeted rerun of the existing
Worker transport test (1). The initial Worker test was blocked by sandbox access
to an ancestor directory; it passed outside that filesystem restriction.

Automated regression coverage in `tests/workspace-viewport.test.ts` and
`tests/chat-scroll.test.ts` exercises keyboard open/close, offset-only panning,
orientation/desktop transitions, invalid dimensions, zoom, frame cancellation,
content growth, reading earlier messages, equal-sized conversation changes,
hidden panels, and observer/listener cleanup. These tests simulate browser
events and scroll geometry; they do not emulate an iPhone keyboard or CSS layout.

Physical iPhone Safari acceptance remains to be checked:

1. Open a long conversation at the bottom and focus the composer. The latest
   content and input should stay above the keyboard without a second page scroll.
2. Type a multiline draft, attach several files, close/reopen the keyboard and
   rotate to landscape. Check both a short conversation and a long one.
3. Scroll upward during a reply, switch to Crew and back, then focus the composer.
   Reading should be preserved until focus deliberately returns to the latest.
4. Check browser toolbar expansion, pinch zoom and enlarged text; confirm Crew,
   Workspace settings and sign-in forms still scroll in their own containers.

This checkout's README identifies Vercel as the active host; its Sites manifest
is legacy metadata. This repair does not change deployment configuration.
