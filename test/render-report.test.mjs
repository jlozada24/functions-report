import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_FRAGMENT_BYTES,
  ReportInputError,
  ReportOutputError,
  assertTemplateContract,
  createAnnotationBundle,
  formatLocalFileLink,
  normalizeReport,
  renderReport,
  validateReportInput,
  wrapStandaloneDocument,
} from "../scripts/render-report.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = dirname(testDirectory);
const templatePath = join(repositoryDirectory, "assets", "report-template.html");
const rendererPath = join(repositoryDirectory, "scripts", "render-report.mjs");
const sampleInputPath = join(repositoryDirectory, "preview", "functions-report-sample.json");
const samplePreviewPath = join(
  repositoryDirectory,
  "preview",
  "functions-report-interactive-preview.html",
);
const template = await readFile(templatePath, "utf8");
const skill = await readFile(join(repositoryDirectory, "SKILL.md"), "utf8");

function inputWith(files) {
  return { schemaVersion: 3, files };
}

function callable(signature, extra = {}) {
  return { signature, ...extra };
}

function collectIds(nodes) {
  return nodes.flatMap((node) => [
    node.id,
    ...(node.children ? collectIds(node.children) : []),
  ]);
}

test("one file removes directories and filename so callables are roots", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/src/config.ts",
        callables: [callable("loadConfig(path)"), callable("saveConfig(path)")],
      },
    ]),
  );

  assert.deepEqual(
    normalized.tree.map((node) => [node.kind, node.signature]),
    [
      ["callable", "loadConfig(path)"],
      ["callable", "saveConfig(path)"],
    ],
  );
});

test("sibling files remove their directory and become top-level file nodes", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "C:\\repo\\src\\renderer.ts",
        callables: [callable("render(tree)")],
      },
      {
        path: "C:/repo/src/parser.ts",
        callables: [callable("parse(input)", { returns: "SyntaxTree" })],
      },
    ]),
  );

  assert.deepEqual(
    normalized.tree.map((node) => [node.kind, node.label]),
    [
      ["file", "parser.ts"],
      ["file", "renderer.ts"],
    ],
  );
  assert.equal(normalized.tree[0].children[0].signature, "parse(input)");
});

test("divergent folders remain and contain their defining files", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/src/server/handler.ts",
        callables: [callable("handleRequest(request)")],
      },
      {
        path: "/repo/src/client/request.js",
        callables: [callable("sendRequest(url, { signal })")],
      },
    ]),
  );

  assert.deepEqual(
    normalized.tree.map((node) => [node.kind, node.label]),
    [
      ["folder", "client"],
      ["folder", "server"],
    ],
  );
  assert.deepEqual(
    normalized.tree.map((node) => [node.children[0].kind, node.children[0].label]),
    [
      ["file", "request.js"],
      ["file", "handler.ts"],
    ],
  );
});

test("folder tags describe contents while file tags describe inventory", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/src/client/request.js",
        callables: [callable("send()"), callable("cancel()")],
      },
      {
        path: "/repo/src/server/handler.ts",
        callables: [callable("handle()")],
      },
      {
        path: "/repo/src/server/routes/health.sh",
        callables: [callable("health()"), callable("ready()"), callable("live()")],
      },
    ]),
  );

  const [client, server] = normalized.tree;
  const routes = server.children.find((node) => node.kind === "folder");
  const handler = server.children.find((node) => node.kind === "file");

  assert.equal(client.fileCount, 1);
  assert.equal(client.finalCount, 1);
  assert.deepEqual(client.languages, ["JavaScript"]);
  assert.deepEqual(client.itemKinds, []);
  assert.deepEqual(
    { additions: client.additions, deletions: client.deletions },
    { additions: 0, deletions: 0 },
  );
  assert.equal(client.children[0].callableCount, 2);
  assert.equal(client.children[0].finalCount, 2);
  assert.deepEqual(client.children[0].languages, []);
  assert.deepEqual(client.children[0].itemKinds, ["Functions"]);
  assert.deepEqual(
    {
      additions: client.children[0].additions,
      deletions: client.children[0].deletions,
    },
    { additions: 0, deletions: 0 },
  );
  assert.equal(server.fileCount, 2);
  assert.equal(server.finalCount, 2);
  assert.deepEqual(server.languages, ["Shell", "TypeScript"]);
  assert.deepEqual(server.itemKinds, ["Folders"]);
  assert.deepEqual(
    { additions: server.additions, deletions: server.deletions },
    { additions: 0, deletions: 0 },
  );
  assert.equal(routes.fileCount, 1);
  assert.equal(routes.finalCount, 1);
  assert.deepEqual(routes.languages, ["Shell"]);
  assert.deepEqual(routes.itemKinds, []);
  assert.deepEqual(
    { additions: routes.additions, deletions: routes.deletions },
    { additions: 0, deletions: 0 },
  );
  assert.equal(routes.children[0].callableCount, 3);
  assert.equal(handler.callableCount, 1);
  assert.equal(handler.finalCount, 1);
});

