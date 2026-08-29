---
name: functions-report
description: Inspect requested source files or folders and produce one concise current-state or explicit-proposal functions outline, including named constants and data structures when relevant, as an interactive keyboard-review tree. Use for functions-outline requests; clearly mark proposed additions and removals, analyze without editing source, and do not produce call-flow, dependency, risk, or exhaustive source-inventory reports.
---

# Functions Report

Inspect the requested current source scope and report its named callables plus relevant named constants and data structures in one normalized structural hierarchy. Analyze only; do not edit the inspected source unless the user separately requests source changes.

## Collect source evidence

- Resolve the user-requested paths and respect deliberately narrow file, folder, or symbol scopes. Inspect enough current source to report the requested scope accurately.
- When files or folders are requested without narrower symbols, include their named callables, named constants, and named data structures such as enums, object or dictionary shapes, and JSON-like declarations. Omit trivial anonymous iteration, wiring callbacks, and incidental local values unless the user explicitly asks for them.
- For a current-state report, derive every displayed declaration, callable parameter, return annotation or result shape, and note from the inspected code. Do not invent missing information or descriptive names for anonymous items.
- When the user explicitly requests a proposal, include concrete files or source items that proposal would create or remove. Mark every such item in the structured input; never present a proposed addition as though it already exists or a proposed removal as though it will remain unchanged.
- If a requested path cannot be resolved, state that briefly before the report instead of fabricating content.

## Build structured input

Read [references/report-input.schema.json](references/report-input.schema.json), then write a temporary JSON input that conforms to it:

- Set `schemaVersion` to `1`.
- Add one `files` record per defining source file. Give each record its structural `path`, including all directory segments and the filename; the renderer removes the common prefix.
- Put the real source-level name and actual parameters in each callable's `signature`. Include `()` when there are no explicit parameters, and preserve compact meaningful syntax such as destructuring, rest parameters, defaults, or labels.
- Put named constants in `constants` and named enums, object or dictionary shapes, JSON-like declarations, and comparable types in `dataStructures`. Use their real source-level declaration or a compact defining shape as `signature`; add `description` only when the declaration is not self-explanatory.
- Add `returns` only when a source-supported return type or result shape materially improves understanding.
- Let a self-explanatory signature stand alone. Add `description` only when one concise responsibility statement is needed.
- Add `uses` or `updates` only for an architecturally important implicit dependency, state mutation, persistence effect, or other side effect.
- Set `proposal` to `"add"` for a proposed addition and `"remove"` for a proposed deletion. The renderer places a bright-green `ADD` or red `REMOVE` badge immediately after the row's expander/bullet and before its label or signature. It changes only the marked item's immediate parent by one: a callable, constant, or data structure changes its defining file's matching figure, while a file changes its directly enclosing folder's matching figure. Do not propagate that automatic increment or decrement to higher ancestors or duplicate it in `changes`.
- For an ordinary report, omit each file's optional `changes` object so its green addition and red deletion figures remain zero. For a proposal with other supported change counts, set `changes.additions` and `changes.deletions` on each file; the renderer adds the direct-parent proposal figures described above while ordinary supplied file changes retain their existing folder aggregation.
- The prominent numeric badge is derived only from the displayed child inventory. Count every untagged or `ADD` child row and exclude every `REMOVE` child row. The parent item's own proposal badge never overrides the count of its children, and the separate `changes` figures never alter the numeric badge.
- Do not add annotations, source excerpts, full-path display fields, call graphs, filters, or old report sections to the input.

## Render and present — mandatory

For every report, inspect the requested source, create schema-conforming temporary input, and generate the interactive HTML from the skill directory with:

```text
node scripts/render-report.mjs <input.json> <output.html>
```

The output is a self-contained HTML fragment. Present its complete contents as the standalone, user-visible interactive report; do not replace it with Markdown, a code block, an explanation, or a manually constructed outline. It provides native disclosure controls at every folder, file, and detail-bearing source-item level, visible-node keyboard navigation, and one in-memory annotation per displayed row. Its visible `Copy annotations` button and plain `C` shortcut copy only the current annotations as portable Markdown. Do not claim that annotations persist or add any host messaging, file transfer, storage, or other transport.

The renderer owns these controls and all structural metadata UI through its fixed asset template; report input supplies data only. It validates the template contract and fails instead of emitting output when the shortcut legend, annotation-copy control, total count badge, addition/deletion figures, metadata divider, language/inventory badges, or proposal status badges are missing or misplaced. For a direct browser preview rather than a host-embedded fragment, add `--standalone`; this wraps the same generated fragment in a UTF-8 document so its arrows, minus sign, separators, and keyboard glyphs decode correctly.

