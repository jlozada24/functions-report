#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FRAGMENT_BYTES = 1_000_000;

const TEMPLATE_PATH = fileURLToPath(
  new URL("../assets/report-template.html", import.meta.url),
);
const ROOT_ID_TOKEN = "%%FUNCTIONS_REPORT_ROOT_ID%%";
const MODEL_TOKEN = "%%FUNCTIONS_REPORT_MODEL_JSON%%";
const REQUIRED_TEMPLATE_CONTRACT = [
  {
    label: "keyboard shortcut legend",
    needles: [
      "<kbd>↑</kbd><kbd>↓</kbd> Navigate",
      "<kbd>←</kbd> Collapse",
      "<kbd>→</kbd> Expand",
      "<kbd>↵</kbd> Annotate",
      "<kbd>R-click</kbd> Annotate",
    ],
  },
  {
    label: "copy annotations control",
    needles: [
      "data-copy-annotations\n        aria-keyshortcuts=\"C\"",
      "<span>Copy annotations</span>",
      'root.querySelector("[data-copy-annotations]")',
    ],
  },
  {
    label: "prominent total count badge",
    needles: [
      ".fr-total-count",
      'count.className = "fr-total-count"',
      'node.kind === "folder" ? node.fileCount : node.callableCount',
    ],
  },
  {
    label: "addition and deletion figures",
    needles: [
      ".fr-change-additions",
      ".fr-change-deletions",
      'additions.textContent = `+${node.additions}`',
      'deletions.textContent = `−${node.deletions}`',
    ],
  },
  {
    label: "metadata divider",
    needles: [".fr-metadata-divider", 'divider.className = "fr-metadata-divider"'],
  },
  {
    label: "language and inventory badges",
    needles: [
      ".fr-language-tag",
      ".fr-item-kind-tag",
      'tag.className = "fr-language-tag"',
      'tag.className = "fr-item-kind-tag"',
    ],
  },
  {
    label: "new proposal badge",
    needles: [
      ".fr-new-badge",
      'badge.className = "fr-new-badge"',
      'badge.textContent = "NEW"',
      'appendNewBadge(summary, node)',
      'appendNewBadge(callableNode, node)',
    ],
  },
];
const OPTIONAL_CALLABLE_FIELDS = ["returns", "description", "uses", "updates"];
const CALLABLE_DETAIL_FIELDS = [
  ["description", "Description"],
  ["uses", "Uses"],
  ["updates", "Updates"],
];
const LANGUAGE_BY_EXTENSION = new Map([
  ["bash", "Shell"], ["c", "C"], ["cc", "C++"], ["cpp", "C++"],
  ["cs", "C#"], ["css", "CSS"], ["cjs", "JavaScript"], ["cts", "TypeScript"],
  ["fish", "Shell"], ["go", "Go"], ["h", "C"], ["hpp", "C++"],
  ["html", "HTML"], ["java", "Java"], ["js", "JavaScript"], ["jsx", "JavaScript"],
  ["kt", "Kotlin"], ["kts", "Kotlin"], ["lua", "Lua"], ["m", "Objective-C"],
  ["mjs", "JavaScript"], ["mm", "Objective-C++"], ["mts", "TypeScript"],
  ["php", "PHP"], ["py", "Python"], ["r", "R"], ["rb", "Ruby"],
  ["rs", "Rust"], ["sass", "Sass"], ["scss", "Sass"], ["sh", "Shell"],
  ["sql", "SQL"], ["swift", "Swift"], ["ts", "TypeScript"], ["tsx", "TypeScript"],
  ["vue", "Vue"], ["zsh", "Shell"],
]);

export class ReportInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportInputError";
  }
}

export class ReportOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportOutputError";
  }
}

function failInput(path, message) {
  throw new ReportInputError(`${path}: ${message}`);
}

function assertPlainObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failInput(path, "must be an object");
  }
}

function assertAllowedKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      failInput(path, `contains unsupported property ${JSON.stringify(key)}`);
    }
  }
}

function assertNonBlankString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    failInput(path, "must be a non-empty string");
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    failInput(path, "must be a non-negative integer");
  }
}

