#!/usr/bin/env node
// terminal/scripts/check_plain_language.mjs
//
// Plain-language guard for the Terminal: forward-only check that raw state
// enums, internal study/organ slugs, and untranslated statistic tokens do not
// reach a user-visible position.
//
// Direct port of the macro precedent `scripts/check_design_system.py`
// (--mode enforce-added forward-only mechanic, ANNOTATION_CAP, disclosed
// fail-open/fail-closed semantics) in the sibling Macro Dashboard repo's
// `scripts/` directory.
// Packet B-PL-5.
//
// Node 20 ESM. Uses the repo's existing `typescript` devDependency
// (terminal/package.json) for AST-based user-visible-position detection —
// see isUserVisiblePosition below; no other npm dependency is added.
//
// Scanning model (full census, forward-only blocking — same shape as the
// macro precedent): every file under SCAN_GLOBS/EXTRA_FILES is scanned on
// every run, regardless of whether the diff touches it. A finding on a line
// the diff marks as ADDED is `blocking`; the same finding on a pre-existing
// line is reported as `legacy` and never fails the run. This is what lets an
// untouched file's pre-existing violation surface (visibility) without
// retroactively blocking code nobody in this PR wrote.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ANNOTATION_CAP = 10;

export const PLAIN_VOCABULARY = {
  stateEnums: {
    BOTTOM_WATCH: ["Watching for a bottom", "关注筑底"],
    CATALYST_WINDOW: ["Catalyst window open", "催化剂窗口"],
    QUIET_ACCUMULATION: ["Quiet accumulation", "悄然吸筹"],
    REPEAT_HITTER: ["Repeat buyer", "重复买家"],
    SIZE_VS_OI: ["Large vs open interest", "大单对比未平仓"],
    MULTI_LEG: ["Multi-leg trade", "多腿交易"],
    DELAYED_15M: ["15-minute delayed", "延迟15分钟"],
  },
  studySlugs: [
    "trust_tier", "event-edge", "msc_regime", "mscRegime", "flowScore", "gexdesk",
    "prophet", "oracle", "conductor", "synapse", "lobe", "tripwire", "falsifier",
    "quiet_accumulation", "bottom_watch",
  ],
  slugFields: [
    "state", "regime", "status", "tier", "slug", "code", "kind", "category", "type",
    "bucket", "classification", "verdict", "urgency",
  ],
  statTokens: [
    "iv_rank", "ivr", "gex", "dex", "vanna", "charm", "dte", "oi", "pcr", "rv30", "hv20",
    "atr14", "zscore", "z_score", "pctl", "yoy", "qoq", "ttm", "cagr",
  ],
  // Names of helper calls / lookups that mean "this line already routes its
  // text through the plain-language layer". Consumers must match these as
  // whole call names (`\bNAME\(`), never as a bare substring — a substring
  // match on e.g. "t(" also matches `sort(`, `useEffect(`, `.at(`, `count(`.
  plainHelpers: [
    "trustTierLabel(", "regimeLabel(", "planTierLabel(", "classicCategoryLabel(",
    "macroChipLabel(", "mappedOrNeutral(", "notClassified(", "t(", "tPlain(", "pick(", "LEX[",
  ],
  allowTokens: ["RSI", "MACD", "ETF", "NAV", "AI", "API", "USD", "HKD", "CNY"],
};

const SCAN_GLOBS = ["terminal/app", "terminal/components"];
const EXTRA_FILES = ["terminal/lib/i18n.tsx"];
// terminal/app/dev/** is a self-described "Production-gated" developer
// harness (settings/theater debug pages) — no real user ever sees its
// copy, so it is excluded the same way tests/e2e/scripts are: a future PR
// touching those files must not block on copy nobody ships.
const EXCLUDE_RE = /(__tests__|\.test\.|\/e2e\/|\.d\.ts$|terminal\/scripts\/|terminal\/app\/dev\/)/;

// Attribute names whose string-literal value is a genuine user-visible
// position (title text / accessible name / placeholder copy / alt text).
// Deliberately NOT the old regex's broader list (label/sublabel/caption/
// heading/tooltip/emptyText/children/`>...<`) — the ruling scopes this to
// exactly these four attributes plus JsxText/JSX-child string literals plus
// bilingual copy dictionaries; a bare style/data attribute holding an
// UPPER_SNAKE identifier (e.g. `style={LEGEND_ITEM}`) is source code, not
// visible text, and must never count.
const VISIBLE_ATTR_NAMES = new Set(["title", "aria-label", "placeholder", "alt"]);

function findRepoRoot() {
  // repo root resolved from import.meta.url: terminal/scripts/<this file> -> repo root is two up.
  return join(HERE, "..", "..");
}