When the user asks to open, show, render, preview, or verify the report in the in-app browser, read and follow [references/in-app-browser-preview.md](references/in-app-browser-preview.md) completely. That workflow is mandatory: generate with `--standalone`, copy the exact input JSON unchanged as the receipt, serve both outputs over loopback HTTP using `scripts/serve-preview.py` with its mandatory two-hour timeout, explicitly select the in-app browser, navigate it to the served report URL, and verify the loaded report. `assets/report-template.html` is an internal fragment with unresolved placeholders, never a preview artifact: do not navigate a browser to it or any other `file:` URL. Do not paste its markup into an unrelated page, substitute web search or another browser surface, or merely tell the user which URL to open. The generated standalone document served over loopback HTTP is the only valid direct-browser report. After verification, return the unchanged JSON receipt as a clickable local file and include its complete contents unless the user requests only the file.

Each structural header orders its metadata as an optional proposal badge, its label, the prominent final numeric count badge, prominent green addition/red deletion figures, a visible divider, then content-inventory tags. Source-item rows use the same left-edge order: expander/bullet, optional badge, signature, then any return metadata. Folder tags show the unique source languages represented by descendant files and add `FOLDERS` when the folder directly contains nested folders. File rows never show their own source language as a tag; their inventory tags describe contained `FUNCTIONS`, `CONSTANTS`, and `STRUCTURES`. A folder's final count is the number of displayed descendant files that are untagged or tagged `ADD`; files tagged `REMOVE` do not count. A file's final count follows the identical inventory rule for all displayed source items. Removing a file does not force that file's own item count to zero: only child rows individually tagged `REMOVE` are excluded from it. Ordinary reports show `+0 −0`; automatic proposal figures stop after the marked item's immediate parent.

The renderer uses deterministic high-chroma colors from `REPORT_COLOR_CONFIG` in `scripts/render-report.mjs`. Folders and files have independent structural color systems. Each folder receives a stable breadcrumb-derived accent from the separate lower-saturation `folderPalette`; deterministic collision resolution prevents sibling folders at the same level from sharing a palette entry. Folder colors never inherit or imitate descendant language colors. Every file row receives a moderate language accent: its filename, three-pixel rail, border, restrained background tint, and soft glow use the same saturated language color as that language's folder tag. Callable rows always use the reserved configurable callable purple rather than inheriting a language color. Constant rows and their inventory tags use the reserved neon pink; structure rows and their inventory tags use the reserved intense dark red. Detail rows remain neutral, and unknown languages use the configured stable fallback.

There is no text fallback. If the interface cannot present the generated HTML artifact, say that rendering is unavailable and stop; do not provide a partial report in another format. Apart from a brief unresolved-path or rendering-unavailable notice and the mandatory exact JSON receipt for an in-app-browser preview, add no prose or separate report sections.

## Interpret copied annotations

The portable clipboard content uses exactly this form, preserving annotation tree order and multiline comment text:

```text
# Functions report annotations

## `<structural breadcrumb or callable signature>`

Node ID: `<stable node ID>`

<comment text>
```

When the user pastes content beginning with `# Functions report annotations`:

- Treat each `##` block as a user comment anchored to the immediately following `Node ID` and breadcrumb or signature.
- Use the node ID as the stable precise reference and the breadcrumb or signature as human-readable context.
- Preserve the comments' order and meaning when responding or applying an explicitly authorized change.
- Never treat copied annotations alone as implicit authorization to alter source. Follow the user's accompanying request and normal authorization boundaries.
- If a target cannot be found in the current report or source, explain that briefly instead of guessing.

## Common-prefix law

The renderer enforces this law. Populate the structured input so its paths produce this result:

1. Treat each source item as a child of a structural path containing every directory segment plus its defining filename. Source-item names do not participate in prefix calculation.
2. Compute the longest structural prefix shared by every included source item's file path, including filenames in the calculation.
3. Remove that entire prefix. Never restore a removed repository, application, `src`, `Sources`, module, folder, or filename for context.
4. Render only the remaining folder or module nodes, file nodes, source items, and optional nested notes, in that order. Preserve every real structural level that remains.
5. With one file, omit all directories and its filename so source items are roots. Proposal exception: when that file or one of its source items has a `proposal` marker, retain the filename so its automatic parent figure remains visible. With sibling files, use filenames as roots. With divergent subfolders, retain the differing folders and nest their files.

Compact examples:

```text
# One file: repo/src/config.ts
loadConfig(path)
saveConfig(path, options = {})
  Updates: Persists the normalized configuration.

# Sibling files: repo/src/parser.ts and repo/src/renderer.ts
parser.ts
  parse(input) → SyntaxTree
renderer.ts
  render(tree)

# Divergent folders below repo/src
client/
  request.ts
    sendRequest(url, { signal })
server/
  handler.ts
    handleRequest(request) → Response
```

Do not add call-flow, dependency, risk, commentary, broken-connection, or other report sections.
