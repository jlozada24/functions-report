---
name: functions-report
description: Inspect requested source files or folders and produce one concise current-state or explicit-proposal functions outline, including relevant named constants, types, capabilities, macros, and extension scopes, as an interactive keyboard-review tree. Use for functions-outline requests; clearly mark proposed additions and removals, analyze without editing source, and do not produce call-flow, dependency, risk, or exhaustive source-inventory reports.
---

# Functions Report

Inspect the requested current source scope and report its named callables plus relevant named constants, types, capabilities, macros, and extension scopes in one normalized structural hierarchy. Analyze only; do not edit the inspected source unless the user separately requests source changes.

## Collect source evidence

- Resolve the user-requested paths and respect deliberately narrow file, folder, or symbol scopes. Inspect enough current source to report the requested scope accurately.
- When files or folders are requested without narrower symbols, include relevant named items in these classifications:
  - `callables`: functions, methods, handlers, initializers, operators, and other named invocable declarations.
  - `constants`: named immutable values.
  - `types`: classes, structs, enums, actors, records, unions, aliases, and named object, dictionary, or JSON-like shapes.
  - `capabilities`: explicit named behavioral contracts such as Swift or Objective-C protocols, TypeScript/C#/Go interfaces, Rust traits, and comparable declared C++ abstract contracts. Do not infer a capability from ordinary JavaScript duck typing or coincidentally matching methods; require a source-level named contract such as an explicit JSDoc declaration.
  - `macros`: named preprocessor macros and comparable explicit macro declarations.
  - `extensions`: named augmentation scopes such as Swift extensions, Objective-C categories, or explicit module/prototype augmentations. Treat an extension as an expandable structural group and put its callables, constants, types, capabilities, or macros inside it.
- Omit trivial anonymous iteration, wiring callbacks, incidental local values, imports, and unnamed shapes unless the user explicitly asks for them.
- For a current-state report, derive every displayed declaration, callable parameter, return annotation or result shape, and note from the inspected code. Do not invent missing information or descriptive names for anonymous items.
- When the user explicitly requests a proposal, include concrete files or source items that proposal would create or remove. Mark every such item in the structured input; never present a proposed addition as though it already exists or a proposed removal as though it will remain unchanged.
- Scope an explicit-proposal report by folder branch, not by individual changed item. Retain every folder whose subtree contains an affected file. Within each retained folder, include every source file directly contained there and each displayed file's complete relevant named-item inventory, including unchanged sibling files and unchanged items in affected files. Retain a child folder only when its own subtree contains an affected file; omit the entire branch for every untouched sibling folder. This keeps full local context along affected paths without expanding branches the proposal never touches.
- If a requested path cannot be resolved, state that briefly before the report instead of fabricating content.

## Build structured input

Read [references/report-input.schema.json](references/report-input.schema.json), then write a temporary JSON input that conforms to it:

- Set `schemaVersion` to `2`.
- Add one `files` record per defining source file. Give each record its structural `path`, including all directory segments and the filename; the renderer removes the common prefix.
- Let the renderer infer the language or file type from the path when it is unambiguous. Set the optional `language` field when source inspection establishes a more accurate label for an ambiguous `.h` file, an extensionless script, a `.sh` file with a specific shell, or another filename that cannot identify its language reliably.
- Put the real source-level name and actual parameters in each callable's `signature`. Include `()` when there are no explicit parameters, and preserve compact meaningful syntax such as destructuring, rest parameters, defaults, or labels.
- Put every item in its classification field exactly as defined above. Use its real source-level declaration or a compact defining shape as `signature`; add `description` only when the declaration is not self-explanatory. Do not emit the removed `dataStructures` field; use `types` throughout.
- For each augmentation scope, add one object to `extensions`, preserve its real declaration in `signature`, and place its source items in the same classification arrays nested inside that object. Do not flatten extension members into the file or count the extension itself as a source item.
- Add `returns` only when a source-supported return type or result shape materially improves understanding.
- Let a self-explanatory signature stand alone. Add `description` only when one concise responsibility statement is needed.
- Add `uses` or `updates` only for an architecturally important implicit dependency, state mutation, persistence effect, or other side effect.
- Set `proposal` to `"add"` for a proposed addition and `"remove"` for a proposed deletion. The renderer places a bright-green `ADD` or red `REMOVE` badge immediately after the row's expander/bullet and before its label or signature. It changes only the marked item's immediate parent by one: a direct source item changes its file, an extension member changes its extension group, an extension group changes its file, and a file changes its directly enclosing folder. Do not propagate that automatic increment or decrement to higher ancestors or duplicate it in `changes`.
- For an ordinary report, omit each file's optional `changes` object so its green addition and red deletion figures remain zero. For a proposal with supported file totals, set `changes.additions` and `changes.deletions` to the complete file-level figures, including proposal-marked direct source items and extension groups. The renderer shows those totals on the defining file without counting proposal rows twice and never lets a supplied total fall below the visible direct-child proposal count. Folder figures remain derived from their directly displayed file proposal badges, and extension figures remain derived from their directly displayed member proposal badges.
- The prominent numeric badge is derived only from the displayed child inventory. Count every untagged or `ADD` child row and exclude every `REMOVE` child row. The parent item's own proposal badge never overrides the count of its children, and the separate `changes` figures never alter the numeric badge.
- Do not add annotations, source excerpts, full-path display fields, call graphs, filters, or old report sections to the input.

## Render and present — mandatory

For every report, inspect the requested source, create schema-conforming temporary input, and generate the interactive HTML from the skill directory with:

```text
node scripts/render-report.mjs <input.json> <output.html>
```