test("source-item proposal figures stop at the defining file", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/Sources/CodexCursorBridgeMenu/HelperPopoverView.swift",
        callables: [
          callable("oldHelper()", { proposal: "remove" }),
          callable("newHelper()", { proposal: "add" }),
        ],
      },
      {
        path: "/repo/Tests/CodexCursorBridgeMenuTests/HelperPopoverViewTests.swift",
        callables: [callable("testHelper()")],
      },
    ]),
  );

  const sources = normalized.tree.find((node) => node.label === "Sources");
  const module = sources.children.find((node) => node.label === "CodexCursorBridgeMenu");
  const file = module.children.find((node) => node.label === "HelperPopoverView.swift");

  assert.deepEqual(
    { additions: sources.additions, deletions: sources.deletions },
    { additions: 0, deletions: 0 },
  );
  assert.deepEqual(
    { additions: module.additions, deletions: module.deletions },
    { additions: 0, deletions: 0 },
  );
  assert.deepEqual(
    { additions: file.additions, deletions: file.deletions },
    { additions: 1, deletions: 1 },
  );
});

test("file figures count visible proposal items rather than estimated diff lines", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/Tests/TurnPolicyTests.swift",
        callables: [
          callable("testOldBehavior()", { proposal: "remove" }),
          callable("testImageConversion()", { proposal: "add" }),
          callable("testTextOnlyBehavior()", { proposal: "add" }),
          callable("testUnsupportedReference()", { proposal: "add" }),
        ],
      },
    ]),
  );

  const file = normalized.tree[0];
  assert.equal(file.label, "TurnPolicyTests.swift");
  assert.deepEqual(
    { additions: file.additions, deletions: file.deletions },
    { additions: 3, deletions: 1 },
  );
});

test("file and extension proposal figures stop at their immediate parents", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/src/RecordingBackend.swift",
        callables: [
          callable("record()"),
          callable("retry()", { proposal: "add" }),
        ],
        extensions: [
          {
            signature: "extension RecordingBackend",
            proposal: "add",
            callables: [
              callable("snapshot()", { proposal: "add" }),
              callable("legacySnapshot()", { proposal: "remove" }),
            ],
          },
        ],
      },
    ]),
  );

  const file = normalized.tree[0];
  const extension = file.children.find((node) => node.kind === "extension");

  assert.deepEqual(
    { additions: file.additions, deletions: file.deletions },
    { additions: 2, deletions: 0 },
  );
  assert.deepEqual(
    { additions: extension.additions, deletions: extension.deletions },
    { additions: 1, deletions: 1 },
  );
});

test("structural node IDs remain stable when visible counts change", () => {
  const base = inputWith([
    {
      path: "/repo/src/client/request.ts",
      callables: [callable("send()")],
    },
    {
      path: "/repo/src/server/handler.ts",
      callables: [callable("handle()")],
    },
  ]);
  const changed = structuredClone(base);
  changed.files[0].callables.push(callable("cancel()"));

  const baseClient = normalizeReport(base).tree[0];
  const changedClient = normalizeReport(changed).tree[0];

  assert.equal(baseClient.fileCount, changedClient.fileCount);
  assert.equal(baseClient.id, changedClient.id);
  assert.equal(baseClient.children[0].callableCount, 1);
  assert.equal(changedClient.children[0].callableCount, 2);
  assert.equal(baseClient.children[0].id, changedClient.children[0].id);
});

test("normalization and node IDs are deterministic across file input order", () => {
  const first = inputWith([
    { path: "/repo/src/b.ts", callables: [callable("beta()")] },
    { path: "/repo/src/a.ts", callables: [callable("alpha()")] },
  ]);
  const second = inputWith([...first.files].reverse());

  const normalizedFirst = normalizeReport(first);
  const normalizedSecond = normalizeReport(second);
  assert.deepEqual(normalizedFirst, normalizedSecond);

  const ids = collectIds(normalizedFirst.tree);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^node-[a-f0-9]{20}$/.test(id)));
});

