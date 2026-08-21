---
name: functions-report
description: Inspect source files in any language or repository and produce concise, architecture-oriented function inventories and execution- or data-flow reports. Use when Codex is asked to outline or explain functions, methods, procedures, constructors, entry points, helpers, lifecycle hooks, handlers, or meaningful callbacks; trace how routines call one another; identify cross-file or cross-module dependencies; or summarize call flows across runtime, process, service, thread, or deployment boundaries.
---

# Functions Report

Produce an evidence-based inventory of every in-scope callable and the primary flows that connect them. Apply the workflow to any programming language, source layout, framework, or execution environment. Analyze only; do not edit the requested source unless the user separately requests changes.

## Inspect the code

1. Resolve every requested path to an exact file. Expand directories, globs, or ambiguous references into an explicit file list, and report any requested path that cannot be resolved.
2. Read every in-scope file completely before drafting the report. Do not infer completeness from excerpts, search results, symbol indexes, or partial reads.
3. Identify each file's language and execution context. Mark runtime, process, service, thread, module, layer, deployment, or host boundaries when they affect control or data flow.
4. Build a per-file inventory containing every named callable: functions, procedures, methods, constructors, operators, accessors with behavior, public entry points, lifecycle hooks, local routines, named handlers, named function expressions, and callables assigned to symbols. Record each symbol once under the file that defines it. Treat declarations according to the source language rather than forcing one language's terminology onto another.
5. Include an anonymous callback or closure only when it is an independently meaningful stage that cannot be represented by its caller alone, such as a distinct external failure, retry, completion, or event handler. Give it a concise descriptive label rather than inventing a source-level name. Omit trivial iteration, mapping, filtering, sorting, forwarding, adapter, and wiring callbacks.
6. Trace calls from actual call sites. Reconstruct the dominant entry flows, important branches, callbacks, and data transformations; do not claim a call edge merely because compatible functions exist.
7. Identify calls from in-scope code into callables, values, services, libraries, or modules owned outside the requested files. Search the repository or inspect the defining source far enough to establish ownership and the purpose used here, but do not add out-of-scope callables to the in-scope inventory.
8. Distinguish authoritative enforcement, mutation, validation, and side effects from advisory checks, formatting, presentation, or feedback. State which component or execution context owns each authoritative decision; for client/server systems, explicitly distinguish server enforcement from client presentation when relevant.
9. Support every statement with inspected code. Qualify framework- or platform-driven entry behavior when the invocation is conventional rather than explicitly visible in the scoped files.
10. Check inventory completeness and uniqueness before answering: every in-scope named callable appears exactly once, no omitted constructor, method, procedure, hook, or entry point remains, and no callable is duplicated across groups.

## Reconstruct flows

Choose short flow labels grounded in the code, such as `Initialization`, `Primary request`, `Command invocation`, `Event handling`, `Scheduled job`, `Queue message`, `Data pipeline`, or `Failure path`. Use `→` between real stages. Show a boundary handoff explicitly when useful, for example `process A: producer → transport → process B: consumer`.

Prefer source-level callable names in arrows. Use a short stage label only for top-level initialization, framework dispatch, persistence, external service work, or an important anonymous callback that has no source name. Include branches only when they materially change the architecture or outcome.

If a naming mismatch, missing target, unresolved symbol, unreachable handler, wrong identifier, incompatible interface, or other concrete broken connection materially interrupts a documented flow, add a separate `## Broken connection` section after the flows. State the exact conflicting names or call edge and its consequence. Omit this section when no supported material break exists.

## Format the report

Group symbols under their defining source filename. Use a clickable absolute file link in the filename heading when the interface supports local links. Group within a file by runtime or responsibility only when that improves navigation.

Use exactly one physical line per inventoried callable, with no nested bullets:

```markdown
## `<filename>`

`callableName` - One concise, behavior-specific sentence describing what the callable does.

`anotherCallable` - One concise, behavior-specific sentence describing what the callable does.

## Primary flows

Primary path - `entryPoint → input handling → core operation → result`.

Failure path - `entryPoint → dependency call → failure handler → recovery or result`.

## External dependencies

`externalCallable` - Owned by `<other file, module, library, service, or platform>` and used for a concise stated purpose.
```

Keep descriptions concrete and concise. Prefer `callableName - description`; do not restate the name generically. Cover every in-scope callable while avoiding commentary on every trivial callback. Preserve source-level names and language terminology. List an external dependency once even if several in-scope callables use it, and state the relevant owning file, module, library, service, platform, or runtime. Use absolute clickable file links for dependency owners when supported.
