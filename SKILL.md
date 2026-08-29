---
name: functions-report
description: Inspect requested current source files or folders and produce one concise structural functions outline as an interactive keyboard-review tree. Use for functions-outline requests; analyze source without editing it and do not produce call-flow, dependency, risk, or exhaustive callable-inventory reports.
---

# Functions Report

Inspect the requested current source scope and report its named callables in one normalized structural hierarchy. Analyze only; do not edit the inspected source unless the user separately requests source changes.

## Collect source evidence

- Resolve the user-requested paths and respect deliberately narrow file, folder, or symbol scopes. Inspect enough current source to report the requested scope accurately.
- When files or folders are requested without narrower symbols, include the named callables defined in those scoped files. Omit trivial anonymous iteration and wiring callbacks unless the user explicitly asks for them.
- Derive every callable name, parameter, return annotation or result shape, and note from the inspected code. Do not invent missing information or descriptive names for anonymous callables.
- If a requested path cannot be resolved, state that briefly before the report instead of fabricating content.

## Build structured input

Read [references/report-input.schema.json](references/report-input.schema.json), then write a temporary JSON input that conforms to it:

- Set `schemaVersion` to `1`.
- Add one `files` record per defining source file. Give each record its structural `path`, including all directory segments and the filename; the renderer removes the common prefix.
- Put the real source-level name and actual parameters in each callable's `signature`. Include `()` when there are no explicit parameters, and preserve compact meaningful syntax such as destructuring, rest parameters, defaults, or labels.
- Add `returns` only when a source-supported return type or result shape materially improves understanding.
- Let a self-explanatory signature stand alone. Add `description` only when one concise responsibility statement is needed.
- Add `uses` or `updates` only for an architecturally important implicit dependency, state mutation, persistence effect, or other side effect.
- For an ordinary report, omit each file's optional `changes` object so its green addition and red deletion figures remain zero. For a proposal with supported change counts, set `changes.additions` and `changes.deletions` on each file; folder figures aggregate their descendant files.
- Do not add annotations, source excerpts, full-path display fields, call graphs, filters, or old report sections to the input.

## Render and present — mandatory

For every report, inspect the requested source, create schema-conforming temporary input, and generate the interactive HTML from the skill directory with:

```text
node scripts/render-report.mjs <input.json> <output.html>
```

The output is a self-contained HTML fragment. Present its complete contents as the standalone, user-visible interactive report; do not replace it with Markdown, a code block, an explanation, or a manually constructed outline. It provides native disclosure controls at every folder, file, and detail-bearing callable level, visible-node keyboard navigation, and one in-memory annotation per folder, file, callable, or callable detail row. Its visible `Copy annotations` button and plain `C` shortcut copy only the current annotations as portable Markdown. Do not claim that annotations persist or add any host messaging, file transfer, storage, or other transport.

Each structural header orders its metadata as the final numeric count badge, compact green addition/red deletion figures, a divider, then source-language and semantic item-kind badges. File language is derived from its filename extension (for example, `.js` is `JavaScript` and `.sh` is `Shell`); folders show the unique source languages represented by descendant files. This outline uses a `FUNCTIONS` item-kind badge; the same badge treatment is available to `CONSTANTS` in report variants that contain that category. A folder's final count is its total descendant files, while a file's final count is its reported callables. Ordinary reports show `+0 −0`; proposal inputs can supply per-file changes, which aggregate into folder figures.

There is no text fallback. If the interface cannot present the generated HTML artifact, say that rendering is unavailable and stop; do not provide a partial report in another format. Apart from a brief unresolved-path or rendering-unavailable notice, add no prose or separate sections.

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

1. Treat each callable as a child of a structural path containing every directory segment plus its defining filename. Callable names do not participate in prefix calculation.
2. Compute the longest structural prefix shared by every included callable's file path, including filenames in the calculation.
3. Remove that entire prefix. Never restore a removed repository, application, `src`, `Sources`, module, folder, or filename for context.
4. Render only the remaining folder or module nodes, file nodes, callables, and optional nested notes, in that order. Preserve every real structural level that remains.
5. With one file, omit all directories and its filename so callables are roots. With sibling files, use filenames as roots. With divergent subfolders, retain the differing folders and nest their files.

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