test("annotation target IDs remain stable when optional note text changes", () => {
  const base = inputWith([
    {
      path: "/repo/src/worker.ts",
      callables: [callable("run(task)", { description: "Runs a task." })],
    },
  ]);
  const changed = structuredClone(base);
  changed.files[0].callables[0].description = "Runs one queued task.";

  assert.deepEqual(
    collectIds(normalizeReport(base).tree),
    collectIds(normalizeReport(changed).tree),
  );
  const baseDetail = normalizeReport(base).tree[0].details[0];
  const changedDetail = normalizeReport(changed).tree[0].details[0];
  assert.equal(baseDetail.id, changedDetail.id);
  assert.match(baseDetail.id, /^node-[a-f0-9]{20}$/);
  assert.equal(baseDetail.breadcrumb, "run(task) › Description");
});

test("callable detail annotations copy with their own stable target", () => {
  const normalized = normalizeReport(
    inputWith([
      {
        path: "/repo/src/request.ts",
        callables: [callable("send()", { uses: "Configured transport." })],
      },
    ]),
  );
  const detail = normalized.tree[0].details[0];
  const bundle = createAnnotationBundle(
    normalized,
    new Map([[detail.id, "Confirm this dependency."]]),
  );

  assert.equal(bundle.count, 1);
  assert.match(bundle.text, /## `send\(\) › Uses`/);
  assert.ok(bundle.text.includes("Node ID: `" + detail.id + "`"));
  assert.match(bundle.text, /Confirm this dependency\./);
});

test("annotation bundles use stable IDs, structural breadcrumbs, tree order, and exact multiline text", () => {
  const normalized = normalizeReport(
    inputWith([
      { path: "/repo/src/b.ts", callables: [callable("beta()")] },
      { path: "/repo/src/a.ts", callables: [callable("alpha(value)")] },
    ]),
  );
  const alpha = normalized.tree[0].children[0];
  const beta = normalized.tree[1].children[0];
  const annotations = new Map([
    [beta.id, "Review beta."],
    [alpha.id, "First line.\nSecond line."],
  ]);

  const bundle = createAnnotationBundle(normalized, annotations);
  assert.equal(bundle.count, 2);
  assert.equal(
    bundle.text,
    [
      "# Functions report annotations",
      "",
      "## `a.ts › alpha(value)`",
      "",
      `Node ID: \`${alpha.id}\``,
      "",
      "First line.\nSecond line.",
      "",
      "## `b.ts › beta()`",
      "",
      `Node ID: \`${beta.id}\``,
      "",
      "Review beta.",
    ].join("\n"),
  );
  assert.deepEqual(createAnnotationBundle(normalized, new Map()), {
    count: 0,
    text: "",
  });
});

test("duplicate paths are rejected after slash normalization", () => {
  const input = inputWith([
    { path: "/repo/src/report.js", callables: [callable("first()")] },
    { path: "\\repo\\src\\report.js", callables: [callable("second()")] },
  ]);

  assert.throws(
    () => validateReportInput(input),
    (error) =>
      error instanceof ReportInputError && /duplicates .* separator normalization/.test(error.message),
  );
});

test("malformed schemas fail with clear field paths", () => {
  const malformedInputs = [
    [{ schemaVersion: 2, files: [] }, /\$\.schemaVersion/],
    [{ schemaVersion: 3, files: [] }, /\$\.files/],
    [
      inputWith([{ path: "/repo/a.js", callables: [{}] }]),
      /\$\.files\[0\]\.callables\[0\]\.signature/,
    ],
    [
      inputWith([
        {
          path: "/repo/a.js",
          callables: [{ signature: "run()", annotation: "not supported" }],
        },
      ]),
      /unsupported property "annotation"/,
    ],
    [
      inputWith([
        {
          path: "/repo/a.js",
          changes: { additions: 38, deletions: 17 },
          callables: [{ signature: "run()" }],
        },
      ]),
      /unsupported property "changes"/,
    ],
  ];

  for (const [input, messagePattern] of malformedInputs) {
    assert.throws(
      () => validateReportInput(input),
      (error) => error instanceof ReportInputError && messagePattern.test(error.message),
    );
  }
});

test("embedded model data escapes script-closing and HTML-sensitive content", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/private/repo/danger.js",
        callables: [
          callable('danger("</script><img src=x>&")', {
            description: "Paragraph\u2028separator",
          }),
        ],
      },
    ]),
    template,
  );

  assert.ok(fragment.includes("\\u003c/script\\u003e\\u003cimg src=x\\u003e\\u0026"));
  assert.ok(fragment.includes("Paragraph\\u2028separator"));
  assert.ok(!fragment.includes('<img src=x>'));
});

