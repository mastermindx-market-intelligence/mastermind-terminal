"use strict";
// Fail-closed source-lock planner for the expensive immutable browser evidence
// capture. Native merge_group may reuse checked-in legacy evidence only when
// BOTH original screenshot-packet source locks match the exact integrated tree.
// A missing/altered manifest, file, conflicting lock, or hash mismatch orders
// fresh, fully validated captures. No false-green source hash overrides.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../../..");
const MANIFESTS = [
  "terminal/docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml",
  "terminal/docs/pr-crops/terminal-visual-intelligence/EVIDENCE.yml",
];

function manifestLocks(root, relative) {
  const filename = path.join(root, relative);
  const raw = fs.readFileSync(filename, "utf8");
  if (raw.length > 256 * 1024) throw new Error("manifest too large");
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex(line => line === "layoutFiles:");
  if (start < 0) throw new Error("missing layoutFiles");
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) {
    const m = /^  (terminal\/[^\s:]+): "?([0-9a-f]{64})"?$/.exec(lines[i]);
    if (!m) throw new Error("invalid layoutFiles row");
    const rel = m[1];
    if (rel.split("/").some(part => part === "." || part === "..") || rel.includes("\\"))
      throw new Error("unsafe source path");
    rows.push({rel, expected: m[2]});
  }
  if (rows.length < 8 || rows.length > 128) throw new Error("incomplete layoutFiles");
  return rows;
}

function planEvidenceCapture(root = ROOT) {
  try {
    const locks = new Map();
    for (const manifest of MANIFESTS) {
      for (const {rel, expected} of manifestLocks(root, manifest)) {
        if (locks.has(rel) && locks.get(rel) !== expected)
          throw new Error("conflicting evidence source locks");
        locks.set(rel, expected);
      }
    }
    const stale = [];
    for (const [rel, expected] of locks) {
      const bytes = fs.readFileSync(path.join(root, rel));
      const actual = crypto.createHash("sha256").update(bytes).digest("hex");
      if (actual !== expected) stale.push(rel);
    }
    return {capture: stale.length > 0, reason: stale.length ? "source-drift" : "locked-source-match", stale};
  } catch (error) {
    return {capture: true, reason: "fail-closed", error: String(error.message || error)};
  }
}


// Paths only: discovering the ordinary partition must never import these readers.
// Each reader still validates its genuine selected records or authorized legacy
// inputs when its evidence partition is collected.
const UNIT_EVIDENCE_CONSUMERS = Object.freeze([
  "lib/__tests__/b_pl_6Batch1Evidence.test.ts",
  "lib/__tests__/visualIntelligenceEvidence.test.ts",
  "lib/__tests__/optionsLevelAxisEvidence.test.ts",
]);

function unitEvidencePartition({
  partition,
  planOutcome,
  capture,
  eventName,
  captureOutcome,
  evidenceMode,
  evidenceComposition,
} = {}) {
  // The existing unpartitioned workflow retains its complete default discovery.
  if (partition === undefined) return {};
  if (partition === "ordinary") return {exclude: [...UNIT_EVIDENCE_CONSUMERS]};
  if (partition !== "evidence") throw new Error("unknown Terminal unit partition");
  if (planOutcome !== "success")
    throw new Error("evidence partition requires successful evidence capture planner");

  if (capture === "true") {
    if (captureOutcome !== "success" || evidenceMode !== "records"
        || typeof evidenceComposition !== "string" || !evidenceComposition.trim())
      throw new Error("evidence partition requires successful capture and current records selector");
  } else if (capture === "false") {
    if (eventName !== "merge_group"
        || captureOutcome !== "skipped"
        || (evidenceMode !== undefined && evidenceMode !== "legacy")
        || evidenceComposition !== undefined)
      throw new Error("legacy evidence partition requires authorized merge-group plan without stale selector");
  } else {
    throw new Error("evidence partition requires explicit planner capture true or false");
  }
  // This is an import barrier, not a second composition validator. The existing
  // consumers perform their fresh validating reads after collection is admitted.
  return {include: [...UNIT_EVIDENCE_CONSUMERS]};
}

if (require.main === module) {
  const result = process.env.GITHUB_EVENT_NAME === "merge_group"
    ? planEvidenceCapture() : {capture: true, reason: "full-pr-proof"};
  const value = result.capture ? "true" : "false";
  if (!process.env.GITHUB_OUTPUT) {
    console.error("GITHUB_OUTPUT missing: cannot authorize evidence skip");
    process.exitCode = 1;
  } else {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "capture=" + value + "\n");
    console.log("evidence capture=" + value + " reason=" + result.reason
      + " drifted_files=" + (result.stale || []).length);
    if (result.error) console.warn("::warning::Evidence planner fallback: " + result.error);
  }
}

module.exports = {MANIFESTS, manifestLocks, planEvidenceCapture, UNIT_EVIDENCE_CONSUMERS, unitEvidencePartition};
