# Workbench UI handoff release

Implemented the supplied Tradie AI UI Build reference in the existing authenticated Next.js workspace. The prototype's design-tool runtime and sample business transactions are not shipped.

The workspace now has a fluid GreenVac brand band, light crew/chat/workspace columns, live connection chips, working-agent states, three primary workspace tabs, tinted action filters, and compact proposal cards. Titles split at the first em dash so dates and trailing detail appear on their own line. Files and records open as metadata disclosures; record content opens separately. Long chat replies and proposal briefs expand on demand. Chat proposal links open and focus the matching Workspace action; approval remains in Workspace.

Existing authentication, chat, private storage, approval/revision/retry behavior, settings, and mobile panel navigation are retained. The latest production Facebook fixes and privacy/data-deletion routes were merged before release. State labels and connection status come from the real API; prototype examples such as historical ad charts, synced records and completed Facebook posts are not invented.

## Assets

- GreenVac logo: supplied ZIP asset.
- Brand photo: [GreenVac's own website](https://www.greenvac.com.au/images/ndd-hydrovac-method.jpg?v=edited-20260718), saved as `public/brands/greenvac-banner.jpg`.
- Workbench mark and lockup: existing product assets.

## Validation

TypeScript, lint, the production build and the dependency audit pass. The integrated suite passes 448 tests across 39 files. Fifteen local browser checks pass at 1440 × 900 and 390 × 844, covering tabs, action counts, disclosure persistence, record dialogs, proposal focus and explicit approval. There are no browser runtime errors, console errors or missing assets. These checks use synthetic API/auth fixtures without writing production business data. Browser evidence is kept outside the application repository.