test("output is a fragment with a fingerprint root and no raw single-file path", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/Users/example/private/src/only.ts",
        callables: [callable("only()")],
      },
    ]),
    template,
  );

  assert.doesNotMatch(fragment, /<!doctype\b|<\/?(?:html|head|body)\b/i);
  assert.match(fragment, /id="functions-report-[a-f0-9]{16}"/);
  assert.match(
    fragment,
    /document\.getElementById\("functions-report-[a-f0-9]{16}"\)/,
  );
  assert.ok(!fragment.includes("/Users/example/private/src/only.ts"));
  assert.doesNotMatch(fragment, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test("skill requires a direct link to the literal generated HTML artifact", () => {
  assert.match(skill, /surface that exact file as a direct clickable local-file link/i);
  assert.match(skill, /Resolve a relative output path to an absolute path before linking it/i);
  assert.match(skill, /same path passed to the renderer/i);
  assert.match(skill, /link to `assets\/report-template\.html`/i);
  assert.match(skill, /literal generated HTML file/i);
  assert.match(skill, /preview-only workflow is the website-link exception/i);
  assert.match(skill, /JSON receipt as a clickable local file/i);
  assert.doesNotMatch(skill, /Present its complete contents as the standalone, user-visible interactive report/);
});

test("fragment wires native review navigation and the inline annotation editor", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/review.ts",
        callables: [callable("review(item)")],
      },
    ]),
    template,
  );

  assert.match(fragment, /<form[\s\S]*data-annotation-form[\s\S]*hidden/);
  assert.doesNotMatch(fragment, /<dialog\b/i);
  assert.match(fragment, /<textarea[\s\S]*data-annotation-text/);
  assert.match(fragment, /rows="1"/);
  assert.match(fragment, /<span>Cancel<\/span><kbd aria-hidden="true">Esc<\/kbd>/);
  assert.match(fragment, /<span>Save<\/span><kbd aria-hidden="true">⌘<\/kbd><kbd aria-hidden="true">↵<\/kbd>/);
  assert.match(fragment, /const annotations = new Map\(\)/);
  assert.match(fragment, /"ArrowDown"/);
  assert.match(fragment, /"ArrowUp"/);
  assert.match(fragment, /"ArrowLeft"/);
  assert.match(fragment, /"ArrowRight"/);
  assert.match(fragment, /const levelDisclosures = \(node\) =>/);
  assert.match(fragment, /const setLevelExpanded = \(node, expanded\) =>/);
  assert.match(fragment, /const setAllExpanded = \(expanded\) =>/);
  assert.match(fragment, /root\.querySelectorAll\("details"\)/);
  assert.match(fragment, /item\.querySelector\(":scope > details"\)/);
  assert.match(fragment, /event\.altKey && disclosure\?\.matches\("details"\)/);
  assert.match(fragment, /setLevelExpanded\(node, !disclosure\.open\)/);
  assert.match(fragment, /if \(event\.shiftKey\) \{\s*setAllExpanded\(!disclosure\.open\)/);
  assert.match(fragment, /if \(event\.shiftKey\) \{\s*setAllExpanded\(false\)/);
  assert.match(fragment, /if \(event\.shiftKey\) \{\s*setAllExpanded\(true\)/);
  assert.match(fragment, /All at level/);
  assert.match(fragment, /All levels/);
  assert.match(fragment, /event\.key === "Enter" \|\| event\.key === "Return"/);
  assert.match(fragment, /addEventListener\("contextmenu"/);
  assert.doesNotMatch(fragment, /addEventListener\("dblclick"/);
  assert.doesNotMatch(fragment, /double-click/i);
  assert.match(fragment, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(fragment, /dataset\.nodeId = node\.id/);
  assert.match(fragment, /annotations\.delete\(nodeId\)/);
  assert.match(fragment, /<span>Copy annotations<\/span><kbd aria-hidden="true">C<\/kbd>/);
  assert.match(fragment, /aria-keyshortcuts="C"/);
  assert.match(fragment, /aria-live="polite"/);
  assert.match(fragment, /event\.key === "c" \|\| event\.key === "C"/);
  assert.match(fragment, /!event\.metaKey/);
  assert.match(fragment, /!event\.ctrlKey/);
  assert.match(fragment, /!event\.altKey/);
  assert.match(fragment, /isEditableTarget\(event\.target\)/);
  assert.match(fragment, /navigator\.clipboard\?\.writeText/);
  assert.match(fragment, /document\.execCommand\("copy"\)/);
  assert.match(fragment, /No annotations to copy\./);
  assert.match(fragment, /annotation\$\{bundle\.count === 1 \? "" : "s"\} copied\./);
  assert.match(fragment, /dataset\.annotationBreadcrumb = node\.breadcrumb/);
  assert.match(fragment, /aria-keyshortcuts="Meta\+Enter"/);
  assert.match(fragment, /aria-keyshortcuts="Escape"/);
  assert.match(fragment, /saveButton\.addEventListener\("click", saveAnnotation\)/);
  assert.match(fragment, /const resizeAnnotationText = \(\) =>/);
  assert.doesNotMatch(fragment, /element\.getBoundingClientRect\(\)\.height/);
  assert.match(fragment, /--fr-editor-line-size: 30px/);
  assert.match(fragment, /const lineSize = 30/);
  assert.match(fragment, /class="fr-cancel"/);
  assert.match(fragment, /\.fr-editor-actions \.fr-cancel \{[\s\S]*?background: var\(--fr-red\)/);
  assert.match(fragment, /\.fr-editor-actions \.fr-save \{[\s\S]*?background: var\(--fr-green\)/);
  assert.match(fragment, /inline-size: calc\(100% - 25px\)/);
  assert.doesNotMatch(
    fragment,
    /\.fr-editor textarea,\s*[^}]*\.fr-editor-actions button\s*\{\s*min-block-size: 44px/,
  );
  assert.match(fragment, /annotationText\.scrollHeight/);
  assert.match(fragment, /annotationText\.addEventListener\("input", resizeAnnotationText\)/);
  assert.match(fragment, /resizeAnnotationText\(\);\s*annotationText\.focus\(\)/);
  assert.match(fragment, /resize: none/);
  assert.match(fragment, /insertAdjacentElement\("afterend", form\)/);
  assert.match(fragment, /if \(disclosure\?\.matches\("details"\)\) disclosure\.open = true/);
  assert.match(fragment, /event\.key === "Escape"/);
  assert.match(fragment, /note\.tabIndex = -1/);
  assert.doesNotMatch(fragment, /\.tabIndex\s*=\s*(?:0|[1-9])/);
  assert.doesNotMatch(
    fragment,
    /\b(?:localStorage|sessionStorage|window\.openai|sendFollowUpMessage)\b/,
  );
});

test("a callable with hidden detail renders as an open native disclosure", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/review.ts",
        callables: [
          callable("review(item)", {
            description: "Reviews one item.",
            uses: "The active review policy.",
            updates: "Records the review result.",
          }),
        ],
      },
    ]),
    template,
  );

  assert.match(fragment, /const hasDetails = Boolean\(node\.details\?\.length\)/);
  assert.match(fragment, /document\.createElement\(hasDetails \? "summary" : "button"\)/);
  assert.match(fragment, /if \(hasDetails\) \{/);
  assert.match(fragment, /const disclosure = document\.createElement\("details"\)/);
  assert.match(fragment, /disclosure\.className = "fr-callable-disclosure"/);
  assert.match(fragment, /disclosure\.open = true/);
  assert.match(fragment, /callableNode\.className = "fr-tree-row fr-node fr-callable-node"/);
  assert.match(fragment, /content\.className = "fr-callable-content"/);
  assert.match(fragment, /for \(const detail of node\.details\) appendNote\(content, detail\)/);
  assert.match(fragment, /disclosure\.append\(callableNode, content\)/);
  assert.match(fragment, /summary\.fr-callable-node::before/);
  assert.match(fragment, /\.fr-callable-disclosure:not\(\[open\]\) > summary\.fr-callable-node::before/);
  assert.match(fragment, /transform: rotate\(90deg\)/);
  assert.match(fragment, /transform: rotate\(0deg\)/);
});

test("a callable without hidden detail renders as a non-disclosure row", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/review.ts",
        callables: [callable("review(item)", { returns: "ReviewResult" })],
      },
    ]),
    template,
  );

  assert.match(fragment, /document\.createElement\(hasDetails \? "summary" : "button"\)/);
  assert.match(fragment, /if \(!hasDetails\) callableNode\.type = "button"/);
  assert.match(fragment, /\} else \{\s*item\.append\(callableNode\)/);
  assert.match(fragment, /button\.fr-callable-node \{\s*appearance: none/);
  assert.match(fragment, /button\.fr-callable-node::before[\s\S]*?content: "•"/);
  assert.match(fragment, /\.fr-callable-node:hover/);
  assert.doesNotMatch(fragment, /addEventListener\("dblclick"/);
});

