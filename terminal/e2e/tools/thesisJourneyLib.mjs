import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = [
  /cookie/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /jwt/i,
  /email/i,
  /auth[_-]?user/i,
  /user[_-]?id/i,
  /session[_-]?id/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /cred/i,
];
export const PHASE_A_CASES = [
  ["Analysis gate blocks the thesis workspace.", 200],
  ["Theses view stays anonymous.", 200],
  ["Anonymous thesis list is rejected.", 401],
  ["Anonymous thesis creation is rejected.", 401],
  ["Anonymous saved views are rejected.", 401],
];

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.some((pattern) => pattern.test(key));
}

function preserveLiteral(value) {
  return /^[0-9a-f]{40}$/i.test(value)
    || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function redactString(value) {
  if (preserveLiteral(value)) return value;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return REDACTED;
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return REDACTED;
  if (/^[A-Za-z0-9+/=]{20,}$/.test(value)) return REDACTED;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return REDACTED;
  return value;
}

export function redactReceipt(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactReceipt);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSensitiveKey(key) ? REDACTED : redactReceipt(child),
  ]));
}

export function releaseFromHtml(html) {
  if (typeof html !== "string") return null;
  const match = html.match(/<html\b[^>]*\sdata-dpl-id="([0-9a-f]{40})"[^>]*>/i);
  return match ? match[1].toLowerCase() : null;
}

export function buildProofTitle(expectedRelease, proofSymbol, capturedAt = new Date()) {
  if (!/^[0-9a-f]{40}$/i.test(expectedRelease || "")) throw new Error("The proof release id is malformed.");
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) throw new Error("The proof time is malformed.");
  const day = date.toISOString().slice(0, 10);
  return `Live proof at release ${expectedRelease.slice(0, 8)}: ${proofSymbol} on ${day}. 发布 ${expectedRelease.slice(0, 8)} 的 ${proofSymbol} 实测。`;
}

function storageStatePath(pathArgument, root, fs) {
  const liveStateRoot = path.resolve(root, "e2e/.live-state");
  const statePath = path.resolve(pathArgument);
  if (!fs.existsSync(statePath)) return { error: "The operator storage state file does not exist." };
  if (!fs.statSync(statePath).isFile()) return { error: "The operator storage state file is not a regular file." };
  const stateDirectory = fs.realpathSync(path.dirname(statePath));
  const liveRootDirectory = fs.realpathSync(path.dirname(liveStateRoot));
  const relative = path.relative(liveRootDirectory, stateDirectory);
  if (relative !== ".live-state" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "The operator storage state must be inside the git-ignored live-state directory." };
  }
  return { statePath, relativeStatePath: path.join("e2e/.live-state", path.basename(fs.realpathSync(statePath))) };
}

function isStorageState(value) {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray(value.cookies)
    && Array.isArray(value.origins);
}

