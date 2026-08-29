---
name: functions-report
description: Inspect requested current source files or folders and produce one concise, fully indented structural outline of their named callables. Use for functions-outline requests; this skill analyzes source without editing it and does not produce call-flow, dependency, risk, or exhaustive callable-inventory reports.
---

# Functions Report

Inspect the requested current source scope and return one concise structural outline of its named callables. Analyze only; do not edit the inspected source unless the user separately requests source changes.

## Scope and evidence

- Resolve the user-requested paths and respect deliberately narrow file, folder, or symbol scopes. Inspect enough current source to report the requested scope accurately.
- When files or folders are requested without narrower symbols, include the named callables defined in those scoped files. Omit trivial anonymous iteration and wiring callbacks unless the user explicitly asks for them.
- Derive every callable name, parameter, return annotation or result shape, and note from the inspected code. Do not invent missing information or descriptive names for anonymous callables.
- If a requested path cannot be resolved, state that briefly before the outline instead of fabricating content.

## Normalize the structural hierarchy

For each included callable, form a structural path from every directory segment plus its defining filename. The callable is a child of that path and never participates in prefix calculation.

1. Compute the longest structural prefix shared by all included callables.
2. Remove that entire shared prefix from the displayed hierarchy.
3. Never restore a removed repository, application, `src`, `Sources`, module, folder, or filename for context.
4. Render only the remaining structural nodes, then their callables, in this order: folder or module nodes, file nodes, callables, and optional nested notes.
5. Preserve every real structural level after the shared prefix. Do not flatten divergent folders.

Consequences:

- One file: all directory and filename segments are shared, so begin directly with its callables.
- Several files in one directory: omit the shared directories and use the differing filenames as top-level nodes.
- Divergent subfolders: retain each differing folder and nest its files beneath it.

## Render the outline

- Return exactly one fully indented hierarchy in a fenced `text` block. Apart from a brief unresolved-path notice when needed, do not add prose or separate sections.
- Show each callable with its real source-level name and actual parameter names. Include `()` when it has no explicit parameters, and preserve compact meaningful syntax such as destructuring, rest parameters, defaults, or labels.
- Add `→ ReturnType` only when a source-supported return type or result shape materially improves understanding. It is not required on every callable.
- Let a self-explanatory signature stand alone. When the signature is insufficient, add one concise explanation nested directly beneath it.
- Add a concise nested `Uses:` or `Updates:` note only for an architecturally important implicit dependency, state mutation, persistence effect, or other side effect.
- Do not add call-flow, dependency, risk, commentary, broken-connection, or other report sections.

Compact normalization examples:

```text
# All callables are in repo/src/config.ts; omit the entire shared file path.
loadConfig(path)
saveConfig(path, options = {})
  Updates: Persists the normalized configuration.

# Callables are in repo/src/parser.ts and repo/src/renderer.ts; omit repo/src.
parser.ts
  parse(input) → SyntaxTree
renderer.ts
  render(tree)

# Callables diverge under repo/src/client and repo/src/server; retain those folders.
client/
  request.ts
    sendRequest(url, { signal })
server/
  handler.ts
    handleRequest(request) → Response
```