function assertNewProposal(value, path) {
  if (value !== "new") {
    failInput(path, 'must equal "new"');
  }
}

export function splitStructuralPath(value, path = "path") {
  assertNonBlankString(value, path);

  if (value.includes("\0")) {
    failInput(path, "must not contain a null character");
  }

  const trimmed = value.trim();
  if (/[\\/]$/.test(trimmed)) {
    failInput(path, "must end with a defining filename, not a separator");
  }

  const segments = trimmed
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.length === 0) {
    failInput(path, "must contain a defining filename");
  }

  return segments;
}

function isPrefixPath(prefix, candidate) {
  return (
    prefix.length < candidate.length &&
    prefix.every((segment, index) => candidate[index] === segment)
  );
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareSegments(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = compareText(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

export function validateReportInput(input) {
  assertPlainObject(input, "$");
  assertAllowedKeys(input, ["schemaVersion", "files"], "$");

  if (input.schemaVersion !== 1) {
    failInput("$.schemaVersion", "must equal 1");
  }

  if (!Array.isArray(input.files) || input.files.length === 0) {
    failInput("$.files", "must be a non-empty array");
  }

  const seenPaths = new Map();
  const structuralPaths = [];

  input.files.forEach((file, fileIndex) => {
    const filePath = `$.files[${fileIndex}]`;
    assertPlainObject(file, filePath);
    assertAllowedKeys(file, ["path", "callables", "changes", "proposal"], filePath);

    if (Object.hasOwn(file, "proposal")) {
      assertNewProposal(file.proposal, `${filePath}.proposal`);
    }

    if (Object.hasOwn(file, "changes")) {
      assertPlainObject(file.changes, `${filePath}.changes`);
      assertAllowedKeys(file.changes, ["additions", "deletions"], `${filePath}.changes`);
      assertNonNegativeInteger(file.changes.additions, `${filePath}.changes.additions`);
      assertNonNegativeInteger(file.changes.deletions, `${filePath}.changes.deletions`);
    }

    const segments = splitStructuralPath(file.path, `${filePath}.path`);
    const normalizedPath = segments.join("/");
    if (seenPaths.has(normalizedPath)) {
      failInput(
        `${filePath}.path`,
        `duplicates $.files[${seenPaths.get(normalizedPath)}].path after separator normalization`,
      );
    }
    seenPaths.set(normalizedPath, fileIndex);
    structuralPaths.push({ fileIndex, segments });

    if (!Array.isArray(file.callables) || file.callables.length === 0) {
      failInput(`${filePath}.callables`, "must be a non-empty array");
    }

    file.callables.forEach((callable, callableIndex) => {
      const callablePath = `${filePath}.callables[${callableIndex}]`;
      assertPlainObject(callable, callablePath);
      assertAllowedKeys(
        callable,
        ["signature", "proposal", ...OPTIONAL_CALLABLE_FIELDS],
        callablePath,
      );
      assertNonBlankString(callable.signature, `${callablePath}.signature`);

      if (Object.hasOwn(callable, "proposal")) {
        assertNewProposal(callable.proposal, `${callablePath}.proposal`);
      }

      for (const field of OPTIONAL_CALLABLE_FIELDS) {
        if (Object.hasOwn(callable, field)) {
          assertNonBlankString(callable[field], `${callablePath}.${field}`);
        }
      }
    });
  });

  structuralPaths.sort((left, right) =>
    compareSegments(left.segments, right.segments),
  );
  for (let index = 1; index < structuralPaths.length; index += 1) {
    const previous = structuralPaths[index - 1];
    const current = structuralPaths[index];
    if (isPrefixPath(previous.segments, current.segments)) {
      failInput(
        `$.files[${current.fileIndex}].path`,
        `treats $.files[${previous.fileIndex}].path as a directory even though it is another defining filename`,
      );
    }
  }

  return input;
}

function longestCommonPrefixLength(paths) {
  const first = paths[0];
  let prefixLength = first.length;

  for (const path of paths.slice(1)) {
    prefixLength = Math.min(prefixLength, path.length);
    let index = 0;
    while (index < prefixLength && path[index] === first[index]) {
      index += 1;
    }
    prefixLength = index;
  }

  return prefixLength;
}

function cloneCallable(callable, order) {
  const result = {
    kind: "callable",
    signature: callable.signature,
    order,
  };
  for (const field of OPTIONAL_CALLABLE_FIELDS) {
    if (Object.hasOwn(callable, field)) {
      result[field] = callable[field];
    }
  }
  if (Object.hasOwn(callable, "proposal")) result.proposal = callable.proposal;
  return result;
}

function findOrCreateGroup(children, kind, label) {
  const existing = children.find(
    (child) =>
      child.kind !== "callable" && child.kind === kind && child.label === label,
  );
  if (existing) return existing;

  const conflicting = children.find(
    (child) => child.kind !== "callable" && child.label === label,
  );
  if (conflicting) {
    throw new ReportInputError(
      `Structural node ${JSON.stringify(label)} is both a file and a folder`,
    );
  }

  const group = { kind, label, children: [] };
  children.push(group);
  return group;
}

function sortTree(children) {
  const rank = { folder: 0, file: 1, callable: 2 };
  children.sort((left, right) => {
    const kindDifference = rank[left.kind] - rank[right.kind];
    if (kindDifference !== 0) return kindDifference;
    if (left.kind === "callable") return left.order - right.order;
    return compareText(left.label, right.label);
  });

  for (const child of children) {
    if (child.kind !== "callable") sortTree(child.children);
  }
}

function digest(value, length = 20) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function countDescendantFiles(children) {
  return children.reduce((count, child) => {
    if (child.kind === "file") return count + 1;
    if (child.kind === "folder") {
      return count + countDescendantFiles(child.children);
    }
    return count;
  }, 0);
}

function sourceLanguageForFile(label) {
  const lowerLabel = label.toLowerCase();
  if (lowerLabel === "makefile") return "Make";
  const separator = lowerLabel.lastIndexOf(".");
  if (separator < 0 || separator === lowerLabel.length - 1) return "Source";
  const extension = lowerLabel.slice(separator + 1);
  return LANGUAGE_BY_EXTENSION.get(extension) ?? extension.toUpperCase();
}

function descendantLanguages(children) {
  const languages = new Set();
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === "file") languages.add(node.language);
      if (node.kind === "folder") visit(node.children);
    }
  };
  visit(children);
  return [...languages].sort(compareText);
}

