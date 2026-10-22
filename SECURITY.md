# Security boundaries

Tandem is a single-owner application. A paired device can operate every project, run agents and terminals, pair more devices, and manage recovery codes. Pairing is administrator access, not project-scoped access. The agent and terminals run with the server user's operating-system permissions; there is no sandbox.

Public deployments must use HTTPS. Keep Tandem's device authentication enabled even behind an additional identity gateway such as Cloudflare Access. Protect the entire origin, including WebSocket and pairing endpoints, rather than only the HTML page. Never host untrusted project previews on Tandem's authenticated origin.

## Authentication and public-access lifecycle

- Every RPC and terminal upgrade is authenticated before being passed to a WebSocket listener. Browser-cookie upgrades also require an allowed Origin. Forwarded IP and identity headers are not authentication credentials.
- A public origin is replaceable, not an accumulating allowlist entry. Changing or removing it invalidates its Host and Origin and closes existing sockets admitted through either. Explicit local and development origins remain available.
- Unpublish cancels pending authorization and waits for pending writes and startup work before removing the configuration. It does not return successfully while an older task can recreate the tunnel.
- Pairing and recovery codes contain 128 bits of randomness and are single use. Invalid attempts receive a shared backoff after five failures, but possession of a valid code still permits pairing. The backoff is not a substitute for edge request-volume limits: validating a code remains cheap and must not let anonymous failures lock out its owner.
- Pairing sets HttpOnly, SameSite=Strict cookies, with Secure for a public HTTPS origin. Bootstrap does not reissue cookies: a same-origin GET may lack Origin while a tunnel rewrites Host, so inferring cookie security again would be unsafe. Browser cookies expire after 400 days without renewal; server-side inactivity expires a device after 30 days. Re-pairing is required after browser expiry.
- A deployment that previously issued a public cookie without Secure should revoke and re-pair the affected device over HTTPS. Preventing future downgrades cannot repair an already stored insecure cookie without replacing it.

## Dependency advisories

Run `bun audit`, `bun why <package>`, `bun run check`, `bun run test`, and `bun run build` when changing security-sensitive dependencies. An advisory match is not proof of reachability, but it must not be hidden merely to obtain a green audit.

### KaTeX: GHSA-238p-pmpm-9mq7

The root `package.json` overrides KaTeX to `0.19.0`, including the copies used by rehype-katex, micromark-extension-math, and Mermaid. The fixed version starts at `0.18.2`; upgrading only the web app's direct dependency leaves vulnerable transitive copies installed. The override also keeps the renderer aligned with the web app's KaTeX stylesheet.

The advisory requires an existing prototype-pollution source; KaTeX does not create that initial pollution. Markdown math rendering, and math that cannot create links or images, have regression tests (`apps/web/test/markdown-render.test.tsx`). Mermaid is drawn in `strict` mode, where it sanitizes what it draws, and no test draws a real diagram: jsdom cannot lay one out. The override crosses upstream dependency ranges, so retain build and rendering checks, and remove the override when upstream ranges require a fixed version.

Advisory: https://github.com/advisories/GHSA-238p-pmpm-9mq7

### braces: GHSA-vfj7-8cjw-p6xm

At the time of this change, the published version is still `3.0.3` and remains affected. There is no fixed published version to select. The installed path is `shadcn -> fast-glob -> micromatch -> braces` (also through shadcn's registry and ts-morph dependencies), not the server's RPC or HTTP request handlers.

`shadcn` is a development dependency: Tandem uses its stylesheet during the web build, and developers use its component generator. Its Node CLI and glob dependencies are not needed by the running server or included as browser JavaScript by the stylesheet import. Do not pass attacker-controlled glob patterns to the generator or expose the generator as an API. Development/build installations still contain the affected package and the complete audit intentionally still reports the advisory.

Track an upstream fix and update the lockfile when available. If eliminating the package before a fix becomes mandatory, replace the build-tool dependency or maintain a reviewed patch with depth-limit regression tests; changing the audit severity or declaring the installed version safe is not a fix.

Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