// terminal/lib/plainLabels.ts (packet #519) is an OPTIONAL, forward-compatible
// vocabulary overlay: if/when it lands on this tree, its exported label maps
// and helper function names are harvested and merged into the terms the
// guard treats as "already routed". Until #519 merges, `existsSync` below is
// false, `overlay.present` is false, and every declared term lives in
// PLAIN_VOCABULARY alone — that is the single declared source acceptance (2)
// requires, with or without the overlay.
function loadOverlay(root) {
  const p = join(root, "terminal/lib/plainLabels.ts");
  const result = { present: false, terms: [] };
  if (!existsSync(p)) return result;
  try {
    const text = readFileSync(p, "utf8");
    result.present = true;
    const helperNames = [];
    const constRe = /export\s+const\s+(TRUST_TIER_LABEL|CLASSIC_INDICATOR_CATEGORIES|PLAN_TIER_TKEY)\b[^{]*\{([\s\S]*?)\n\}/g;
    let m;
    while ((m = constRe.exec(text))) {
      const body = m[2];
      const keyRe = /^\s*["']?([A-Za-z0-9_]+)["']?\s*:/gm;
      let km;
      while ((km = keyRe.exec(body))) helperNames.push(km[1]);
    }
    const fnRe = /export\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
    while ((m = fnRe.exec(text))) helperNames.push(`${m[1]}(`);
    result.terms = helperNames;
  } catch {
    // unreadable overlay is treated as absent, never a hard failure — it is optional.
    result.present = false;
  }
  return result;
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// The ruling's copy-dictionary category is scoped by path as `lib/**/*copy*.ts`
// (note: `.ts`, not `.tsx` — the SCAN_GLOBS walk() above only ever pushes
// `.tsx` files, so a plain `.ts` copy-dict file under `terminal/lib/` was
// never opened at all: `isCopyDictFile`'s own path regex could never match
// a scanned file (PR #530 review BLOCKER 2, measured: a `terminal/lib/
// marketCopy.ts` fixture produced zero findings). This walks `terminal/lib`
// recursively (both `.ts` and `.tsx`) and keeps only files whose basename
// contains "copy" — the same walk-then-filter shape as SCAN_GLOBS, scoped
// to the one path pattern the ruling names.
function walkAnyTs(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walkAnyTs(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

function listLibCopyFiles(root) {
  const all = [];
  walkAnyTs(join(root, "terminal/lib"), all);
  return all.filter((p) => /copy/i.test(relative(root, p).split(/[\\/]/).pop()));
}

function listScanFiles(root) {
  const files = [];
  for (const g of SCAN_GLOBS) walk(join(root, g), files);
  for (const f of EXTRA_FILES) {
    const p = join(root, f);
    if (existsSync(p)) files.push(p);
  }
  for (const p of listLibCopyFiles(root)) {
    if (!files.includes(p)) files.push(p);
  }
  return files.filter((f) => !EXCLUDE_RE.test(f.replace(/\\/g, "/")));
}

// Parse unified diff `@@` hunks into { path -> Set(addedLineNo) }.
function parseAddedLineNumbers(diffText) {
  const addedLines = new Map();
  let curPath = null;
  let newLineNo = null;
  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      let p = line.slice(4).trim();
      if (p === "/dev/null") { curPath = null; continue; }
      if (p.startsWith("b/")) p = p.slice(2);
      curPath = p;
      if (!addedLines.has(curPath)) addedLines.set(curPath, new Set());
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) newLineNo = parseInt(m[1], 10);
      continue;
    }
    if (curPath == null || newLineNo == null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.get(curPath).add(newLineNo);
      newLineNo += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // removed line: does not consume a new-line number
    } else {
      newLineNo += 1;
    }
  }
  return addedLines;
}

// Finds the "bilingual copy dictionary" regions of a file, per the ruling:
// a file counts when either its path matches lib/**/*copy*.ts(x) (in which
// case the WHOLE file is one region) or it has a top-level exported
// declaration whose name ends in `_COPY` (in which case only THAT
// declaration's initializer is a region — not the rest of the file).
// Scoping to the declaration's own initializer (rather than a file-wide
// boolean) is what stops an unrelated string elsewhere in the same file
// (an import specifier, an unrelated helper's argument) from being swept
// in just because the file also happens to export a `*_COPY` const
// (PR #530 review BLOCKER 1).
function findCopyRegions(relPath, sourceFile) {
  const norm = relPath.replace(/\\/g, "/");
  const wholeFile = /(^|\/)lib\/.*copy.*\.tsx?$/i.test(norm);
  const ranges = [];
  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && /_COPY$/.test(decl.name.text) && decl.initializer) {
            ranges.push({ start: decl.initializer.getStart(sourceFile), end: decl.initializer.getEnd() });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { wholeFile, ranges };
}

// A string-literal node counts as a copy-dict VALUE (never a KEY, an import/
// export module specifier, or anything else) when it falls inside a
// qualifying region (see findCopyRegions) — the ruling's own wording is
// "string values", which is not "every string literal in the file"
// (PR #530 review BLOCKER 1, measured: a quoted object-literal KEY like
// `"BOTTOM_WATCH": "..."` and an unrelated import specifier were both being
// treated as visible before this fix).
function isCopyDictValueNode(node, copyInfo, sourceFile) {
  const parent = node.parent;
  if (
    parent &&
    (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) &&
    parent.name === node
  ) {
    return false; // this string literal IS the property key, not its value
  }
  if (
    parent &&
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  ) {
    return false; // module specifier string ("./foo"), not display copy
  }
  if (copyInfo.wholeFile) return true;
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  return copyInfo.ranges.some((r) => start >= r.start && end <= r.end);
}

// isUserVisiblePosition (AST-based): the set of AST node kinds treated as a
// genuine user-visible position, per the binding round-2 ruling on Terminal
// #530 — EVERY rule (R1-R5) decides visibility from this SAME span set:
//   - JsxText nodes (non-whitespace)
//   - string literals that are JSX children, INCLUDING when nested inside a
//     conditional (`cond ? "A" : "B"`) or logical `&&`/`||` JsxExpression —
//     see collectStringLeaves below. A literal behind a ternary/logical has
//     its own AST `.parent` set to the ConditionalExpression/BinaryExpression,
//     never the JsxExpression itself, so a direct-parent-only check (the
//     round-1 shape) can never see it; collectStringLeaves recurses through
//     that wrapping to find the literal leaves that are actually rendered.
//   - string literals that are `{...}` expression VALUES (or the bare
//     literal form) of a title/aria-label/placeholder/alt JSX attribute,
//     including the same ternary/logical nesting
//   - string literal VALUES inside a bilingual copy dictionary file/region
//     (findCopyRegions/isCopyDictValueNode above — never a property KEY,
//     never an import/export module specifier)
// Each span carries `kind`: "jsxtext" or "literal" for the text-bearing
// spans above (what R1/R2/R4/R5b scan for actual rendered-text content), or
// "expr" for the outer range of ANY JSX-child/visible-attribute expression
// regardless of its inner node type (property access, call, ternary,
// whatever) — this is what lets R3 (which targets a bare property-access
// interpolation like `{row.regime}`, never a string literal) decide
// visibility from this SAME span set rather than from a rawLine regex,
// while R1/R2/R4/R5b — which only care about literal displayed TEXT — are
// scoped to filter to the text-kind spans alone (see textSpans in
// scanLines), so a property/identifier name inside an "expr" span (e.g.
// `trade.dte`) can never be mistaken for rendered text.
// A bare identifier used as a style/prop value (`style={LEGEND_ITEM}`), a
// string literal passed as an i18n KEY (`t("marketCalm")` — a lookup key,
// not display text), a comparison or arrow function in ordinary code
// (`=>`, `<=`), or any expression outside a qualifying JSX/attribute
// position (e.g. a template string inside a `throw new Error(...)`) is
// walked by the AST but never produces a span of any kind. This replaces
// the old `>[^<>]*<` substring heuristic entirely — no rule below tests
// rawLine with a regex to decide visibility.
function computeVisibleSpans(sourceFile, relPath) {
  const spans = [];
  const copyInfo = findCopyRegions(relPath, sourceFile);
  const isStringy = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const addTextSpan = (node, kind) => spans.push({ start: node.getStart(sourceFile), end: node.getEnd(), kind });
  const addExprSpan = (node) => spans.push({ start: node.getStart(sourceFile), end: node.getEnd(), kind: "expr" });

  // Recurse through ConditionalExpression (both branches are potentially the
  // rendered value), LogicalExpression (`&&`: only the RIGHT operand can be
  // rendered — the left is the non-rendered guard; `||`: either operand
  // could be rendered), and ParenthesizedExpression wrapping, collecting
  // every string-literal LEAF reachable this way. Anything else (a bare
  // identifier, a property access, a call, a JSX element) is not a string
  // leaf and is simply not pushed here — it may still be visited elsewhere
  // by the ordinary recursive walk (e.g. a nested JsxElement's own JsxText).
  const collectStringLeaves = (node, out) => {
    if (!node) return;
    if (ts.isConditionalExpression(node)) {
      collectStringLeaves(node.whenTrue, out);
      collectStringLeaves(node.whenFalse, out);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectStringLeaves(node.right, out); // left is the guard, never rendered
        return;
      }
      if (op === ts.SyntaxKind.BarBarToken) {
        collectStringLeaves(node.left, out);
        collectStringLeaves(node.right, out);
        return;
      }
      return; // any other binary op (e.g. `+` concatenation): not a simple literal passthrough
    }
    if (ts.isParenthesizedExpression(node)) {
      collectStringLeaves(node.expression, out);
      return;
    }
    if (isStringy(node)) out.push(node);
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      if (node.text.trim().length > 0) addTextSpan(node, "jsxtext");
    } else if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      let qualifies = false;
      if (parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent))) {
        qualifies = true; // `{...}` as a direct JSX child
      } else if (parent && ts.isJsxAttribute(parent)) {
        const attrName = parent.name.getText(sourceFile).toLowerCase();
        qualifies = VISIBLE_ATTR_NAMES.has(attrName); // `attr={...}`
      }
      if (qualifies) {
        addExprSpan(node);
        const leaves = [];
        collectStringLeaves(node.expression, leaves);
        for (const leaf of leaves) addTextSpan(leaf, "literal");
      }
    } else if (isStringy(node)) {
      const parent = node.parent;
      if (parent && ts.isJsxAttribute(parent)) {
        const attrName = parent.name.getText(sourceFile).toLowerCase();
        if (VISIBLE_ATTR_NAMES.has(attrName)) addTextSpan(node, "literal"); // bare `attr="..."`
      } else if (isCopyDictValueNode(node, copyInfo, sourceFile)) {
        addTextSpan(node, "literal"); // a genuine copy-dict VALUE — never a key or import specifier
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return spans;
}

// Line-level visibility check. NOT used by R3 (raw_slug_interpolation) —
// per the binding round-3 ruling, R3 tests span-RANGE containment on its
// own interpolation match (see the R3 loop in scanLines), because a
// line-level test is exactly the shape that wrongly fired on an unrelated
// visible span sharing the physical line. The only remaining caller is the
// `visibleAddedCount` heuristic below, which decides whether an added line
// had ANY user-visible content at all (used to gate the "not evaluable"
// null) — coarser than any individual rule's own precision, and
// deliberately so: it never decides whether a specific finding fires. A
// line "is visible" iff at least one AST-derived span (text OR expr — the
// full set from computeVisibleSpans) overlaps its character range.
// Strictly AST-driven, never a rawLine regex: no more `>...<` substring
// matching, so `=>`/`<=` and bare identifiers on an otherwise-JSX line no
// longer flip this true on their own.
function lineIsVisible(spans, sourceFile, lineNo) {
  const lineStarts = sourceFile.getLineStarts();
  const idx = lineNo - 1;
  if (idx < 0 || idx >= lineStarts.length) return false;
  const start = lineStarts[idx];
  const end = idx + 1 < lineStarts.length ? lineStarts[idx + 1] : sourceFile.end;
  return spans.some((s) => s.start < end && s.end > start);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A "plain helper on this line" match must be a whole call/lookup name, never
// a bare substring — `line.includes("t(")` also matches `.sort(`, `.at(`,
// `useEffect(`, `format(`, `count(`, defeating R3/R5b on any line that
// happens to contain those. Every helper ending in "(" is matched as
// `\bNAME\(`; a helper like "LEX[" (no trailing paren) is matched literally.
function hasPlainHelperOnLine(line, overlayTerms) {
  const all = [...PLAIN_VOCABULARY.plainHelpers, ...overlayTerms];
  return all.some((h) => {
    if (h.endsWith("(")) {
      const name = h.slice(0, -1);
      return new RegExp(`\\b${escapeRegExp(name)}\\(`).test(line);
    }
    if (h.endsWith("[")) {
      const name = h.slice(0, -1);
      return new RegExp(`\\b${escapeRegExp(name)}\\[`).test(line);
    }
    // Bare identifier harvested from the #519 overlay (e.g. a label-map KEY
    // like "pro"/"technical"): must match as a WHOLE WORD, never a
    // substring -- line.includes("pro") also matches "profile-card",
    // silently suppressing R3/R4 on any line containing that substring.
    // MEASURED on terminal/components/Probe.tsx: with the overlay present,
    // {row.regime} inside a profile-card div stopped being flagged.
    return new RegExp(`\\b${escapeRegExp(h)}\\b`).test(line);
  });
}

function suggestionForEnum(token) {
  const pair = PLAIN_VOCABULARY.stateEnums[token];
  if (pair) {
    return `say "${pair[0]}" / "${pair[1]}" (route via regimeLabel(t, value, lang) from @/lib/plainLabels)`;
  }
  return `<no plain phrase declared for ${token} — add one to PLAIN_VOCABULARY.stateEnums, or route through lib/plainLabels.ts>`;
}

function parseWaiver(line) {
  const m = /\/\/\s*plain-language-ok:\s*(.+)\s*$/.exec(line);
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length > 0 ? reason : null;
}

// Real rule bodies, operating on in-memory text — shared by scanFile (reads
// from disk) and runSelfCheck (feeds a fixture string directly, so the
// self-check exercises the same code path CI runs, not a re-typed proxy).
function scanLines(relPath, text, addedLines, overlayTerms) {
  const lines = text.split("\n");
  const added = addedLines.get(relPath) || new Set();
  const findings = [];
  const isI18n = relPath.endsWith("terminal/lib/i18n.tsx");

  // ts.createSourceFile is lenient (produces error nodes rather than
  // throwing) on malformed input, so a scanned file always yields a
  // sourceFile; spans is simply empty if nothing qualifies as visible.
  // Parse .tsx as TSX and every other extension (.ts) as plain TS — a
  // TS-only file was previously always parsed as TSX regardless of its own
  // extension, which is the wrong grammar for a file that legitimately uses
  // TS-only syntax the TSX grammar treats differently (e.g. an angle-bracket
  // type assertion, `<T>value`, is ambiguous with a JSX element under the
  // TSX scanner).
  const scriptKind = relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const spans = computeVisibleSpans(sourceFile, relPath);
  // textSpans: the narrow, literal-text-bearing subset (JsxText / a
  // JSX-child or attribute string literal / a copy-dict value) — what
  // R1/R2/R4/R5b scan, since they only ever care about literal RENDERED
  // TEXT, never a property/identifier name. `spans` (the full set,
  // including "expr" spans covering non-literal JSX children like a bare
  // `{row.regime}` property access) is used only by R3 below, which is the
  // one rule whose target is never itself string-literal text.
  const textSpans = spans.filter((s) => s.kind !== "expr");

  let visibleAddedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (added.has(lineNo) && lineIsVisible(spans, sourceFile, lineNo)) visibleAddedCount += 1;
  }

  // R1: raw_state_enum — token-precise, text spans only. Scans ONLY the
  // text inside genuinely visible literal spans (never a whole line, never
  // an "expr" span), so an UPPER_SNAKE identifier used as a style/prop
  // value, a call argument, or inside a comparison/arrow expression on the
  // same line as real JSX text can never be mistaken for the visible text
  // itself (the exact false-positive class the review measured on
  // VolSkewPanel.tsx / HeatmapTable.tsx / OptionsHubView.tsx).
  const enumRe = /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g;
  for (const span of textSpans) {
    const spanText = text.slice(span.start, span.end);
    enumRe.lastIndex = 0;
    let m;
    while ((m = enumRe.exec(spanText))) {
      const token = m[1];
      if (PLAIN_VOCABULARY.allowTokens.includes(token)) continue;
      const absOffset = span.start + m.index;
      const lineNo = sourceFile.getLineAndCharacterOfPosition(absOffset).line + 1;
      const rawLine = lines[lineNo - 1] ?? "";
      const waiverReason = parseWaiver(rawLine);
      findings.push(mkFinding(relPath, lineNo, "raw_state_enum", token,
        "raw state enum in a user-visible position", suggestionForEnum(token),
        added.has(lineNo), waiverReason));
    }
  }

  // R2: internal_study_slug — whole-word, text spans only (same
  // span-precision as R1, never a whole-line test). The old
  // `line.includes(slug)` bare substring test also fired on ordinary
  // English words containing a slug as a substring, e.g. "lobe" inside
  // "Globe" (MEASURED: <span>Globe</span> blocked as
  // internal_study_slug "lobe").
  for (const span of textSpans) {
    const spanText = text.slice(span.start, span.end);
    for (const slug of PLAIN_VOCABULARY.studySlugs) {
      const slugRe = new RegExp(`\\b${escapeRegExp(slug)}\\b`, "g");
      let m;
      while ((m = slugRe.exec(spanText))) {
        const absOffset = span.start + m.index;
        const lineNo = sourceFile.getLineAndCharacterOfPosition(absOffset).line + 1;
        const rawLine = lines[lineNo - 1] ?? "";
        const waiverReason = parseWaiver(rawLine);
        findings.push(mkFinding(relPath, lineNo, "internal_study_slug", slug,
          "internal study/organ slug in a user-visible position",
          `<no plain phrase declared for ${slug} — add one to PLAIN_VOCABULARY, or route through lib/plainLabels.ts>`,
          added.has(lineNo), waiverReason));
      }
    }
  }

  // R4: untranslated_stat_token — text spans only, matching a rendered TEXT
  // token, never a property/identifier name. A bare `trade.dte` property
  // access is never a text span (at most an "expr" span, filtered out
  // above), so this loop can never mistake it for displayed text no matter
  // what else shares its line.
  for (const span of textSpans) {
    const spanText = text.slice(span.start, span.end);
    for (const tok of PLAIN_VOCABULARY.statTokens) {
      const tokRe = new RegExp(`\\b${tok}\\b`, "gi");
      let m;
      while ((m = tokRe.exec(spanText))) {
        const absOffset = span.start + m.index;
        const lineNo = sourceFile.getLineAndCharacterOfPosition(absOffset).line + 1;
        const rawLine = lines[lineNo - 1] ?? "";
        if (hasPlainHelperOnLine(rawLine, overlayTerms)) continue;
        const waiverReason = parseWaiver(rawLine);
        findings.push(mkFinding(relPath, lineNo, "untranslated_stat_token", tok,
          "untranslated raw statistic token rendered as visible text",
          `add a gloss via lib/i18n t("${tok}") or an inline explanatory label`,
          added.has(lineNo), waiverReason));
      }
    }
  }

  // R3: raw_slug_interpolation — the one rule whose target (a bare
  // property-access interpolation like `{row.regime}`) is never itself
  // string-literal text, so it cannot be made span-precise via a text-span
  // scan the way R1/R2/R4/R5b are. Per the binding round-3 ruling on
  // Terminal #530 ("a raw_slug_interpolation finding fires only when the
  // interpolation token's OWN column range lies inside a visible span
  // ... never because an unrelated visible span shares the physical
  // line"), this is SPAN-RANGE CONTAINMENT on the specific `{...field}`
  // match's own [start,end) offsets, never a whole-line visibility test.
  // A line-level `lineIsVisible` check (the round-2 shape) was wrong: it
  // returned true whenever ANY span — text or expr — overlapped the
  // physical line, so a non-visible attribute's interpolation
  // (`bar={cfg.type}`, `bar` not in VISIBLE_ATTR_NAMES, so `{cfg.type}`
  // gets no span of its own) was still flagged purely because a sibling
  // `title="..."` literal happened to sit on the same line. Requiring the
  // match's own range to be CONTAINED in a span (necessarily an "expr"
  // span — the only kind computeVisibleSpans emits for a bare `{...}`
  // interpolation, from a JSX-child expression or a title/aria-label/
  // placeholder/alt attribute expression) fixes that without touching
  // R1/R2/R4/R5b's already-correct span-precise text scans.
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const lineStart = sourceFile.getLineStarts()[idx];
    const waiverReason = parseWaiver(rawLine);
    for (const field of PLAIN_VOCABULARY.slugFields) {
      // Global + looped, NOT a single `.exec()` call: a line can carry more
      // than one `{...field}` interpolation for the SAME field — e.g.
      // `<Foo bar={cfg.type} title={row.type} />` — and each match's own
      // containment is independent of every other match on the line. A
      // non-global regex (the round-3 shape) returns only the FIRST match,
      // so once that first match failed containment the rest of the line
      // was never examined: MEASURED, that exact fixture and
      // `<div style={cfg.kind}>{row.kind}</div>` both produced ZERO
      // findings even though the second interpolation in each (a visible
      // `title={...}` attribute; a bare JSX-child `{row.kind}`) is exactly
      // the position this rule exists to block (PR #530 round-4 review
      // MAJOR — a true-positive regression the round-3 containment fix
      // introduced). Looping every match on the line and testing each
      // one's own [start,end) range independently fixes that without
      // reintroducing the round-3 line-overlap false positive: a match
      // that fails containment simply produces no finding of its own, and
      // does not gate whether a LATER match on the same line is tested.
      const interpRe = new RegExp(`\\{[^}]*\\.${field}\\}`, "g");
      let m;
      while ((m = interpRe.exec(rawLine))) {
        const absStart = lineStart + m.index;
        const absEnd = absStart + m[0].length;
        const contained = spans.some((s) => s.start <= absStart && absEnd <= s.end);
        if (contained && !hasPlainHelperOnLine(rawLine, overlayTerms)) {
          findings.push(mkFinding(relPath, lineNo, "raw_slug_interpolation", field,
            `raw "${field}" field interpolated with no plain-language helper on the same line`,
            `route through a plainLabels helper (e.g. regimeLabel/classicCategoryLabel) or lib/i18n t()`,
            added.has(lineNo), waiverReason));
        }
      }
    }
  });

  // R5b: general files — literal text in a genuine visible position (text
  // spans only — JsxText / a JSX-child or attribute string literal / a
  // copy-dict value, including behind ternary/logical/paren wrapping) with
  // no zh routing. (R5a — the i18n.tsx LEX-arity check — runs in a separate
  // multi-line-safe pass below, not per span.) This replaces the old
  // `enLitRe` rawLine regex (`[">]\s*(...)\s*[<"]`) entirely: that shape
  // matched `=>`/`<=` operators and any bare identifier sharing a line with
  // real JSX markup, and could never see a literal hidden behind a
  // ternary/logical operand in the first place.
  if (!isI18n) {
    for (const span of textSpans) {
      const raw = text.slice(span.start, span.end);
      const literal = span.kind === "literal" ? (raw.length >= 2 ? raw.slice(1, -1) : raw) : raw.trim();
      if (!literal) continue;
      const words = literal.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      const latinWords = words.filter((w) => /^[A-Za-z'-]+$/.test(w));
      if (latinWords.length < 2 || literal.length < 6) continue;
      const lineNo = sourceFile.getLineAndCharacterOfPosition(span.start).line + 1;
      const rawLine = lines[lineNo - 1] ?? "";
      if (hasPlainHelperOnLine(rawLine, overlayTerms)) continue;
      const waiverReason = parseWaiver(rawLine);
      findings.push(mkFinding(relPath, lineNo, "missing_zh", literal,
        "added English literal in a user-visible position with no zh routing (t(/tPlain(/pick(/LEX[)",
        `route through t()/tPlain()/pick() with a LEX entry carrying an [en, zh] pair`,
        added.has(lineNo), waiverReason));
    }
  }

  // R5a: LEX arity / zh-parity for terminal/lib/i18n.tsx — a dedicated
  // multi-line-safe, quote-aware pass over the whole file text, replacing
  // the old per-line `^...:\s*\[([^\]]*)\]` regex, which (a) split the
  // tuple on EVERY comma — so `["Hello, world"]` misread the literal comma
  // inside the English string as a tuple-element boundary — and (b)
  // required the whole `key: [...]` on ONE physical line, so a LEX entry
  // whose array spans multiple lines was never matched at all (a silent
  // miss, not a pass).
  if (isI18n) {
    for (const entry of findLexEntries(text)) {
      const parts = splitTopLevelCommas(entry.inner);
      const zh = parts[1] ? stripQuotes(parts[1]) : "";
      const entryLines = Array.from(
        { length: entry.endLine - entry.startLine + 1 },
        (_, k) => entry.startLine + k
      );
      const entryAdded = entryLines.some((ln) => added.has(ln));
      // A new LEX entry IS added user-visible copy — count it so the
      // zh_translation null (main(), "no new user-visible strings added")
      // is never printed for a file whose added lines ARE new English
      // strings routed through LEX (the AST visible-span check does not
      // classify a bare array-literal string as a visible position, which
      // produced exactly that false null).
      if (entryAdded) visibleAddedCount += 1;
      if (parts.length < 2 || zh === "") {
        const waiverReason2 = parseWaiver(lines[entry.startLine - 1] ?? "");
        findings.push(mkFinding(relPath, entry.startLine, "missing_zh", "LEX",
          "LEX entry has arity < 2 or an empty zh translation",
          "add a non-empty zh translation as the tuple's second element",
          entryAdded, waiverReason2));
      }
    }
  }

  // Dedup at (path, line, rule, token) — R2/R4 walk every regex match per
  // visible span with no dedup of their own, so a repeated token inside one
  // span (or across two spans sharing a line, e.g. `<span>oi</span>{" "}
  // <span>oi</span>`) previously produced one finding PER OCCURRENCE
  // (MEASURED: `OptionsHubView.tsx:3676 tok=oi` x3, `:3646 tok=oi` x2),
  // inflating `legacyReported` and burning the annotation cap on repeats of
  // a single already-reported line/token rather than distinct defects.
  // Every duplicate on the same (path, line, rule, token) key carries the
  // same `blocking`/`detail`/`suggestion` (both are derived only from
  // `relPath`, `lineNo`, the rule, and the token), so keeping the first
  // occurrence loses no information.
  const seenKeys = new Set();
  const dedupedFindings = [];
  for (const f of findings) {
    const key = `${f.path}:${f.line}:${f.rule}:${f.token}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    dedupedFindings.push(f);
  }

  return { findings: dedupedFindings, visibleAddedCount, touched: added.size > 0 };
}

// Split a LEX tuple's inner text (e.g. `"Hello, world", "..."`) on commas
// that are NOT inside a quoted string. A naive `str.split(",")` misreads a
// comma inside the English/zh string content itself as a tuple-element
// boundary.
function splitTopLevelCommas(str) {
  const parts = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") { i += 1; cur += str[i] ?? ""; continue; }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) parts.push(cur.trim());
  return parts;
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}

// Find every `KEY: [ ... ]` LEX entry in i18n.tsx, wherever it starts and
// however many lines its array spans — quote-aware bracket matching so a
// `]`/`,` inside a string literal never truncates or splits the entry.
function findLexEntries(text) {
  const entries = [];
  const startRe = /^[ \t]*[A-Za-z0-9_]+\s*:\s*\[/gm;
  let m;
  while ((m = startRe.exec(text))) {
    const bracketIdx = m.index + m[0].length - 1; // index of the '['
    let depth = 1;
    let i = bracketIdx + 1;
    let quote = null;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "[") {
        depth += 1;
      } else if (ch === "]") {
        depth -= 1;
      }
      i += 1;
    }
    const inner = text.slice(bracketIdx + 1, i - 1);
    const startLine = text.slice(0, m.index).split("\n").length;
    const endLine = startLine + inner.split("\n").length - 1;
    entries.push({ startLine, endLine, inner });
  }
  return entries;
}

function scanFile(root, absPath, addedLines, overlayTerms) {
  const relPath = relative(root, absPath).replace(/\\/g, "/");
  const text = readFileSync(absPath, "utf8");
  return scanLines(relPath, text, addedLines, overlayTerms);
}

function mkFinding(path, line, rule, token, detail, suggestion, addedFlag, waiverReason) {
  const blockingRaw = addedFlag;
  const waived = blockingRaw && waiverReason != null;
  return {
    path, line, rule, token,
    blocking: blockingRaw && !waived,
    waived, waiverReason: waiverReason ?? null,
    detail, suggestion,
  };
}

function formatHuman(findings, header) {
  const out = [];
  if (header) out.push(header);
  for (const f of findings) {
    out.push(`${f.path}:${f.line}: ${f.rule}: "${f.token}" — ${f.detail}`);
    out.push(`  ${f.suggestion}`);
  }
  return out.join("\n");
}

function resolveDiff({ diffFile, since, root }) {
  if (diffFile) {
    let text;
    try {
      text = diffFile === "-" ? readFileSync(0, "utf8") : readFileSync(diffFile, "utf8");
    } catch (e) {
      return { error: `--diff-file supplied but unreadable: ${diffFile} (${e.message})` };
    }
    return { text, baseResolved: true };
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", since], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    return { text: "", baseResolved: false };
  }
  try {
    const text = execFileSync(
      "git",
      // "terminal/lib" (not the narrower "terminal/lib/i18n.tsx") so an
      // added/changed lib/**/*copy*.ts(x) file's own lines are captured in
      // addedLines too — otherwise a real violation added inside a new copy
      // dictionary would only ever surface as `legacy`, never `blocking`
      // (PR #530 review BLOCKER 2).
      ["diff", "--unified=0", `${since}...HEAD`, "--", "terminal/app", "terminal/components", "terminal/lib"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return { text, baseResolved: true };
  } catch (e) {
    return { text: "", baseResolved: false };
  }
}

function selfCheckFixtures() {
  return {
    R1: { relPath: "fixture.tsx", code: "const x = <span>BOTTOM_WATCH</span>;", rule: "raw_state_enum" },
    R2: { relPath: "fixture.tsx", code: "const x = <span>trust_tier</span>;", rule: "internal_study_slug" },
    R3: { relPath: "fixture.tsx", code: "const x = <span>{row.regime}</span>;", rule: "raw_slug_interpolation" },
    R4: { relPath: "fixture.tsx", code: "const x = <span>iv_rank</span>;", rule: "untranslated_stat_token" },
    R5a: { relPath: "terminal/lib/i18n.tsx", code: '  newThing: ["Market is calm"],', rule: "missing_zh" },
    R5b: { relPath: "fixture.tsx", code: "const x = <h2>Market is calm today</h2>;", rule: "missing_zh" },
  };
}

// Real invocation: each fixture line is fed through the SAME scanLines() the
// production scan uses (not a re-typed regex proxy), with that one line
// marked as added — so a rule only reports "detected" if the guard's actual
// rule logic, on its actual code path, flags the fixture as blocking.
function runSelfCheck() {
  const fixtures = selfCheckFixtures();
  const results = {};
  for (const [rule, fx] of Object.entries(fixtures)) {
    const addedLines = new Map([[fx.relPath, new Set([1])]]);
    const { findings } = scanLines(fx.relPath, fx.code, addedLines, []);
    results[rule] = findings.some((f) => f.rule === fx.rule && f.blocking);
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const opts = { mode: "enforce-added", since: "origin/master", diffFile: null, root: null, json: false, selfCheck: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode") opts.mode = args[++i];
    else if (a === "--since") opts.since = args[++i];
    else if (a === "--diff-file") opts.diffFile = args[++i];
    else if (a === "--root") opts.root = args[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--self-check") opts.selfCheck = true;
  }

  // In --json mode, stdout carries ONLY the JSON document — every other
  // notice/diagnostic (the overlay-absent disclosure, an unresolvable-base
  // warning, a hard --root/--diff-file error) goes to stderr instead, so a
  // consumer can `JSON.parse(stdout)` directly rather than having to find
  // the JSON line among other text. Non-JSON invocations are unaffected —
  // notices still print to stdout there, unchanged.
  const notice = (line) => (opts.json ? process.stderr : process.stdout).write(line);

  const root = opts.root ? opts.root : findRepoRoot();
  if (opts.root && !existsSync(opts.root)) {
    notice(`::error title=plain-language::--root supplied but unreadable: ${opts.root}\n`);
    process.exitCode = 2;
    return;
  }

  if (opts.selfCheck) {
    const results = runSelfCheck();
    for (const [rule, ok] of Object.entries(results)) {
      process.stdout.write(`${rule} ${ok ? "detected" : "NOT detected"}\n`);
    }
    process.exitCode = 0;
    return;
  }

  const overlay = loadOverlay(root);
  const declaredTerms =
    Object.keys(PLAIN_VOCABULARY.stateEnums).length +
    PLAIN_VOCABULARY.studySlugs.length +
    PLAIN_VOCABULARY.slugFields.length +
    PLAIN_VOCABULARY.statTokens.length +
    PLAIN_VOCABULARY.plainHelpers.length +
    PLAIN_VOCABULARY.allowTokens.length;

  if (!overlay.present) {
    notice(
      `plain-language guard — vocabulary overlay ABSENT: terminal/lib/plainLabels.ts not present on this tree; using the ${declaredTerms} declared terms only.\n`
    );
  }

  const diffResult = resolveDiff({ diffFile: opts.diffFile, since: opts.since, root });
  if (diffResult.error) {
    notice(`::error title=plain-language::${diffResult.error}\n`);
    process.exitCode = 2;
    return;
  }
  if (!diffResult.baseResolved) {
    notice(
      `::warning title=plain-language::base ref '${opts.since}' is not resolvable in this checkout (shallow clone?) — no line counts as added, so nothing can block. Pass --diff-file with the PR's own diff.\n`
    );
    if (opts.json) {
      // `legacy: []` mirrors the shape of the success branch below — a
      // consumer reading `d.legacy` on THIS branch (an unresolvable base,
      // not a hard error) must not throw for a missing key just because
      // this is the early-exit path (PR #530 round-4 review minor 2).
      process.stdout.write(JSON.stringify({
        version: 1, mode: opts.mode, base: opts.since, baseResolved: false,
        vocabulary: { declaredTerms, overlaySource: "terminal/lib/plainLabels.ts", overlayPresent: overlay.present, overlayTerms: overlay.terms.length },
        scannedFiles: 0, findings: [], legacy: [], counts: { blocking: 0, legacyReported: 0, waived: 0 }, nulls: [],
      }));
      process.stdout.write("\n");
    }
    process.exitCode = 0;
    return;
  }

  const addedLines = parseAddedLineNumbers(diffResult.text);
  // Full census: every file under SCAN_GLOBS/EXTRA_FILES is scanned on every
  // run, not only the files the diff touches — this is what lets a legacy
  // (completely untouched) file's pre-existing violation be reported.
  // `addedLines` (from the diff) is what decides which findings are
  // `blocking` vs `legacy`; it never decides which files get opened.
  const scanFiles = listScanFiles(root);

  let allFindings = [];
  const nulls = [];
  for (const f of scanFiles) {
    const { findings, visibleAddedCount, touched } = scanFile(root, f, addedLines, overlay.terms);
    // Null is capped to files the diff actually TOUCHED (added.size > 0 for
    // that path) that still came back with nothing checkable — never every
    // scanned file. Before this gate, a file the diff never touched at all
    // (the overwhelming majority of the ~230+ scanned files on any given
    // PR) got the exact same "not evaluable" null as a genuinely limited
    // check, because `visibleAddedCount === 0` is trivially true for any
    // untouched file — that is "a rule ran on every file", not "a rule
    // could not run on a file it needed to check".
    if (touched && findings.length === 0 && visibleAddedCount === 0) {
      // Honest null: this file had no user-visible ADDED lines at all, so
      // "no findings" cannot be hiding a missed zh-parity check — there was
      // nothing on the diff's side of this file to check in the first place.
      nulls.push({ axis: "zh_translation", path: relative(root, f).replace(/\\/g, "/"), value: "not evaluable — no new user-visible strings added" });
    }
    allFindings = allFindings.concat(findings);
  }

  const blocking = allFindings.filter((f) => f.blocking);
  const legacy = allFindings.filter((f) => !f.blocking && !f.waived);
  const waived = allFindings.filter((f) => f.waived);

  if (opts.json) {
    // `findings` carries only the entries that count for THIS run (blocking
    // + explicitly waived — a waiver still names a finding that fired on an
    // added line, just non-fatal). Pre-existing, non-blocking defects live
    // in the separate `legacy` bucket: they are real, disclosed debt (the
    // per-rule doc breakdown reads from this array) but must never be
    // mistaken for something this PR's own diff introduced, and a consumer
    // scanning `findings` for "what does this PR need to fix" no longer has
    // to filter `blocking` out of a mixed array by hand.
    // process.stdout.write + process.exitCode (never console.log followed
    // by process.exit): Node's stdout is a NON-BLOCKING pipe when the
    // parent redirects it (any CI step, `| jq`, this suite's own
    // spawnSync), so a write larger than the OS pipe buffer (64 KiB) is
    // queued rather than completed synchronously — process.exit() tears
    // the process down immediately and drops whatever was still queued.
    // MEASURED on this PR's own tree: a real `--json` run's stdout was
    // 94339 bytes written to a file (valid) but exactly 65536 bytes
    // (`JSONDecodeError: Unterminated string`) piped through `wc -c`, with
    // the identical command and arguments (PR #530 round-4 review MAJOR).
    // Setting `process.exitCode` and letting `main()` return lets the
    // event loop drain the pending write before Node exits naturally.
    process.stdout.write(JSON.stringify({
      version: 1,
      mode: opts.mode,
      base: opts.since,
      baseResolved: true,
      vocabulary: { declaredTerms, overlaySource: "terminal/lib/plainLabels.ts", overlayPresent: overlay.present, overlayTerms: overlay.terms.length },
      scannedFiles: scanFiles.length,
      findings: blocking.concat(waived),
      legacy,
      counts: { blocking: blocking.length, legacyReported: legacy.length, waived: waived.length },
      nulls,
    }));
    process.stdout.write("\n");
    process.exitCode = blocking.length > 0 ? 1 : 0;
    return;
  }

  if (opts.mode === "report") {
    process.stdout.write(formatHuman(allFindings, "plain-language guard — full census (report mode)"));
    process.stdout.write("\n");
    process.exitCode = 0;
    return;
  }

  // enforce-added mode
  if (blocking.length > 0) {
    process.stdout.write(`::error title=plain-language::${blocking.length} blocking plain-language finding(s) on newly added lines\n`);
  }
  const capped = blocking.slice(0, ANNOTATION_CAP);
  for (const f of capped) {
    process.stdout.write(`::error title=plain-language::${f.path}:${f.line}: ${f.rule}: "${f.token}" — ${f.suggestion}\n`);
  }
  if (blocking.length > 0) {
    process.stdout.write(formatHuman(blocking, "blocking (added lines)"));
    process.stdout.write("\n");
  }
  if (legacy.length > 0) {
    process.stdout.write(formatHuman(legacy, "legacy (pre-existing, not blocking)"));
    process.stdout.write("\n");
  }
  if (waived.length > 0) {
    process.stdout.write(formatHuman(waived, "waived (plain-language-ok)"));
    process.stdout.write("\n");
  }
  for (const n of nulls) {
    process.stdout.write(`null: ${n.axis} @ ${n.path}: ${n.value}\n`);
  }
  // Same write-then-exit truncation risk as the --json branch above
  // (PR #530 round-4 review MAJOR) — set exitCode and let main() return
  // rather than force-killing the process mid-flush.
  process.exitCode = blocking.length > 0 ? 1 : 0;
}

main();