function countDirectNewChildren(children, kind) {
  return children.filter(
    (child) => child.kind === kind && child.proposal === "new",
  ).length;
}

function countDescendantChanges(children) {
  return children.reduce(
    (totals, child) => {
      if (child.kind === "file") {
        totals.additions += child.changes?.additions ?? 0;
        totals.deletions += child.changes?.deletions ?? 0;
      } else if (child.kind === "folder") {
        const nested = countDescendantChanges(child.children);
        totals.additions += nested.additions;
        totals.deletions += nested.deletions;
      }
      return totals;
    },
    { additions: 0, deletions: 0 },
  );
}

function assignNodeIds(children, ancestors = [], breadcrumbParts = []) {
  const signatureCounts = new Map();

  return children.map((child) => {
    if (child.kind !== "callable") {
      const identity = [...ancestors, `${child.kind}:${child.label}`];
      const displayLabel = child.kind === "folder" ? `${child.label}/` : child.label;
      const childBreadcrumbParts = [...breadcrumbParts, displayLabel];
      const descendantChanges = child.kind === "folder"
        ? countDescendantChanges(child.children)
        : null;
      const changes = child.kind === "folder"
        ? {
            additions:
              descendantChanges.additions +
              countDirectNewChildren(child.children, "file"),
            deletions: descendantChanges.deletions,
          }
        : {
            additions:
              (child.changes?.additions ?? 0) +
              countDirectNewChildren(child.children, "callable"),
            deletions: child.changes?.deletions ?? 0,
          };
      return {
        id: `node-${digest(identity.join("\u001f"))}`,
        kind: child.kind,
        label: child.label,
        languages: child.kind === "folder"
          ? descendantLanguages(child.children)
          : [],
        itemKinds: child.kind === "folder"
          ? (child.children.some((descendant) => descendant.kind === "folder")
              ? ["Folders"]
              : [])
          : ["Functions"],
        additions: changes.additions,
        deletions: changes.deletions,
        ...(child.kind === "folder"
          ? {
              fileCount: countDescendantFiles(child.children),
            }
          : {
              callableCount: child.children.filter(
                (descendant) => descendant.kind === "callable",
              ).length,
            }),
        breadcrumb: childBreadcrumbParts.join(" › "),
        ...(child.proposal === "new" ? { proposal: "new" } : {}),
        children: assignNodeIds(child.children, identity, childBreadcrumbParts),
      };
    }

    const occurrence = signatureCounts.get(child.signature) ?? 0;
    signatureCounts.set(child.signature, occurrence + 1);
    const identity = [
      ...ancestors,
      `callable:${child.signature}`,
      `occurrence:${occurrence}`,
    ];
    const result = {
      id: `node-${digest(identity.join("\u001f"))}`,
      kind: "callable",
      signature: child.signature,
      breadcrumb: [...breadcrumbParts, child.signature].join(" › "),
    };
    for (const field of OPTIONAL_CALLABLE_FIELDS) {
      if (Object.hasOwn(child, field)) result[field] = child[field];
    }
    if (child.proposal === "new") result.proposal = "new";
    const details = CALLABLE_DETAIL_FIELDS.flatMap(([field, label]) => {
      if (!Object.hasOwn(child, field)) return [];
      return [{
        id: `node-${digest([...identity, `detail:${field}`].join("\u001f"))}`,
        kind: "detail",
        field,
        label,
        text: child[field],
        breadcrumb: [...breadcrumbParts, child.signature, label].join(" › "),
      }];
    });
    if (details.length > 0) result.details = details;
    return result;
  });
}