The output is a self-contained HTML fragment. Treat the file written to `<output.html>` as the report artifact and surface that exact file as a direct clickable local-file link after rendering succeeds. Resolve a relative output path to an absolute path before linking it; use the same path passed to the renderer, for example `Report: [output.html](</absolute/path/to/output.html>)`. Do not paste or reconstruct the fragment, link to `assets/report-template.html`, link to the input JSON, or substitute a copied, renamed, guessed, or normalized artifact. The link target must be the literal generated HTML file. It provides native disclosure controls at every folder, file, and detail-bearing source-item level, visible-node keyboard navigation, and one in-memory annotation per displayed row. Its visible `Copy annotations` button and plain `C` shortcut copy only the current annotations as portable Markdown. Do not claim that annotations persist or add any host messaging, file transfer, storage, or other transport.

The renderer owns these controls and all structural metadata UI through its fixed asset template; report input supplies data only. It validates the template contract and fails instead of emitting output when the shortcut legend, annotation-copy control, total count badge, addition/deletion figures, metadata divider, language/inventory badges, or proposal status badges are missing or misplaced. For a direct browser preview rather than a host-embedded fragment, add `--standalone`; this wraps the same generated fragment in a UTF-8 document so its arrows, minus sign, separators, and keyboard glyphs decode correctly.

When the user asks to open, show, render, preview, or verify the report in the in-app browser, read and follow [references/in-app-browser-preview.md](references/in-app-browser-preview.md) completely. That workflow is mandatory: generate with `--standalone`, copy the exact input JSON unchanged as the receipt, serve both outputs over loopback HTTP using `scripts/serve-preview.py` with its mandatory two-hour timeout, explicitly select the in-app browser, navigate it to the served report URL, and verify the loaded report. `assets/report-template.html` is an internal fragment with unresolved placeholders, never a preview artifact: do not navigate a browser to it or any other `file:` URL. Do not paste its markup into an unrelated page, substitute web search or another browser surface, or merely tell the user which URL to open. The generated standalone document served over loopback HTTP is the only valid direct-browser report. This preview-only workflow is the website-link exception to the ordinary local-artifact rule: after verification, return the exact verified loopback URL as a clickable Markdown link whose label and target are both the complete `http://127.0.0.1:<port>/...` URL; never substitute an HTML filesystem path or `file:` URL. Also return the unchanged JSON receipt as a clickable local file and include its complete contents unless the user requests only the file.

Each structural header orders its metadata as an optional proposal badge, its label, the prominent final numeric count badge, prominent green addition/red deletion figures, a visible divider, then content-inventory tags. Source-item rows use the same left-edge order: expander/bullet, optional badge, signature, then any return metadata. Folder tags put `FOLDERS` first when the folder directly contains nested folders, followed left-to-right by the unique source languages or file types represented by descendant files. File rows never show their own language as a tag; their inventory tags use this fixed order when present: `FUNCTIONS`, `CONSTANTS`, `TYPES`, `CAPABILITIES`, `MACROS`, `EXTENSIONS`. Extension rows use the same inventory tags for their direct members. A folder's final count is the number of displayed descendant files that are untagged or tagged `ADD`; files tagged `REMOVE` do not count. A file or extension's final count is the number of displayed descendant source items that are untagged or tagged `ADD`; `REMOVE` source items do not count. Removing a container does not force its own child count to zero. Ordinary reports show `+0 −0`; automatic proposal figures stop after the marked item's immediate parent.

The renderer uses deterministic high-chroma colors from `REPORT_COLOR_CONFIG` in `scripts/render-report.mjs`. Folders and files have independent structural color systems. Each folder receives a stable breadcrumb-derived accent from the separate lower-saturation `folderPalette`; deterministic collision resolution prevents sibling folders at the same level from sharing a palette entry. Folder colors never inherit or imitate descendant language colors. Every file row receives a moderate language accent: its filename, three-pixel rail, border, restrained background tint, and soft glow use the same saturated language color as that language's folder tag. The language palette includes AppleScript, Bash, C, C++, C#, JavaScript, Objective-C, Objective-C++, Swift, TypeScript, Rust, Go, Shell, Zsh, JSON, PLIST, XCCONFIG, and PBXPROJ among the other configured labels; unknown labels use the configured stable fallback. Callable rows always use the reserved configurable callable purple, while the separate `FUNCTIONS` inventory tag uses neon cyan. Constants use neon pink, types intense dark red, capabilities neon orange, macros neon yellow, and extension scopes neon teal. Detail rows remain neutral.

There is no text fallback. If the interface cannot present a direct local-file link to the exact generated HTML artifact, say that rendering is unavailable and stop; do not provide a partial report in another format. Apart from a brief unresolved-path or rendering-unavailable notice and the mandatory exact HTTP preview URL and JSON receipt for an in-app-browser preview, add no prose or separate report sections.

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

1. Treat each source item and extension scope as a child of a structural path containing every directory segment plus its defining filename. Source-item names and extension signatures do not participate in prefix calculation.
2. Compute the longest structural prefix shared by every included source item's file path, including filenames in the calculation.
3. Remove that entire prefix. Never restore a removed repository, application, `src`, `Sources`, module, folder, or filename for context.
4. Render only the remaining folder or module nodes, file nodes, source items, and optional nested notes, in that order. Preserve every real structural level that remains.
5. With one file, omit all directories and its filename so source items and extension scopes are roots. Proposal exception: when that file, one of its extension scopes, or one of its source items has a `proposal` marker, retain the filename so its automatic parent figure remains visible. With sibling files, use filenames as roots. With divergent subfolders, retain the differing folders and nest their files.

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