test("callable signatures use safe IDE-style syntax token spans", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/request.ts",
        callables: [
          callable('async sendRequest(url, retries = 2, mode = "fast")', {
            returns: "Promise<Response>",
          }),
        ],
      },
    ]),
    template,
  );

  assert.match(fragment, /const tokenizeSignature = \(signature\) =>/);
  assert.match(fragment, /const appendHighlightedSignature = \(container, signature\) =>/);
  assert.match(fragment, /appendHighlightedSignature\(signature, node\.signature\)/);
  assert.match(fragment, /span\.textContent = token\.text/);
  assert.match(fragment, /returnType\.textContent = node\.returns/);
  assert.match(fragment, /fr-syntax-keyword/);
  assert.match(fragment, /fr-syntax-name/);
  assert.match(fragment, /fr-syntax-parameter/);
  assert.match(fragment, /fr-syntax-punctuation/);
  assert.match(fragment, /fr-syntax-string/);
  assert.match(fragment, /fr-syntax-literal/);
  assert.match(fragment, /fr-syntax-type/);
  assert.doesNotMatch(fragment, /\.innerHTML\s*=/);
});

test("visible-node traversal excludes descendants of every collapsed disclosure", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/server/routes/health.ts",
        callables: [callable("health()", { description: "Checks health." })],
      },
      {
        path: "/repo/src/client/request.ts",
        callables: [callable("send()")],
      },
    ]),
    template,
  );

  assert.match(fragment, /const isNodeVisible = \(element\) =>/);
  assert.match(fragment, /while \(ancestor && ancestor !== root\)/);
  assert.match(fragment, /ancestor\.matches\("details:not\(\[open\]\)"\)/);
  assert.match(fragment, /if \(summary !== element && !summary\?\.contains\(element\)\) return false/);
  assert.match(fragment, /filter\(isNodeVisible\)/);
  assert.match(fragment, /const reconcileCollapsedDisclosure = \(event\) =>/);
  assert.match(fragment, /disclosure\.contains\(activeNode\)/);
  assert.match(fragment, /details\.addEventListener\("toggle", reconcileCollapsedDisclosure\)/);
  assert.match(fragment, /disclosure\.addEventListener\("toggle", reconcileCollapsedDisclosure\)/);
  assert.match(fragment, /if \(!form\.hidden && disclosure\.contains\(form\)\)/);
  assert.match(fragment, /setActiveNode\(summary\)/);
  assert.match(fragment, /summary\.focus\(\{ preventScroll: true \}\)/);
});

