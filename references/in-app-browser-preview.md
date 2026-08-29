# In-app browser preview

Use this workflow only when the user asks to open, show, render, preview, or verify a functions report in the in-app browser. The outcome is a live interactive report in an in-app-browser tab, not just a generated file or a URL printed in chat.

Only an HTML document produced by `scripts/render-report.mjs --standalone` is a browser-preview artifact. `assets/report-template.html` is an internal fragment containing unresolved renderer placeholders; never navigate a browser to it, open it with a `file:` URL, or present it as the report. If a browser is showing that asset, replace the tab with a freshly generated standalone preview served over loopback HTTP.

## 1. Generate a standalone document

Run from the `functions-report` skill directory. Keep temporary preview artifacts outside the repository unless the user explicitly asks to update a checked-in preview. Use the same `input_path` for rendering and for the JSON receipt; copy it byte-for-byte rather than reconstructing or normalizing it. Run this entire block in one long-lived shell invocation so the temporary-directory value remains available to the server process:

```bash
input_path="<input.json>"
preview_dir="$(mktemp -d "${TMPDIR:-/tmp}/functions-report-preview.XXXXXX")"
node scripts/render-report.mjs --standalone "$input_path" "$preview_dir/functions-report.html"
cp "$input_path" "$preview_dir/functions-report-input.json"
test -s "$preview_dir/functions-report.html"
test -s "$preview_dir/functions-report-input.json"
python3 -u scripts/serve-preview.py --directory "$preview_dir" --timeout-seconds 7200
```

Replace `<input.json>` with the real schema-conforming input path. `--standalone` is required. A fragment served without it can misdecode the minus sign, arrows, separators, or keyboard glyphs. `functions-report-input.json` is the receipt and must remain an exact copy of the input consumed by the renderer.

Use only `scripts/serve-preview.py`; remove the generic `python -m http.server` line if copying an older command block. Keep the long-running server session available until the browser preview has been delivered. Port `0` tells the operating system to choose an unoccupied port; read the actual port from the helper's startup URL. The helper always stops automatically: its default timeout is two hours (`7200` seconds), and it rejects timeouts longer than four hours (`14400` seconds). Never run a preview server without this timeout failsafe.

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

Replace `<selected-port>` with the numeric port printed by the server. Do not use a `file:` URL: the in-app browser preview must come from `http://127.0.0.1:<port>/...`. In particular, never navigate to `assets/report-template.html`; it is not generated output. Do not detach the server with `&`, kill an unrelated listener, or reuse a URL without first confirming that it serves the newly generated document.

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
- The total count badge is present and matches the displayed inventory: untagged and `ADD` children count, while `REMOVE` children do not.
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
- If the tab shows `assets/report-template.html` or any other `file:` URL, it is not a valid preview. Generate a standalone document and navigate that tab to its verified loopback URL.
- If the page is garbled or symbols are broken, regenerate with `--standalone`; do not patch the output HTML by hand.

Do not stop at generation or server startup. The preview is complete only after the in-app-browser tab has loaded the report and the required interface elements have been verified.

## 6. Return the website URL and JSON receipt

After browser verification, return both required outputs in this order:

1. `Website:` followed by the exact verified loopback URL as a clickable Markdown link. The visible label and link target must both be the complete URL, including `http://`, `127.0.0.1`, the selected numeric port, and the generated document path:

   ```text
   Website: [http://127.0.0.1:<selected-port>/functions-report.html](http://127.0.0.1:<selected-port>/functions-report.html)
   ```

   Replace `<selected-port>` with the actual port. Never substitute a local `.html` filesystem link, a bare filename or path, or a `file:` URL. Return the same live URL that was successfully loaded and verified in the in-app browser; do not reuse a stale port or invent a URL from the output file's location.

2. `JSON receipt:` followed by the exact `functions-report-input.json` receipt as a clickable local-file link. Also include its complete JSON contents in a fenced `json` block unless the user asks for only the file. Do not regenerate the receipt from the normalized model, scrape it from the rendered page, summarize it, or silently omit fields.

The verified HTTP website URL and the unchanged input receipt are the two required outputs of this workflow.