export function checkStorageState(pathArgument, dependencies = {}) {
  if (!pathArgument) return "The operator storage state was not supplied.";
  const fs = dependencies.fs || { existsSync, readFileSync, realpathSync, statSync };
  const git = dependencies.execFileSync || execFileSync;
  const root = dependencies.root || process.cwd();
  const checkedPath = storageStatePath(pathArgument, root, fs);
  if (checkedPath.error) return checkedPath.error;

  let ignoreText;
  try {
    ignoreText = fs.readFileSync(path.resolve(root, ".gitignore"), "utf8");
  } catch {
    return "The operator storage state directory is not git-ignored.";
  }
  if (!ignoreText.split(/\r?\n/).some((line) => line.trim() === "e2e/.live-state/")) {
    return "The operator storage state directory is not git-ignored.";
  }
  let storageState;
  try {
    storageState = JSON.parse(fs.readFileSync(checkedPath.statePath, "utf8"));
  } catch {
    return "The operator storage state file is malformed.";
  }
  if (!isStorageState(storageState)) return "The operator storage state file is malformed.";

  try {
    const tracked = git("git", ["ls-files", "--", checkedPath.relativeStatePath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (tracked.trim()) return "The operator storage state is tracked by git.";
    git("git", ["check-ignore", "-q", "--", checkedPath.relativeStatePath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return "The operator storage state tracking could not be checked.";
  }
  return null;
}

export function thesisIdFromUrl(rawUrl) {
  const ids = new URL(rawUrl).searchParams.getAll("thesis");
  if (ids.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ids[0])) {
    throw new Error("The created proof thesis id was not returned through the URL.");
  }
  return ids[0].toLowerCase();
}

export function detailFromResponse(thesis, thesisId) {
  if (thesis?.id !== thesisId) throw new Error("Detail response did not return the proof thesis.");
  return thesis;
}

function isVersionSnapshot(value, expectedVersion, expectedPreviousVersion) {
  return value?.version === expectedVersion && value?.previousVersion === expectedPreviousVersion;
}

export function validateVersions({ created, revised, archived }) {
  return created?.currentVersion === 1
    && created?.lifecycleState === "active"
    && isVersionSnapshot(created?.current, 1, null)
    && created?.history?.length === 1
    && revised?.currentVersion === 2
    && revised?.lifecycleState === "active"
    && isVersionSnapshot(revised?.current, 2, 1)
    && revised?.history?.length === 2
    && archived?.currentVersion === 3
    && archived?.lifecycleState === "archived"
    && isVersionSnapshot(archived?.current, 3, 2)
    && archived?.history?.length === 3;
}

export function exitCodeFor(failureKind) {
  if (failureKind === "release") return 2;
  return failureKind ? 1 : 0;
}

export function validateReceipt(value) {
  if (!value || typeof value !== "object") return false;
  if (!/^[0-9a-f]{40}$/i.test(value.expectedRelease || "")) return false;
  if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) return false;
  if (!Array.isArray(value.phaseA) || value.phaseA.length !== PHASE_A_CASES.length) return false;
  const validCases = value.phaseA.every((entry, index) => entry?.ok === true
    && entry.case === PHASE_A_CASES[index][0]
    && entry.status === PHASE_A_CASES[index][1]);
  if (!validCases) return false;
  if (!Number.isInteger(value.browserErrorCount) || value.browserErrorCount !== 0) return false;
  if (value.phaseB?.ran === true) return false;
  return true;
}

export function validateSignedInReceipt(value) {
  if (!value || typeof value !== "object") return false;
  if (!/^[0-9a-f]{40}$/i.test(value.expectedRelease || "")) return false;
  if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) return false;
  if (!Array.isArray(value.phaseA) || value.phaseA.length !== PHASE_A_CASES.length) return false;
  const validCases = value.phaseA.every((entry, index) => entry?.ok === true
    && entry.case === PHASE_A_CASES[index][0]
    && entry.status === PHASE_A_CASES[index][1]);
  if (!validCases) return false;
  if (!Number.isInteger(value.browserErrorCount) || value.browserErrorCount !== 0) return false;
  if (value.phaseB?.ran !== true || value.phaseB.route !== "operator_url") return false;
  if (value.phaseB.archived !== true) return false;
  const versions = value.phaseB.versions;
  if (!Array.isArray(versions) || versions.length !== 3) return false;
  if (!versions.every((entry, index) => entry?.version === index + 1
    && entry.previousVersion === (index === 0 ? null : index))) return false;
  return true;
}

export function signedReceiptFor(phaseA, phaseB, meta, now = new Date()) {
  if (!phaseB || phaseB.ran !== true) throw new TypeError("signedReceiptFor needs a Phase B result that ran");
  if (!Number.isInteger(phaseB.browserErrorCount) || phaseB.browserErrorCount < 0) {
    throw new TypeError("Phase B result must carry its own non-negative integer browserErrorCount");
  }
  return {
    capturedAt: now.toISOString(),
    base: meta.base,
    expectedRelease: meta.expectedRelease,
    phaseA,
    phaseB,
    browserErrorCount: phaseB.browserErrorCount,
  };
}

const NEGATIVE_CASE_REASONS = {
  no_other_state: "No other-account storage state was provided.",
  other_state_invalid: "The other-account storage state was invalid.",
  phase_b_not_run: "Phase B did not run.",
  phase_c_error: "An internal error occurred during Phase C.",
};

export function describeNegativeCaseReason(reason) {
  const sentence = NEGATIVE_CASE_REASONS[reason];
  if (!sentence) throw new TypeError("The Phase C reason is not documented.");
  return sentence;
}

export function admitOtherStorageState({ path, blockedReason, samePath }) {
  if (!path) return { run: false, reason: "no_other_state" };
  if (blockedReason || samePath) return { run: false, reason: "other_state_invalid" };
  return { run: true, reason: null };
}

export function negativeCaseExitRequired(phaseC) {
  return (
    phaseC?.reason === "phase_c_error"
    || (phaseC?.ran === true && (
      phaseC.ok !== true
      || phaseC.browserErrorCount !== 0
    ))
  );
}

export function negativeCaseListExcludes(body, thesisId) {
  return Array.isArray(body?.theses) && !body.theses.some((thesis) => thesis?.id === thesisId);
}

export function notFoundHeadingMatches(text) {
  const heading = typeof text === "string" ? text.trim() : "";
  return heading === "Thesis not found" || heading === "未找到论点";
}

/**
 * Evaluates the five wrong-user negative-case outcomes.
 * leak = any of read/revise/archive returned 200, 201, or 409 (existence confirmed).
 * A 400, 401, 403, 500, or other failure is not proven and is not a leak.
 */
export function negativeCaseOutcome({ read, revise, archive, listExcludes, uiNotFound }) {
  const leak = [read, revise, archive].some((s) => s === 200 || s === 201 || s === 409);
  const ok = read === 404 && revise === 404 && archive === 404 && listExcludes && uiNotFound;
  return { ok, leak };
}

/**
 * Validates a negative-case block on the signed-in receipt. An honest leak receipt is
 * valid evidence even though the prover exits non-zero after writing it.
 */
export function validateNegativeCaseReceipt(value) {
  if (!value || typeof value !== "object") return false;
  const pc = value.phaseC;
  if (!pc) return true;
  if (pc.ran === false) {
    return pc.reason === undefined || Object.prototype.hasOwnProperty.call(NEGATIVE_CASE_REASONS, pc.reason);
  }
  if (pc.ran !== true) return false;
  const integerStatus = (status) => Number.isInteger(status) && status >= 0;
  const { ok: expectedOk, leak: expectedLeak } = negativeCaseOutcome({
    read: pc.read,
    revise: pc.revise,
    archive: pc.archive,
    listExcludes: pc.listExcludes,
    uiNotFound: pc.uiNotFound,
  });
  return (
    integerStatus(pc.read)
    && integerStatus(pc.revise)
    && integerStatus(pc.archive)
    && integerStatus(pc.browserErrorCount)
    && typeof pc.listExcludes === "boolean"
    && typeof pc.uiNotFound === "boolean"
    && typeof pc.ok === "boolean"
    && typeof pc.leak === "boolean"
    && pc.ok === expectedOk
    && pc.leak === expectedLeak
  );
}
