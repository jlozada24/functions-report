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
  createAnnotationBundle,
  normalizeReport,
  renderReport,
  validateReportInput,
} from "../scripts/render-report.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = dirname(testDirectory);
const templatePath = join(repositoryDirectory, "assets", "report-template.html");
const rendererPath = join(repositoryDirectory, "scripts", "render-report.mjs");
const template = await readFile(templatePath, "utf8");

function inputWith(files) {
  return { schemaVersion: 1, files };
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
        path: "/repo/src/client/request.ts",
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
      ["file", "request.ts"],
      ["file", "handler.ts"],
    ],
  );
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
    [{ schemaVersion: 1, files: [] }, /\$\.files/],
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
  assert.match(fragment, />Cancel<\/button>/);
  assert.match(fragment, />Save<\/button>/);
  assert.match(fragment, /const annotations = new Map\(\)/);
  assert.match(fragment, /"ArrowDown"/);
  assert.match(fragment, /"ArrowUp"/);
  assert.match(fragment, /"ArrowLeft"/);
  assert.match(fragment, /"ArrowRight"/);
  assert.match(fragment, /event\.key === "Enter" \|\| event\.key === "Return"/);
  assert.match(fragment, /addEventListener\("contextmenu"/);
  assert.match(fragment, /addEventListener\("dblclick"/);
  assert.match(fragment, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(fragment, /dataset\.nodeId = node\.id/);
  assert.match(fragment, /annotations\.delete\(nodeId\)/);
  assert.match(fragment, />Copy annotations<\/button>/);
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
  assert.match(fragment, /insertAdjacentElement\("afterend", form\)/);
  assert.match(fragment, /event\.key === "Escape"/);
  assert.doesNotMatch(fragment, /\btabindex\s*=/i);
  assert.doesNotMatch(
    fragment,
    /\b(?:localStorage|sessionStorage|window\.openai|sendFollowUpMessage)\b/,
  );
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
  assert.match(help.stdout, /Usage: node scripts\/render-report\.mjs/);

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
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