test("group disclosures start collapsed only when their change figures are zero", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/changed.ts",
        callables: [callable("added()", { proposal: "add" })],
      },
      {
        path: "/repo/src/unchanged.ts",
        callables: [callable("existing()")],
      },
    ]),
    template,
  );

  assert.match(fragment, /details\.open = node\.additions !== 0 \|\| node\.deletions !== 0/);
  assert.match(fragment, /disclosure\.open = true/);
});

test("callable detail notes are bullet rows in visible keyboard traversal", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/request.ts",
        callables: [
          callable("send()", {
            description: "Sends a request.",
            uses: "The configured transport.",
            updates: "Request metrics.",
          }),
        ],
      },
    ]),
    template,
  );

  assert.match(fragment, /note\.className = `fr-tree-row fr-node fr-note fr-note-\$\{detail\.field\}`/);
  assert.match(fragment, /note\.tabIndex = -1/);
  assert.match(fragment, /note\.dataset\.nodeId = detail\.id/);
  assert.match(fragment, /note\.dataset\.annotationBreadcrumb = detail\.breadcrumb/);
  assert.match(fragment, /addAnnotationMarker\(note\)/);
  assert.match(fragment, /setNodeAccessibleLabel\(note\)/);
  assert.match(fragment, /\.fr-note::before[\s\S]*?content: "•"/);
  assert.match(fragment, /querySelectorAll\("\.fr-tree-row"\)/);
  assert.match(fragment, /event\.target\.closest\?\.\("\.fr-tree-row"\)/);
  assert.match(fragment, /node\.matches\("\.fr-node"\)/);
  assert.match(fragment, /event\.target\.closest\?\.\("\.fr-node"\)/);
});

test("hierarchy levels use distinct rainbow accents while signatures keep syntax colors", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/client/request.ts",
        callables: [callable("async send(url)", { description: "Sends it." })],
      },
      {
        path: "/repo/server/handler.ts",
        callables: [callable("handle(request)")],
      },
    ]),
    template,
  );

  assert.match(fragment, /--fr-red: #ff3b5c/);
  assert.match(fragment, /--fr-green: #35f27a/);
  assert.match(fragment, /--fr-blue: #4d7cff/);
  assert.match(fragment, /--fr-level-folder: var\(--fr-red\)/);
  assert.match(fragment, /--fr-level-file: var\(--fr-cyan\)/);
  assert.match(fragment, /--fr-level-callable: var\(--fr-purple\)/);
  assert.match(fragment, /--fr-level-detail: var\(--fr-green\)/);
  assert.match(fragment, /\.fr-folder > details > summary\.fr-node,[\s\S]*?\.fr-file > details > summary\.fr-node[\s\S]*?background: color-mix/);
  assert.match(fragment, /\.fr-callable-node \{[\s\S]*?--fr-row-color: var\(--fr-level-callable\)/);
  assert.match(fragment, /\.fr-syntax-keyword \{ color: var\(--fr-syntax-keyword\); \}/);
  assert.match(fragment, /\.fr-syntax-parameter \{ color: var\(--fr-syntax-parameter\); \}/);
});

test("nested hierarchy uses compact disclosure rows instead of stacked cards", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/client/request.ts",
        callables: [callable("send()", { description: "Sends a request." })],
      },
      {
        path: "/repo/src/server/handler.ts",
        callables: [callable("handle()")],
      },
    ]),
    template,
  );

  assert.match(fragment, /item\.className = `fr-group fr-\$\{node\.kind\}`/);
  assert.match(fragment, /details \.fr-group \{[\s\S]*?background: transparent;[\s\S]*?border: 0;[\s\S]*?border-bottom: 1px solid var\(--fr-divider\)/);
  assert.match(fragment, /\.fr-callable \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;[\s\S]*?border: 0;[\s\S]*?border-bottom: 1px solid var\(--fr-divider\)/);
  assert.match(fragment, /\.fr-note \{[\s\S]*?padding: 1px 4px;[\s\S]*?background: transparent/);
  assert.match(fragment, /border-inline-start: 1px solid color-mix/);
});

