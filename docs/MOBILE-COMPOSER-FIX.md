# Mobile Chat composer repair

The reported device is iPhone Safari. The workspace stylesheet forced the Chat
textarea to 13px, overriding the shared component's larger input text. Focusing
this small field could trigger browser zoom and leave Send outside the visible
area. The shell also used `100dvh`, which does not necessarily shrink when the
on-screen keyboard reduces Safari's visual viewport.

The composer now uses at least 16px text, respecting a larger root text size.
Manual zoom remains available: no maximum-scale or user-scalable restriction is
added. A workspace-scoped listener sizes the shell from `visualViewport.height`
on narrow or touch devices at normal zoom. Pinch-zoom changes are ignored, and
desktop/unsupported browsers retain their CSS height. Listeners and the inline
override are removed on cleanup.

The composer and 40px Send button remain in the layout while message history
shrinks and scrolls. In short viewports, secondary Chat heading/history controls
tuck away while the composer has focus, then return afterwards. The compact
layout also stays active when focus moves from the textarea to Send. Long input
text scrolls inside a capped field; footer text can wrap and bottom safe-area
padding is retained.

Very short landscape views also tuck away the top bar and mobile tabs while the
composer is focused. An unfocused, unusually short view can scroll rather than
clip its controls.

Validation includes six viewport lifecycle regressions, with **283 tests across
24 suites passing**, plus lint, typecheck and production build. Browser layout
verification uses the actual Workspace component and styles with synthetic local
account data and simulated visual-viewport keyboard resizing. It makes no
production AI requests or business actions. This is browser simulation, not a
physical iPhone keyboard test.

All 28 measured focused layouts passed, covering widths 320, 375 and 390 pixels
with visible heights 844, 420, 360 and 300 pixels, short/long drafts, and landscape
844px width with only 200px visible height. The input computes to 16px; Send is
fully visible and there is no horizontal page overflow. Four focus-transfer and
touchscreen-tap checks kept the compact layout stable and triggered exactly one
intercepted local form submission. Leaving the composer restored the headings;
pinch zoom retained the last unzoomed shell height. No browser errors were seen.

Reference: [browser keyboard and viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior/).
