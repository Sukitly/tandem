# Browser regressions

These tests use a real Chromium browser via Playwright and Node's test runner, separately from the Vitest unit suite. The CI Browser Regressions job installs Chromium with its system dependencies and runs this suite on pull requests and pushes to main.

```sh
cd apps/web
bunx playwright install chromium
bun run test:browser
```

The preview isolation test starts disposable HTTP servers on port `0`, proxies through the actual server implementation, and checks direct navigation and new-tab navigation with and without an upstream CSP. It verifies that scripts run without gaining access to Tandem-origin storage and that API requests have an opaque (`null`) origin. The servers do not use the user's Tandem state directory or credentials.

The reader regressions run the actual shared fullscreen container inside a mobile drawer, checking viewport bounds, reader identity, scroll restoration, draft preservation, focus containment/return, and nested Escape handling. Additional tests use the real `ChangeDiff` and Pierre renderer (only service boundaries are stubbed) to check split-column hover, equal-length patch updates, touch code/line-number activation, and the explicit line control.

Comment-draft regressions switch between the real diff and file readers, insert lines, duplicate context, and replace the quoted line. They check preserved text, verified relocation on submission, and disabled submission for ambiguous or missing locations. Re-created diffs also restore reading position without replaying an already-consumed reveal request.

Composer regressions check long-input height budgets, visible transcript space, touch-sized Stop controls, touch follow-up selection and command completion, click-accessible context details, native undo/redo against an ordinary textarea, absence of added gray focus rings while preserving ordinary borders and invalid-field feedback (not a complete keyboard-focus accessibility audit), scrollable dialogs after viewport resizing, and theme/composer operation when accessing `localStorage` throws a `SecurityError`. Fixture servers use separate Vite caches so concurrent suites cannot invalidate each other's dependency bundles.

Project-panel regressions exercise the actual toolbar in a 240px container on desktop and touch viewports, and verify that switching preview ports/tabs preserves iframe form state while Reload replaces only the chosen frame. A separate Node integration test loads the real Vite configuration and checks `/preview` HTTP forwarding and WebSocket upgrades against an ephemeral backend.

Long-file regressions render 20,000 lines through Pierre while asserting a bounded DOM window, distant line reveals, whole-file search and copying, equal-length refreshes, wrapping, and comment drafts retained while scrolling/fullscreen. Workspace-layout regressions verify retention across panel closing, project switches, an empty conversation selection, hidden workbench ancestors, and desktop/drawer transitions. They check iframe document contents and node identity, real xterm instance identity with a stubbed transport, lazy terminal creation, and cleanup on project deletion/workbench disposal. Available container width also triggers overlay mode independently of viewport width; tests check desktop alignment and focus transfer/containment when an already-open panel becomes modal. Visited project tabs intentionally remain mounted for the connected workbench's lifetime unless their project is removed; these are retained views, not a bounded LRU cache.

The project surface is a desktop region; its Drawer activates only in overlay mode while retaining the same content host. Tests cover desktop Escape, nested overlay dialogs, focus return, touch swipe, and backdrop dismissal. Visited views remain mounted, but hidden projects release their changes hold; returning reacquires it. Browser hold accounting stubs the service boundary; the server tracker tests independently verify that the last release stops watching.

Chromium mobile emulation is not an iOS device. This suite does not yet cover the full workbench or iOS keyboard behavior.