export function createAnnotationBundle(model, annotations) {
  if (!(annotations instanceof Map)) {
    throw new TypeError("annotations must be a Map keyed by stable node ID");
  }

  const entries = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      const annotation = annotations.get(node.id);
      if (typeof annotation === "string" && annotation.trim().length > 0) {
        entries.push({ id: node.id, breadcrumb: node.breadcrumb, annotation });
      }
      if (node.details) visit(node.details);
      if (node.children) visit(node.children);
    }
  };
  visit(model.tree);

  if (entries.length === 0) return { count: 0, text: "" };

  const lines = ["# Functions report annotations", ""];
  entries.forEach((entry, index) => {
    lines.push(`## \`${entry.breadcrumb}\``);
    lines.push("");
    lines.push(`Node ID: \`${entry.id}\``);
    lines.push("");
    lines.push(entry.annotation);
    if (index < entries.length - 1) lines.push("");
  });

  return { count: entries.length, text: lines.join("\n") };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeReport(input) {
  validateReportInput(input);

  const files = input.files
    .map((file) => ({
      segments: splitStructuralPath(file.path),
      callables: file.callables,
      changes: file.changes ?? { additions: 0, deletions: 0 },
      proposal: file.proposal,
    }))
    .sort((left, right) => compareSegments(left.segments, right.segments));
  const containsNewProposal = files.some(
    (file) =>
      file.proposal === "new" ||
      file.callables.some((callable) => callable.proposal === "new"),
  );
  const commonPrefixLength =
    files.length === 1 && containsNewProposal
      ? files[0].segments.length - 1
      : longestCommonPrefixLength(files.map((file) => file.segments));
  const tree = [];
  let callableOrder = 0;

  for (const file of files) {
    const remainingSegments = file.segments.slice(commonPrefixLength);
    let children = tree;

    remainingSegments.forEach((segment, index) => {
      const kind = index === remainingSegments.length - 1 ? "file" : "folder";
      const group = findOrCreateGroup(children, kind, segment);
      if (kind === "file") {
        group.changes = file.changes;
        group.language = sourceLanguageForFile(segment);
        group.proposal = file.proposal;
      }
      children = group.children;
    });

    for (const callable of file.callables) {
      children.push(cloneCallable(callable, callableOrder));
      callableOrder += 1;
    }
  }

  sortTree(tree);
  const treeWithIds = assignNodeIds(tree);
  const fingerprint = createHash("sha256")
    .update(canonicalJson({ schemaVersion: 1, tree: treeWithIds }))
    .digest("hex");

  return {
    schemaVersion: 1,
    fingerprint,
    rootId: `functions-report-${fingerprint.slice(0, 16)}`,
    tree: treeWithIds,
  };
}