test("fragment renders the reference-inspired responsive report shell", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/report.ts",
        callables: [callable("renderReport(input)")],
      },
    ]),
    template,
  );

  assert.match(fragment, /<div class="fr-header">/);
  assert.doesNotMatch(fragment, /Structural review/i);
  assert.match(fragment, /<kbd>↑<\/kbd><kbd>↓<\/kbd> Navigate/);
  assert.match(fragment, /<kbd>←<\/kbd> Collapse/);
  assert.match(fragment, /<kbd>→<\/kbd> Expand/);
  assert.match(fragment, /<kbd>↵<\/kbd> Annotate/);
  assert.match(fragment, /<kbd>R-click<\/kbd> Annotate/);
  assert.doesNotMatch(fragment, /<h1>Functions outline<\/h1>/);
  assert.match(fragment, /<div class="fr-tree-wrap">/);
  assert.match(fragment, /--fr-bg: #0e1014/);
  assert.match(fragment, /background: linear-gradient\(180deg, var\(--fr-header-1\), var\(--fr-header-2\)\)/);
  assert.match(fragment, /border-top: 2px solid var\(--fr-group-color\)/);
  assert.match(fragment, /for \(const language of node\.languages\)/);
  assert.match(fragment, /className = "fr-language-tag"/);
  assert.match(fragment, /tag\.textContent = language/);
  assert.match(fragment, /for \(const kind of node\.itemKinds\)/);
  assert.match(fragment, /className = "fr-item-kind-tag"/);
  assert.match(fragment, /tag\.textContent = kind/);
  assert.match(fragment, /className = "fr-total-count"/);
  assert.match(fragment, /count\.textContent = String\(node\.finalCount\)/);
  assert.match(fragment, /className = "fr-change-additions"/);
  assert.match(fragment, /additions\.textContent = `\+\$\{node\.additions\}`/);
  assert.match(fragment, /className = "fr-change-deletions"/);
  assert.match(fragment, /deletions\.textContent = `−\$\{node\.deletions\}`/);
  assert.match(fragment, /appendTotalCount\(summary, node\)/);
  assert.match(fragment, /appendLanguageAndKindTags\(summary, node\)/);
  assert.match(fragment, /className = "fr-metadata-divider"/);
  assert.doesNotMatch(fragment, /fr-count-(?:metric|number|tag)|fr-mixed-badge|mixed contents/i);
  assert.match(fragment, /File \$\{node\.label\}, \$\{countLabel\(node\)\}, \$\{changeLabel\(node\)\}/);
  assert.match(fragment, /@media \(prefers-color-scheme: light\)/);
  assert.match(fragment, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(fragment, /(?:^|[}\s])(?:html|body|:root)\s*\{/m);
});

test("template contract rejects removal of required report controls and badges", () => {
  const brokenTemplates = [
    ["keyboard shortcut legend", template.replace("<kbd>←</kbd> Collapse", "Collapse")],
    ["copy annotations control", template.replace("data-copy-annotations", "data-copy")],
    ["prominent total count badge", template.replace('count.className = "fr-total-count"', 'count.className = "fr-count"')],
    ["addition and deletion figures", template.replace('deletions.textContent = `−${node.deletions}`', 'deletions.textContent = String(node.deletions)')],
    ["metadata divider", template.replace('divider.className = "fr-metadata-divider"', 'divider.className = "fr-divider"')],
    ["language and inventory badges", template.replace('tag.className = "fr-item-kind-tag"', 'tag.className = "fr-tag"')],
  ];

  assert.doesNotThrow(() => assertTemplateContract(template));
  for (const [requirement, brokenTemplate] of brokenTemplates) {
    assert.throws(
      () => assertTemplateContract(brokenTemplate),
      (error) =>
        error instanceof ReportOutputError && error.message.includes(requirement),
    );
  }
});

