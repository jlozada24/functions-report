# In-app browser preview

Use this workflow only when the user asks to open, show, render, preview, or verify a functions report in the in-app browser. The outcome is a live interactive report in an in-app-browser tab, not just a generated file or a URL printed in chat.

## 1. Generate a standalone document

Run from the `functions-report` skill directory. Keep temporary preview artifacts outside the repository unless the user explicitly asks to update a checked-in preview. Run this entire block in one long-lived shell invocation so the temporary-directory value remains available to the server process:

```bash
preview_dir="$(mktemp -d "${TMPDIR:-/tmp}/functions-report-preview.XXXXXX")"
node scripts/render-report.mjs --standalone <input.json> "$preview_dir/functions-report.html"
test -s "$preview_dir/functions-report.html"
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$preview_dir"
```

Replace `<input.json>` with the real schema-conforming input path. `--standalone` is required. A fragment served without it can misdecode the minus sign, arrows, separators, or keyboard glyphs.

Keep the long-running server session available until the browser preview has been delivered. Port `0` tells the operating system to choose an unoccupied port; read the actual port from the server's startup line, for example `Serving HTTP on 127.0.0.1 port 49152`.

## 2. Serve it over loopback HTTP

Use the selected port from the startup line to construct the URL:

```text
http://127.0.0.1:<selected-port>/functions-report.html
```

Confirm the server returns the document before browser navigation:

```bash
curl --fail --silent --show-error --output /dev/null \
  http://127.0.0.1:<selected-port>/functions-report.html
```

Replace `<selected-port>` with the numeric port printed by the server. Do not use a `file:` URL: the in-app browser preview must come from `http://127.0.0.1:<port>/...`. Do not detach the server with `&`, kill an unrelated listener, or reuse a URL without first confirming that it serves the newly generated document.

## 3. Connect to the in-app browser

The Browser plugin skill `browser:control-in-app-browser` must be available. Read its `SKILL.md` completely before browser work and follow its current bootstrap and recovery rules; do not improvise with Playwright CLI, Computer Use, `web.run`, or another browser-control surface.

Because this workflow explicitly targets the in-app browser, select `iab` directly. Do not call `getForUrl()`, `getDefault()`, or an external-browser selector. Through the Node JavaScript tool, import `scripts/browser-client.mjs` by its absolute path from the installed Browser plugin, then run:

```js
const { setupBrowserRuntime } = await import("<absolute-browser-plugin-root>/scripts/browser-client.mjs");
const agent = await setupBrowserRuntime();
const iab = await agent.browsers.get("iab");
nodeRepl.write(await iab.documentation());
```

Replace `<absolute-browser-plugin-root>` with the installed Browser plugin root shown in the available-skills catalog. The documentation call must be emitted and read completely before the first interaction. When the JavaScript tool is invoked through a code-mode wrapper, follow the Browser skill's required output-budget pragma so the documentation is not truncated.

Reuse an existing valid `iab` binding if one already exists in the current task. A stale or closed tab does not require reconnecting the browser; discard only the stale tab binding and obtain a fresh tab from `iab`.

## 4. Navigate and verify

Using the APIs in the documentation just read, reuse a suitable in-app-browser tab or create one directly from `iab`, then navigate it to the exact loopback URL. The usual shape is:

```js
const tab = await iab.tabs.new();
await tab.goto("http://127.0.0.1:<selected-port>/functions-report.html");
```

Replace `<selected-port>` with the same numeric port used by `curl`. Do not create the tab from a different browser binding.

After navigation, use the documented DOM snapshot API to confirm all of the following from the loaded page:

- The title or report root is visible.
- The total count badge is present and shows the post-change total: additions count, removals do not.
- Green addition and red deletion figures are present, including zero values.
- The keyboard-shortcut legend and `Copy annotations` control are present.
- Language or inventory badges are present where the report data requires them.
- Any proposal items show `ADD` or `REMOVE` immediately after the expander or bullet and before the item label.

Also take a screenshot when visual placement, color, wrapping, or glyph rendering matters. A successful `curl` check alone is not browser verification. If the report loads after regeneration without hot reload, call the documented tab reload API, then take a fresh DOM snapshot or screenshot.

## 5. Recover without switching surfaces

- If the server URL fails, first verify the long-running server session is still active, the absolute served directory is correct, and the URL uses the chosen port.
- If browser setup succeeds but discovery or selection fails, follow the Browser skill's `bootstrap-troubleshooting` documentation before resetting anything.
- If `iab` is unavailable, report that the in-app browser preview is unavailable and stop. Do not silently substitute Chrome, an external browser, Computer Use, or a Markdown report.
- If a tab is stale, closed, or absent, get or create a fresh tab from the existing `iab` binding and navigate again.
- If the page is garbled or symbols are broken, regenerate with `--standalone`; do not patch the output HTML by hand.

Do not stop at generation or server startup. The preview is complete only after the in-app-browser tab has loaded the report and the required interface elements have been verified.
