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

export function storageStateError(path, dependencies) {
  if (!path) return "operator storage state was not supplied";
  const { existsSync, readFileSync, resolve, root, trackedPaths } = dependencies;
  const statePath = resolve(path);
  const liveStateRoot = `${root}/e2e/.live-state`;
  if (!existsSync(statePath)) return "operator storage state file does not exist";
  if (statePath !== `${liveStateRoot}${statePath.slice(liveStateRoot.length)}`) {
    return "operator storage state must be inside the git-ignored live-state directory";
  }
  if (!readFileSync(`${root}/.gitignore`, "utf8").includes("e2e/.live-state/")) {
    return "operator storage state directory is not git-ignored";
  }
  const tracked = trackedPaths();
  if (!tracked) return "operator storage state git status is unavailable";
  const relative = `e2e/.live-state${statePath.slice(liveStateRoot.length)}`;
  return tracked.has(relative) ? "operator storage state is tracked by git" : null;
}

export function thesisIdFromUrl(rawUrl) {
  const thesisId = new URL(rawUrl).searchParams.get("thesis");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(thesisId || "")) {
    throw new Error("Created proof thesis id was not returned through the URL.");
  }
  return thesisId.toLowerCase();
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
  if (!Array.isArray(value.phaseA) || value.phaseA.length !== 5) return false;
  if (!value.phaseA.every((entry) => entry?.ok === true)) return false;
  if (Array.isArray(value.browserErrors) && value.browserErrors.length > 0) return false;
  if (value.phaseB?.ran === true) return false;
  return true;
}
