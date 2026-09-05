#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FRAGMENT_BYTES = 1_000_000;
export const REPORT_SCHEMA_VERSION = 3;

const themedColor = (dark, light) => Object.freeze({ dark, light });

// Edit this single configuration object to retheme structural roles or languages.
// Callable purple is a reserved system color and never inherits a file language.
export const REPORT_COLOR_CONFIG = Object.freeze({
  structural: Object.freeze({
    folder: themedColor("#f4f7ff", "#38445c"),
    file: themedColor("#a9c7ff", "#2857a4"),
    extension: themedColor("#00f5d4", "#007968"),
    callable: themedColor("#d05cff", "#8d00d4"),
    constant: themedColor("#ff2bd6", "#d000a8"),
    type: themedColor("#ff3155", "#a40025"),
    capability: themedColor("#ff9f0a", "#b45300"),
    macro: themedColor("#ffe600", "#8a6500"),
    detail: themedColor("#aab6cc", "#526078"),
  }),
  folderPalette: Object.freeze([
    themedColor("#8aa2c8", "#425b80"),
    themedColor("#c8957a", "#80533d"),
    themedColor("#87b39a", "#3f6b55"),
    themedColor("#b093c5", "#6b4c7d"),
    themedColor("#b6aa72", "#716423"),
    themedColor("#75aab0", "#356a70"),
    themedColor("#c68ca4", "#7c4961"),
    themedColor("#9b9fc7", "#545a8b"),
  ]),
  inventory: Object.freeze({
    functions: themedColor("#00f5ff", "#00c7df"),
  }),
  languageFallback: themedColor("#c4cee0", "#53627a"),
  languages: Object.freeze({
    "AppleScript": themedColor("#8b7cff", "#5540bd"),
    "Bash": themedColor("#a8ff3e", "#4f7d00"),
    "C": themedColor("#60a5ff", "#005fbd"),
    "C#": themedColor("#39e66e", "#00853e"),
    "C++": themedColor("#3d8bff", "#004fb5"),
    "CSS": themedColor("#ff5c9a", "#c21863"),
    "Go": themedColor("#00e5ff", "#007f9d"),
    "HTML": themedColor("#ff5b2e", "#c52d00"),
    "Java": themedColor("#ff8a00", "#b24d00"),
    "JavaScript": themedColor("#ffe600", "#8a6500"),
    "JSON": themedColor("#ffd43b", "#8a6500"),
    "Kotlin": themedColor("#ff4f87", "#c0004b"),
    "Lua": themedColor("#7c6cff", "#4736c9"),
    "Make": themedColor("#ff7043", "#b83212"),
    "Objective-C": themedColor("#00a6ff", "#0066b3"),
    "Objective-C++": themedColor("#4d7cff", "#1e4bb8"),
    "PBXPROJ": themedColor("#d878ff", "#7a28a8"),
    "PHP": themedColor("#9f8cff", "#5e45a8"),
    "Python": themedColor("#00f5d4", "#007968"),
    "PLIST": themedColor("#00dfa2", "#007458"),
    "R": themedColor("#4da3ff", "#095ca8"),
    "Ruby": themedColor("#ff476d", "#b0002d"),
    "Rust": themedColor("#ff8534", "#b34700"),
    "Sass": themedColor("#ff66b3", "#b0206d"),
    "Shell": themedColor("#b6f044", "#5e7e00"),
    "Source": themedColor("#c4cee0", "#53627a"),
    "SQL": themedColor("#00e0c0", "#007a69"),
    "Swift": themedColor("#ff5f45", "#c2250d"),
    "TypeScript": themedColor("#2f8cff", "#0064d8"),
    "Vue": themedColor("#2ee89b", "#00895a"),
    "XCCONFIG": themedColor("#80ff44", "#367f00"),
    "Zsh": themedColor("#70f0ff", "#08798a"),
  }),
});

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
    label: "top-only change summary badges",
    needles: [
      "data-change-summary",
      'root.querySelector("[data-change-summary]")',
      ".fr-change-summary",
      ".fr-summary-badge-additions",
      ".fr-summary-badge-deletions",
      "for (const change of model.changeSummary)",
      "if (change.additions !== 0)",
      "if (change.deletions !== 0)",
      "summaryTarget.hidden = model.changeSummary.length === 0",
    ],
  },
  {
    label: "prominent total count badge",
    needles: [
      ".fr-total-count",
      'count.className = "fr-total-count"',
      "node.finalCount",
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
    label: "nested callable disclosures",
    needles: [
      "const hasChildren = Boolean(node.children?.length)",
      "const hasDisclosure = hasDetails || hasChildren",
      "if (hasChildren) content.append(createList(node.children))",
      ".fr-callable-content > .fr-list",
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
    label: "deterministic structural and language colors",
    needles: [
      "--fr-file-language-color",
      "model.colors.structural.callable",
      "model.colors.structural.constant",
      "model.colors.structural.type",
      "model.colors.structural.capability",
      "model.colors.structural.macro",
      "model.colors.structural.extension",
      "model.colors.inventory.functions",
      "folderColor(node.breadcrumb, usedFolderColorIndexes)",
      "languageColor(language)",
      'item.style.setProperty("--fr-file-language-color", themedCssColor(languageColor(node.language)))',
      ".fr-constant-node",
      ".fr-type-node",
      ".fr-capability-node",
      ".fr-macro-node",
      ".fr-extension",
    ],
  },
  {
    label: "proposal status badges",
    needles: [
      ".fr-proposal-badge",
      ".fr-proposal-add",
      ".fr-proposal-remove",
      'badge.className = `fr-proposal-badge fr-proposal-${node.proposal}`',
      'badge.textContent = node.proposal === "add" ? "ADD" : "REMOVE"',
      "appendProposalBadge(summary, node);\n          summary.append(label)",
      "appendProposalBadge(callableNode, node);\n          callableNode.append(signature)",
    ],
  },
];
const OPTIONAL_CALLABLE_FIELDS = ["returns", "description", "uses", "updates"];
const OPTIONAL_DECLARATION_FIELDS = ["description"];
const CALLABLE_DETAIL_FIELDS = [
  ["description", "Description"],
  ["uses", "Uses"],
  ["updates", "Updates"],
];
const SOURCE_ITEM_KINDS = new Set([
  "callable",
  "constant",
  "type",
  "capability",
  "macro",
]);
const GROUP_KINDS = new Set(["folder", "file", "extension"]);
const SOURCE_COLLECTIONS = Object.freeze([
  ["constants", "constant", OPTIONAL_DECLARATION_FIELDS],
  ["types", "type", OPTIONAL_DECLARATION_FIELDS],
  ["capabilities", "capability", OPTIONAL_DECLARATION_FIELDS],
  ["macros", "macro", OPTIONAL_DECLARATION_FIELDS],
  ["callables", "callable", OPTIONAL_CALLABLE_FIELDS],
]);
const SOURCE_COLLECTION_NAMES = Object.freeze(
  SOURCE_COLLECTIONS.map(([collectionName]) => collectionName),
);
const ITEM_KIND_ORDER = Object.freeze([
  "Functions",
  "Constants",
  "Types",
  "Capabilities",
  "Macros",
  "Extensions",
]);
const ITEM_KIND_LABEL_BY_SOURCE_KIND = new Map([
  ["callable", "Functions"],
  ["constant", "Constants"],
  ["type", "Types"],
  ["capability", "Capabilities"],
  ["macro", "Macros"],
]);
const LANGUAGE_BY_EXTENSION = new Map([
  ["applescript", "AppleScript"], ["bash", "Bash"], ["c", "C"],
  ["cc", "C++"], ["cpp", "C++"],
  ["cs", "C#"], ["css", "CSS"], ["cjs", "JavaScript"], ["cts", "TypeScript"],
  ["entitlements", "PLIST"], ["fish", "Shell"], ["go", "Go"],
  ["h", "C"], ["hpp", "C++"],
  ["html", "HTML"], ["java", "Java"], ["js", "JavaScript"], ["jsx", "JavaScript"],
  ["json", "JSON"], ["kt", "Kotlin"], ["kts", "Kotlin"], ["lua", "Lua"],
  ["m", "Objective-C"],
  ["mjs", "JavaScript"], ["mm", "Objective-C++"], ["mts", "TypeScript"],
  ["pbxproj", "PBXPROJ"], ["php", "PHP"], ["plist", "PLIST"],
  ["py", "Python"], ["r", "R"], ["rb", "Ruby"],
  ["rs", "Rust"], ["sass", "Sass"], ["scss", "Sass"], ["sh", "Shell"],
  ["scpt", "AppleScript"], ["sql", "SQL"], ["swift", "Swift"],
  ["ts", "TypeScript"], ["tsx", "TypeScript"], ["vue", "Vue"],
  ["xcconfig", "XCCONFIG"], ["zsh", "Zsh"],
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

function escapeMarkdownLabel(value) {
  return value.replace(/[\\[\]]/g, "\\$&");
}

export function formatLocalFileLink(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new TypeError("filePath must be a non-empty string");
  }

  const absolutePath = resolve(filePath);
  return `[${escapeMarkdownLabel(basename(absolutePath))}](<${absolutePath}>)`;
}

function resolveOutputPath(outputPath) {
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    throw new ReportInputError("Output path must be a non-empty string");
  }

  const absolutePath = resolve(outputPath);
  if (absolutePath === TEMPLATE_PATH) {
    throw new ReportOutputError(
      "Refusing to overwrite the internal report template; choose a generated HTML output path",
    );
  }
  return absolutePath;
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

function assertProposal(value, path) {
  if (value !== "add" && value !== "remove") {
    failInput(path, 'must equal "add" or "remove"');
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

function validateSourceCollections(container, containerPath) {
  let sourceItemCount = 0;
  for (const [collectionName, kind, optionalFields] of SOURCE_COLLECTIONS) {
    const collection = container[collectionName];
    if (collection === undefined) continue;
    if (!Array.isArray(collection) || collection.length === 0) {
      failInput(`${containerPath}.${collectionName}`, "must be a non-empty array");
    }
    sourceItemCount += collection.length;
    collection.forEach((item, itemIndex) => {
      const itemPath = `${containerPath}.${collectionName}[${itemIndex}]`;
      assertPlainObject(item, itemPath);
      assertAllowedKeys(
        item,
        [
          "signature",
          "proposal",
          ...optionalFields,
          ...(kind === "callable" ? ["isTest", ...SOURCE_COLLECTION_NAMES] : []),
        ],
        itemPath,
      );
      assertNonBlankString(item.signature, `${itemPath}.signature`);
      if (Object.hasOwn(item, "proposal")) {
        assertProposal(item.proposal, `${itemPath}.proposal`);
      }
      for (const field of optionalFields) {
        if (Object.hasOwn(item, field)) {
          assertNonBlankString(item[field], `${itemPath}.${field}`);
        }
      }
      if (kind === "callable") {
        if (Object.hasOwn(item, "isTest") && typeof item.isTest !== "boolean") {
          failInput(`${itemPath}.isTest`, "must be a boolean");
        }
        sourceItemCount += validateSourceCollections(item, itemPath);
      }
    });
  }
  return sourceItemCount;
}

export function validateReportInput(input) {
  assertPlainObject(input, "$");
  assertAllowedKeys(input, ["schemaVersion", "files"], "$");

  if (input.schemaVersion !== REPORT_SCHEMA_VERSION) {
    failInput("$.schemaVersion", `must equal ${REPORT_SCHEMA_VERSION}`);
  }

  if (!Array.isArray(input.files) || input.files.length === 0) {
    failInput("$.files", "must be a non-empty array");
  }

  const seenPaths = new Map();
  const structuralPaths = [];

  input.files.forEach((file, fileIndex) => {
    const filePath = `$.files[${fileIndex}]`;
    assertPlainObject(file, filePath);
    assertAllowedKeys(
      file,
      [
        "path",
        "language",
        "callables",
        "constants",
        "types",
        "capabilities",
        "macros",
        "extensions",
        "proposal",
      ],
      filePath,
    );

    if (Object.hasOwn(file, "language")) {
      assertNonBlankString(file.language, `${filePath}.language`);
    }

    if (Object.hasOwn(file, "proposal")) {
      assertProposal(file.proposal, `${filePath}.proposal`);
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

    let sourceItemCount = validateSourceCollections(file, filePath);
    if (Object.hasOwn(file, "extensions")) {
      if (!Array.isArray(file.extensions) || file.extensions.length === 0) {
        failInput(`${filePath}.extensions`, "must be a non-empty array");
      }
      file.extensions.forEach((extension, extensionIndex) => {
        const extensionPath = `${filePath}.extensions[${extensionIndex}]`;
        assertPlainObject(extension, extensionPath);
        assertAllowedKeys(
          extension,
          [
            "signature",
            "proposal",
            ...SOURCE_COLLECTIONS.map(([collectionName]) => collectionName),
          ],
          extensionPath,
        );
        assertNonBlankString(extension.signature, `${extensionPath}.signature`);
        if (Object.hasOwn(extension, "proposal")) {
          assertProposal(extension.proposal, `${extensionPath}.proposal`);
        }
        const extensionItemCount = validateSourceCollections(extension, extensionPath);
        if (extensionItemCount === 0) {
          failInput(extensionPath, "must contain at least one source item");
        }
        sourceItemCount += extensionItemCount;
      });
    }
    if (sourceItemCount === 0) {
      failInput(filePath, "must contain at least one source item");
    }
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

function cloneSourceItem(item, kind, order) {
  const result = {
    kind,
    signature: item.signature,
    order,
  };
  for (const field of OPTIONAL_CALLABLE_FIELDS) {
    if (Object.hasOwn(item, field)) {
      result[field] = item[field];
    }
  }
  if (Object.hasOwn(item, "proposal")) result.proposal = item.proposal;
  if (kind === "callable" && Object.hasOwn(item, "isTest")) result.isTest = item.isTest;
  if (kind === "callable") result.children = [];
  return result;
}

function findOrCreateGroup(children, kind, label) {
  const existing = children.find(
    (child) => child.kind === kind && child.label === label,
  );
  if (existing) return existing;

  const conflicting = children.find(
    (child) =>
      (child.kind === "folder" || child.kind === "file") && child.label === label,
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
  const rank = {
    folder: 0,
    file: 1,
    extension: 2,
    constant: 3,
    type: 4,
    capability: 5,
    macro: 6,
    callable: 7,
  };
  children.sort((left, right) => {
    const kindDifference = rank[left.kind] - rank[right.kind];
    if (kindDifference !== 0) return kindDifference;
    if (SOURCE_ITEM_KINDS.has(left.kind)) return left.order - right.order;
    if (left.kind === "extension") return left.order - right.order;
    return compareText(left.label, right.label);
  });

  for (const child of children) {
    if (Array.isArray(child.children)) sortTree(child.children);
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

function countInventoryDescendantFiles(children) {
  return children.reduce((count, child) => {
    if (child.kind === "file") {
      return count + (child.proposal === "remove" ? 0 : 1);
    }
    if (child.kind === "folder") {
      return count + countInventoryDescendantFiles(child.children);
    }
    return count;
  }, 0);
}

function countInventorySourceItems(children) {
  return children.reduce((count, child) => {
    if (SOURCE_ITEM_KINDS.has(child.kind)) {
      const ownCount = child.proposal === "remove" ? 0 : 1;
      const nestedCount = Array.isArray(child.children)
        ? countInventorySourceItems(child.children)
        : 0;
      return count + ownCount + nestedCount;
    }
    if (child.kind === "extension") {
      return count + countInventorySourceItems(child.children);
    }
    return count;
  }, 0);
}

function countSourceItems(children, kind = null) {
  return children.reduce((count, child) => {
    if (SOURCE_ITEM_KINDS.has(child.kind)) {
      const ownCount = kind === null || child.kind === kind ? 1 : 0;
      const nestedCount = Array.isArray(child.children)
        ? countSourceItems(child.children, kind)
        : 0;
      return count + ownCount + nestedCount;
    }
    if (child.kind === "extension") {
      return count + countSourceItems(child.children, kind);
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

function countDirectProposalChildren(children, kind, proposal) {
  return children.filter(
    (child) =>
      (kind === "source-item" ? SOURCE_ITEM_KINDS.has(child.kind) : child.kind === kind) &&
      child.proposal === proposal,
  ).length;
}

function sourceItemKinds(children, includeNestedContainers = false) {
  const kinds = new Set();
  const visit = (nodes) => {
    for (const child of nodes) {
      if (child.kind === "callable") kinds.add("Functions");
      if (child.kind === "constant") kinds.add("Constants");
      if (child.kind === "type") kinds.add("Types");
      if (child.kind === "capability") kinds.add("Capabilities");
      if (child.kind === "macro") kinds.add("Macros");
      if (child.kind === "extension") {
        kinds.add("Extensions");
      }
      if (includeNestedContainers && Array.isArray(child.children)) {
        visit(child.children);
      }
    }
  };
  visit(children);
  return ITEM_KIND_ORDER.filter((kind) => kinds.has(kind));
}

function incrementChange(changesByLabel, label, proposal) {
  if (proposal !== "add" && proposal !== "remove") return;
  const changes = changesByLabel.get(label) ?? { additions: 0, deletions: 0 };
  if (proposal === "add") changes.additions += 1;
  if (proposal === "remove") changes.deletions += 1;
  changesByLabel.set(label, changes);
}

function folderProposal(node) {
  const proposals = [];
  const visit = (children) => {
    for (const child of children) {
      if (child.kind === "file") proposals.push(child.proposal);
      if (child.kind === "folder") visit(child.children);
    }
  };
  visit(node.children);
  if (proposals.length === 0) return null;
  if (proposals.every((proposal) => proposal === "add")) return "add";
  if (proposals.every((proposal) => proposal === "remove")) return "remove";
  return null;
}

function buildChangeSummary(tree) {
  const folderChanges = { additions: 0, deletions: 0 };
  const languageChanges = new Map();
  const itemKindChanges = new Map();

  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        const proposal = folderProposal(node);
        if (proposal === "add") folderChanges.additions += 1;
        if (proposal === "remove") folderChanges.deletions += 1;
        visit(node.children);
        continue;
      }
      if (node.kind === "file") {
        incrementChange(languageChanges, node.language, node.proposal);
        visit(node.children);
        continue;
      }
      if (node.kind === "extension") {
        incrementChange(itemKindChanges, "Extensions", node.proposal);
        visit(node.children);
        continue;
      }
      const label = node.kind === "callable" && node.isTest === true
        ? "Tests"
        : ITEM_KIND_LABEL_BY_SOURCE_KIND.get(node.kind);
      if (label) incrementChange(itemKindChanges, label, node.proposal);
      if (node.children) visit(node.children);
    }
  };
  visit(tree);

  const summary = [];
  if (folderChanges.additions !== 0 || folderChanges.deletions !== 0) {
    summary.push({ kind: "folders", label: "Folders", ...folderChanges });
  }
  for (const label of [...languageChanges.keys()].sort(compareText)) {
    summary.push({ kind: "language", label, ...languageChanges.get(label) });
  }
  for (const label of ITEM_KIND_ORDER) {
    const changes = itemKindChanges.get(label);
    if (changes) summary.push({ kind: "item-kind", label, ...changes });
    if (label === "Functions") {
      const testChanges = itemKindChanges.get("Tests");
      if (testChanges) summary.push({ kind: "item-kind", label: "Tests", ...testChanges });
    }
  }
  return summary;
}

function assignNodeIds(children, ancestors = [], breadcrumbParts = []) {
  const signatureCounts = new Map();
  const extensionCounts = new Map();

  return children.map((child) => {
    if (GROUP_KINDS.has(child.kind)) {
      const extensionOccurrence = child.kind === "extension"
        ? extensionCounts.get(child.label) ?? 0
        : null;
      if (child.kind === "extension") {
        extensionCounts.set(child.label, extensionOccurrence + 1);
      }
      const identity = [
        ...ancestors,
        `${child.kind}:${child.label}`,
        ...(extensionOccurrence === null ? [] : [`occurrence:${extensionOccurrence}`]),
      ];
      const displayLabel = child.kind === "folder" ? `${child.label}/` : child.label;
      const childBreadcrumbParts = [...breadcrumbParts, displayLabel];
      const changes = child.kind === "folder"
        ? {
            additions: countDirectProposalChildren(child.children, "file", "add"),
            deletions: countDirectProposalChildren(child.children, "file", "remove"),
          }
        : child.kind === "file"
          ? {
              additions:
                countDirectProposalChildren(child.children, "source-item", "add") +
                countDirectProposalChildren(child.children, "extension", "add"),
              deletions:
                countDirectProposalChildren(child.children, "source-item", "remove") +
                countDirectProposalChildren(child.children, "extension", "remove"),
            }
          : {
              additions: countDirectProposalChildren(
                child.children,
                "source-item",
                "add",
              ),
              deletions: countDirectProposalChildren(
                child.children,
                "source-item",
                "remove",
               ),
             };
      const finalCount = child.kind === "folder"
        ? countInventoryDescendantFiles(child.children)
        : countInventorySourceItems(child.children);
      return {
        id: `node-${digest(identity.join("\u001f"))}`,
        kind: child.kind,
        label: child.label,
        ...(child.kind === "file" ? { language: child.language } : {}),
        languages: child.kind === "folder"
          ? descendantLanguages(child.children)
          : [],
        itemKinds: child.kind === "folder"
          ? (child.children.some((descendant) => descendant.kind === "folder")
              ? ["Folders"]
              : [])
          : sourceItemKinds(child.children, child.kind === "file"),
        additions: changes.additions,
        deletions: changes.deletions,
        finalCount,
        ...(child.kind === "folder"
          ? {
              fileCount: countDescendantFiles(child.children),
            }
          : {
              callableCount: countSourceItems(child.children, "callable"),
              itemCount: countSourceItems(child.children),
            }),
        breadcrumb: childBreadcrumbParts.join(" › "),
        ...(child.proposal ? { proposal: child.proposal } : {}),
        children: assignNodeIds(child.children, identity, childBreadcrumbParts),
      };
    }

    const signatureKey = `${child.kind}:${child.signature}`;
    const occurrence = signatureCounts.get(signatureKey) ?? 0;
    signatureCounts.set(signatureKey, occurrence + 1);
    const identity = [
      ...ancestors,
      `${child.kind}:${child.signature}`,
      `occurrence:${occurrence}`,
    ];
    const childBreadcrumbParts = [...breadcrumbParts, child.signature];
    const result = {
      id: `node-${digest(identity.join("\u001f"))}`,
      kind: child.kind,
      signature: child.signature,
      breadcrumb: childBreadcrumbParts.join(" › "),
    };
    for (const field of OPTIONAL_CALLABLE_FIELDS) {
      if (Object.hasOwn(child, field)) result[field] = child[field];
    }
    if (child.proposal) result.proposal = child.proposal;
    if (child.kind === "callable" && Object.hasOwn(child, "isTest")) result.isTest = child.isTest;
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
    if (Array.isArray(child.children) && child.children.length > 0) {
      result.additions = countDirectProposalChildren(
        child.children,
        "source-item",
        "add",
      );
      result.deletions = countDirectProposalChildren(
        child.children,
        "source-item",
        "remove",
      );
      result.finalCount = countInventorySourceItems(child.children);
      result.callableCount = countSourceItems(child.children, "callable");
      result.itemCount = countSourceItems(child.children);
      result.itemKinds = sourceItemKinds(child.children);
      result.languages = [];
      result.children = assignNodeIds(child.children, identity, childBreadcrumbParts);
    }
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
      language: file.language,
      ...Object.fromEntries(
        SOURCE_COLLECTIONS.map(([collectionName]) => [
          collectionName,
          file[collectionName] ?? [],
        ]),
      ),
      extensions: (file.extensions ?? []).map((extension) => ({
        signature: extension.signature,
        proposal: extension.proposal,
        ...Object.fromEntries(
          SOURCE_COLLECTIONS.map(([collectionName]) => [
            collectionName,
            extension[collectionName] ?? [],
          ]),
        ),
      })),
      proposal: file.proposal,
    }))
    .sort((left, right) => compareSegments(left.segments, right.segments));
  const sourceItemHasProposal = (item) =>
    Boolean(item.proposal) ||
    SOURCE_COLLECTIONS.some(([collectionName]) =>
      (item[collectionName] ?? []).some(sourceItemHasProposal),
    );
  const containerHasProposal = (container) =>
    SOURCE_COLLECTIONS.some(([collectionName]) =>
      (container[collectionName] ?? []).some(sourceItemHasProposal),
    );
  const containsProposal = files.some(
    (file) =>
      Boolean(file.proposal) ||
      containerHasProposal(file) ||
      file.extensions.some(
        (extension) => Boolean(extension.proposal) || containerHasProposal(extension),
      ),
  );
  const commonPrefixLength =
    files.length === 1 && containsProposal
      ? files[0].segments.length - 1
      : longestCommonPrefixLength(files.map((file) => file.segments));
  const tree = [];
  let sourceItemOrder = 0;
  let extensionOrder = 0;

  const appendSourceCollections = (container, destination) => {
    for (const [collectionName, kind] of SOURCE_COLLECTIONS) {
      for (const item of container[collectionName] ?? []) {
        const clonedItem = cloneSourceItem(item, kind, sourceItemOrder);
        sourceItemOrder += 1;
        if (kind === "callable") {
          appendSourceCollections(item, clonedItem.children);
        }
        destination.push(clonedItem);
      }
    }
  };

  for (const file of files) {
    const remainingSegments = file.segments.slice(commonPrefixLength);
    let children = tree;

    remainingSegments.forEach((segment, index) => {
      const kind = index === remainingSegments.length - 1 ? "file" : "folder";
      const group = findOrCreateGroup(children, kind, segment);
      if (kind === "file") {
        group.language = file.language ?? sourceLanguageForFile(segment);
        group.proposal = file.proposal;
      }
      children = group.children;
    });

    appendSourceCollections(file, children);
    for (const extension of file.extensions) {
      const extensionGroup = {
        kind: "extension",
        label: extension.signature,
        order: extensionOrder,
        children: [],
        ...(extension.proposal ? { proposal: extension.proposal } : {}),
      };
      extensionOrder += 1;
      appendSourceCollections(extension, extensionGroup.children);
      children.push(extensionGroup);
    }
  }

  sortTree(tree);
  const treeWithIds = assignNodeIds(tree);
  const changeSummary = buildChangeSummary(treeWithIds);
  const fingerprint = createHash("sha256")
    .update(canonicalJson({
      schemaVersion: REPORT_SCHEMA_VERSION,
      tree: treeWithIds,
      changeSummary,
    }))
    .digest("hex");

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    fingerprint,
    rootId: `functions-report-${fingerprint.slice(0, 16)}`,
    changeSummary,
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

  const embeddedModel = escapeJsonForHtml({
    changeSummary: model.changeSummary,
    tree: model.tree,
    colors: REPORT_COLOR_CONFIG,
  });
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
  <style>
    :root {
      color-scheme: light dark;
      background: #0e1014;
    }

    body {
      min-block-size: calc(100vh - 16px);
      margin: 8px;
      background: inherit;
    }

    @media (prefers-color-scheme: light) {
      :root {
        background: #ffffff;
      }
    }
  </style>
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

On success, prints a clickable absolute local-file link to the exact generated artifact.

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
  const resolvedOutputPath = resolveOutputPath(outputPath);
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
  await writeFile(resolvedOutputPath, output, "utf8");
  process.stdout.write(`Generated report: ${formatLocalFileLink(resolvedOutputPath)}\n`);
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
