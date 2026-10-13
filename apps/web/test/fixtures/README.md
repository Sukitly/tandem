# Chat Markdown browser fixture

Run `bun run dev:web` from the repository root, then open
<http://127.0.0.1:5173/test/fixtures/markdown.html>.
No backend, model credentials, or project data are needed. The fixture does not change saved theme preferences.

The page imports the real `Markdown` component and the complete `src/index.css`, including Tailwind, Streamdown,
and the chat overrides. Unlike the jsdom tests, the browser exercises the actual CSS cascade, font metrics,
wrapping, horizontal scrolling, and incremental streaming updates.

## Repeatable checks

1. Check both themes with the theme button, at viewport widths of 820px and 360px.
2. Confirm that headings are compact, list continuation lines align with their text, and the second paragraph in
   the first list item remains separate. Nested lists must retain their indentation.
3. Confirm that long paths and unbroken identifiers wrap without widening the page. Fenced code must retain its
   own smaller text and horizontal scrollbar instead of wrapping.
4. Scroll the invalid Mermaid diagram into view and wait for the error (Streamdown defers off-screen diagrams).
   Inspect its `<p>`: it must have no `data-chat-markdown` marker and no chat paragraph margin. Markdown paragraphs must have `data-chat-markdown="paragraph"`.
5. Open the external-link confirmation. Its warning paragraph must likewise remain unmarked and keep the
   library's spacing. Cancel the confirmation without opening the external page.
6. Click **Replay streaming** in each theme. Check the layout as lists and code fences arrive, and confirm that
   the final rendering matches the initial complete answer after scrolling the diagram into view again.
   No unexpected horizontal page scroll should appear.

Automated selector and DOM regression checks remain in `test/markdown-typography.test.ts`. The fixture is a manual
browser check, not a CI browser suite; it requires no additional dependency or test framework. Vite serves the
fixture in development only: the application production build still uses `index.html` as its sole entry point.
