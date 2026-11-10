"use strict";
// Fail-closed source-lock planner for the expensive immutable browser evidence
// capture. Native merge_group may reuse checked-in legacy evidence only when
// all registered screenshot-packet source locks match the exact integrated tree.
// A missing/altered manifest, file, conflicting lock, or hash mismatch orders
// fresh, fully validated captures. No false-green source hash overrides.
//
// pull_request runs always capture their own fresh evidence, and additionally
// gate on their own diff: when a PR-touched evidence-locked source no longer
// matches its checked-in lock, the PR itself fails with "recapture evidence
// and commit the lock in this PR". Without this PR-time gate the identical
// drift is only discovered by the merge_group backstop AFTER merge qualification
// starts, turning one forgotten recapture into hours of red groups.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../../..");
const MANIFESTS = [
  "terminal/docs/pr-crops/b-pl-6-batch-1/EVIDENCE.yml",
  "terminal/docs/pr-crops/terminal-visual-intelligence/EVIDENCE.yml",
  "terminal/docs/pr-crops/b-pl-6-batch-3/EVIDENCE.yml",
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

// PR-time drift attribution. `touchedText` is the newline-separated list of
// repo-relative paths the pull request itself changed (ci.yml records
// `git diff --name-only --no-renames HEAD^1 HEAD` of the synthetic merge
// commit into EVIDENCE_PR_TOUCHED_FILE). Only KNOWN source-drift on a
// PR-touched path fails the PR: inherited drift on untouched paths stays with
// the merge_group backstop, and fail-closed plans (missing/malformed manifest)
// cannot attribute drift and leave PR capture behavior unchanged.
function driftedTouchedSources(root = ROOT, touchedText = process.env.EVIDENCE_PR_TOUCHED_FILE || "") {
  const plan = planEvidenceCapture(root);
  const touched = new Set();
  for (const line of String(touchedText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) touched.add(trimmed);
  }
  const drifted = plan.reason === "source-drift"
    ? plan.stale.filter(rel => touched.has(rel))
    : [];
  return {plan, touched: [...touched], drifted};
}

if (require.main === module) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  let result;
  let prGate = null;
  if (eventName === "merge_group") {
    result = planEvidenceCapture();
  } else if (eventName === "pull_request") {
    prGate = driftedTouchedSources();
    if (prGate.drifted.length) {
      for (const rel of prGate.drifted) {
        console.error("::error title=evidence-lock-drift::" + rel
          + " drifted from its checked-in evidence lock — recapture evidence and commit the lock in this PR");
      }
      console.error("PR evidence drift gate: " + prGate.drifted.length
        + " PR-touched locked source(s) drifted from the checked-in lock; failing this PR now"
        + " instead of the merge group later");
    } else if (prGate.plan.reason === "fail-closed" || prGate.touched.length === 0) {
      console.warn("::warning::PR evidence drift gate could not attribute drift"
        + " (reason=" + prGate.plan.reason + ", touched_paths=" + prGate.touched.length
        + "); merge-group backstop still enforces the locks");
    }
    // PRs always earn their own fresh capture regardless of the gate verdict.
    result = {capture: true, reason: "full-pr-proof", stale: prGate.plan.stale};
  } else {
    result = {capture: true, reason: "full-pr-proof"};
  }
  const value = result.capture ? "true" : "false";
  if (!process.env.GITHUB_OUTPUT) {
    console.error("GITHUB_OUTPUT missing: cannot authorize evidence skip");
    process.exitCode = 1;
  } else {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "capture=" + value + "\n");
    console.log("evidence capture=" + value + " reason=" + result.reason
      + " drifted_files=" + (result.stale || []).length);
    if (result.error) console.warn("::warning::Evidence planner fallback: " + result.error);
    if (prGate && prGate.drifted.length) process.exitCode = 1;
  }
}

module.exports = {MANIFESTS, manifestLocks, planEvidenceCapture, driftedTouchedSources};