export function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[&<>\u2028\u2029]/g, (character) => {
    const escapes = {
      "&": "\\u0026",
      "<": "\\u003c",
      ">": "\\u003e",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    };
    return escapes[character];
  });
}

function assertFragmentOnly(fragment) {
  if (/<!doctype\b|<\/?(?:html|head|body)\b/i.test(fragment)) {
    throw new ReportOutputError(
      "The report template must produce an HTML fragment without doctype, html, head, or body elements",
    );
  }
}

export function assertTemplateContract(template) {
  if (typeof template !== "string" || template.length === 0) {
    throw new ReportOutputError("The report template is empty or unreadable");
  }
  if (!template.includes(ROOT_ID_TOKEN) || !template.includes(MODEL_TOKEN)) {
    throw new ReportOutputError(
      "The report template is missing a required renderer placeholder",
    );
  }

  for (const requirement of REQUIRED_TEMPLATE_CONTRACT) {
    if (!requirement.needles.every((needle) => template.includes(needle))) {
      throw new ReportOutputError(
        `The report template is missing required UI contract: ${requirement.label}`,
      );
    }
  }
}

export function renderNormalizedReport(model, template) {
  assertTemplateContract(template);

  const embeddedModel = escapeJsonForHtml({ tree: model.tree });
  const fragment = template
    .replaceAll(ROOT_ID_TOKEN, model.rootId)
    .replaceAll(MODEL_TOKEN, embeddedModel);

  if (fragment.includes(ROOT_ID_TOKEN) || fragment.includes(MODEL_TOKEN)) {
    throw new ReportOutputError("The report template contains unresolved placeholders");
  }

  assertFragmentOnly(fragment);
  const byteLength = Buffer.byteLength(fragment, "utf8");
  if (byteLength >= MAX_FRAGMENT_BYTES) {
    throw new ReportOutputError(
      `Generated fragment is ${byteLength} bytes; it must remain below ${MAX_FRAGMENT_BYTES} bytes`,
    );
  }

  return fragment;
}

export function wrapStandaloneDocument(fragment) {
  assertFragmentOnly(fragment);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Functions Report — Interactive Preview</title>
</head>
<body>
${fragment}
</body>
</html>
`;
}

export function renderReport(input, template) {
  return renderNormalizedReport(normalizeReport(input), template);
}

function helpText() {
  return `Usage: node scripts/render-report.mjs [--standalone] <input.json> <output.html>

Render a structured functions report as a self-contained HTML fragment.

Arguments:
  input.json    JSON matching references/report-input.schema.json
  output.html   Destination for the generated HTML fragment

Options:
  --standalone  Wrap the fragment in a UTF-8 HTML document for direct browser previews
  -h, --help    Show this help message
`;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(helpText());
    return;
  }
  const unknownOptions = args.filter(
    (argument) => argument.startsWith("-") && argument !== "--standalone",
  );
  if (unknownOptions.length > 0) {
    throw new ReportInputError(
      `Unsupported option ${unknownOptions[0]}. Use --help for usage.`,
    );
  }
  const standalone = args.includes("--standalone");
  const positionalArgs = args.filter((argument) => argument !== "--standalone");
  if (positionalArgs.length !== 2) {
    throw new ReportInputError(
      "Expected <input.json> and <output.html>. Use --help for usage.",
    );
  }

  const [inputPath, outputPath] = positionalArgs;
  let input;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ReportInputError(`Invalid JSON in ${inputPath}: ${error.message}`);
    }
    throw error;
  }

  const template = await readFile(TEMPLATE_PATH, "utf8");
  const fragment = renderReport(input, template);
  const output = standalone ? wrapStandaloneDocument(fragment) : fragment;
  await writeFile(outputPath, output, "utf8");
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`render-report: ${error.message}\n`);
    process.exitCode = 1;
  });
}