test("standalone preview wrapper declares UTF-8 before Unicode report content", () => {
  const fragment = renderReport(
    inputWith([
      {
        path: "/repo/src/report.ts",
        callables: [callable("renderReport(input)")],
      },
    ]),
    template,
  );
  const document = wrapStandaloneDocument(fragment);

  assert.match(document, /^<!doctype html>\n<html lang="en">/);
  assert.match(document, /<meta charset="utf-8">/);
  assert.ok(document.indexOf('<meta charset="utf-8">') < document.indexOf("↑"));
  assert.match(document, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(document, /<title>Functions Report — Interactive Preview<\/title>/);
  assert.match(document, /<kbd>↑<\/kbd><kbd>↓<\/kbd> Navigate/);
  assert.match(document, /deletions\.textContent = `−\$\{node\.deletions\}`/);
  assert.match(document, /<\/body>\n<\/html>\n$/);
});

test("checked-in sample preview is reproducible from template and data only", async () => {
  const sampleInput = JSON.parse(await readFile(sampleInputPath, "utf8"));
  const checkedInPreview = await readFile(samplePreviewPath, "utf8");
  const generatedPreview = wrapStandaloneDocument(renderReport(sampleInput, template));

  assert.equal(checkedInPreview, generatedPreview);
});

test("fragments at or above the byte limit are rejected", () => {
  const input = inputWith([
    {
      path: "/repo/src/large.ts",
      callables: [
        callable("large()", { description: "x".repeat(MAX_FRAGMENT_BYTES) }),
      ],
    },
  ]);

  assert.throws(
    () => renderReport(input, template),
    (error) => error instanceof ReportOutputError && /must remain below/.test(error.message),
  );
});

test("CLI help succeeds and malformed JSON exits nonzero", async () => {
  const help = spawnSync(process.execPath, [rendererPath, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/render-report\.mjs \[--standalone\]/);
  assert.match(help.stdout, /UTF-8 HTML document/);
  assert.match(help.stdout, /clickable absolute local-file link/);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "functions-report-test-"));
  try {
    const inputPath = join(temporaryDirectory, "invalid.json");
    const outputPath = join(temporaryDirectory, "output.html");
    await writeFile(inputPath, "{not-json", "utf8");
    const result = spawnSync(process.execPath, [rendererPath, inputPath, outputPath], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid JSON/);

    const validInputPath = join(temporaryDirectory, "valid.json");
    const standaloneOutputPath = join(temporaryDirectory, "standalone.html");
    await writeFile(
      validInputPath,
      JSON.stringify(inputWith([
        { path: "/repo/src/report.ts", callables: [callable("render()") ] },
      ])),
      "utf8",
    );
    const standaloneResult = spawnSync(
      process.execPath,
      [rendererPath, "--standalone", validInputPath, standaloneOutputPath],
      { encoding: "utf8" },
    );
    assert.equal(standaloneResult.status, 0, standaloneResult.stderr);
    assert.equal(
      standaloneResult.stdout,
      `Generated report: ${formatLocalFileLink(standaloneOutputPath)}\n`,
    );
    const standaloneOutput = await readFile(standaloneOutputPath, "utf8");
    assert.match(standaloneOutput, /^<!doctype html>/);
    assert.match(standaloneOutput, /<meta charset="utf-8">/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI links the exact fragment artifact and refuses the internal template", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "functions-report-artifact-test-"));
  try {
    const inputPath = join(temporaryDirectory, "input.json");
    const outputPath = join(temporaryDirectory, "generated report.html");
    await writeFile(
      inputPath,
      JSON.stringify(inputWith([
        { path: "/repo/src/report.ts", callables: [callable("render()") ] },
      ])),
      "utf8",
    );

    const result = spawnSync(process.execPath, [rendererPath, inputPath, outputPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `Generated report: [generated report.html](<${outputPath}>)\n`,
    );
    assert.equal(
      formatLocalFileLink(outputPath),
      `[generated report.html](<${outputPath}>)`,
    );
    assert.equal(
      await readFile(outputPath, "utf8"),
      renderReport(JSON.parse(await readFile(inputPath, "utf8")), template),
    );

    const templateBefore = await readFile(templatePath, "utf8");
    const templateResult = spawnSync(process.execPath, [rendererPath, inputPath, templatePath], {
      encoding: "utf8",
    });
    assert.notEqual(templateResult.status, 0);
    assert.match(templateResult.stderr, /internal report template/);
    assert.equal(await readFile(templatePath, "utf8"), templateBefore);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
