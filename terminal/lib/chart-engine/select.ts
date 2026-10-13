// Mastermind Chart Engine — engine selection resolver (P3/P4 dark-launch input).
//
// Pure decision logic for WHICH renderer impl ("lwc" today, "mm" once P3 lands) a chart
// mount should use, feeding the dark launch and its rollback path
// (docs/CHART_ENGINE_MASTERPLAN.md P3 "dark-launch behind ?engine=mm and a per-user
// flag" / P4 "flip default, keep LWC as fallback"). The module is deliberately free of
// browser globals: the query string and the storage object are INJECTED by the caller
// (the component owns `location.search` and the host's storage, both SSR-guarded), so
// the resolver stays unit-testable in plain Node and reusable from any host.
//
// Precedence (strictly ordered, first match wins):
//   1. kill switch        — always forces "lwc"; nothing below it is even consulted.
//   2. url ?engine=…      — one-shot override; also the operator's one-click rollback
//                           lever (?engine=lwc beats any stored "mm").
//   3. stored preference  — the per-browser choice made by persistEngineChoice().
//   4. build default      — the compiled-in default ("lwc" until the P4 flip).
//
// An invalid url/stored value never silently wins: resolution falls through to the next
// source and the rejected value is reported in `selection.invalid` (typed, explicit) so
// a consumer can log it. If both url and stored are invalid, the higher-precedence one
// (url) is the one reported — one field, one story.

export type EngineImplId = "lwc" | "mm";

export type EngineSelectionSource = "url" | "stored" | "default" | "killswitch";

export type EngineSelectionInvalid = {
  source: "url" | "stored";
  value: string;
};

export type EngineSelection = {
  impl: EngineImplId;
  source: EngineSelectionSource;
  reason: string;
  invalid?: EngineSelectionInvalid;
};

export type ResolveEngineInput = {
  /** Query string to inspect (the page's location.search, or ""). */
  search?: string;
  /** Raw persisted value (what the host's storage returned), if any. */
  stored?: string | null;
  /** Compiled-in default impl; must itself be a valid EngineImplId. */
  buildDefault: EngineImplId;
  /** Emergency rollback: when true, resolution short-circuits to "lwc". */
  killSwitch?: boolean;
};

/**
 * Minimal storage surface this module needs. Structurally satisfied by the host's
 * per-browser storage; tests inject a Map-backed fake (or a throwing one).
 */
export type EngineStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Per-browser renderer preference. Deliberately NOT owner-scoped: which renderer draws
 * the chart is a display preference of this browser install, not user data, so it does
 * not ride along with account-scoped sync and never reaches server-side user records.
 * Matches the house "mm.<thing>" storage-key convention (mm.activeSymbol, mm.chartSettings…).
 */
export const STORAGE_KEY = "mm.engine";

/** URL query parameter that carries the one-shot override / rollback lever. */
export const ENGINE_URL_PARAM = "engine";

const IMPL_IDS: readonly EngineImplId[] = ["lwc", "mm"];

/**
 * Canonicalize a raw impl value: trims surrounding whitespace and lower-cases before
 * matching the two ids. Returns null for anything else ("canvas9", "", "lwc2", …).
 */
function normalizeImplValue(raw: string): EngineImplId | null {
  const candidate = raw.trim().toLowerCase();
  return IMPL_IDS.includes(candidate as EngineImplId) ? (candidate as EngineImplId) : null;
}

/**
 * Raw `engine` param from a query string, or null when the param is absent.
 * URLSearchParams semantics: a leading "?" is fine, and with repeated params the
 * FIRST occurrence wins (same as the platform's own .get()).
 */
function rawEngineParam(search: string): string | null {
  if (search === "") return null;
  const value = new URLSearchParams(search).get(ENGINE_URL_PARAM);
  return value;
}

/**
 * The valid impl requested by the query string, or null when the param is absent OR
 * present-but-invalid. Absent and invalid are distinguished by resolveEngineImpl()
 * (which reports the latter); this helper only answers "did the url ask for a usable id".
 */
export function engineQueryFromUrl(search: string): EngineImplId | null {
  const raw = rawEngineParam(search);
  return raw === null ? null : normalizeImplValue(raw);
}

/**
 * Resolve which impl to mount. Pure: no globals read, no storage touched — the caller
 * passes the query string and the stored value it already read. See the precedence
 * table in the module header; the returned `reason` is a stable, human-readable string
 * suitable for the status line or diagnostics.
 */
/**
 * Opt-in mount selector for ChartPanel (F-13). Built on resolveEngineImpl with
 * stored = null and buildDefault "lwc", so a persisted mm.engine value can never
 * change production. Returns "mm" only when the URL query selects mm under
 * engineQueryFromUrl's existing parsing: URLSearchParams.get("engine") (leading
 * "?" optional; first occurrence wins), then trim + lower-case. Absent, "",
 * "lwc", and garbage all resolve to "lwc". "?engine=MM" / "?engine= mm " → "mm".
 */
export function resolveMountEngineImpl(search: string | null | undefined): EngineImplId {
  return resolveEngineImpl({
    search: search ?? undefined,
    stored: null,
    buildDefault: "lwc",
  }).impl;
}

export function resolveEngineImpl(input: ResolveEngineInput): EngineSelection {
  if (input.killSwitch) {
    return {
      impl: "lwc",
      source: "killswitch",
      reason: "kill switch engaged: forced impl lwc",
    };
  }

  let invalid: EngineSelectionInvalid | undefined;

  const urlRaw = input.search === undefined ? null : rawEngineParam(input.search);
  if (urlRaw !== null) {
    const impl = normalizeImplValue(urlRaw);
    if (impl !== null) {
      return { impl, source: "url", reason: `url ?${ENGINE_URL_PARAM}=${impl}` };
    }
    invalid = { source: "url", value: urlRaw };
  }

  if (typeof input.stored === "string") {
    const impl = normalizeImplValue(input.stored);
    if (impl !== null) {
      return { impl, source: "stored", reason: `stored ${STORAGE_KEY}=${impl}`, invalid };
    }
    invalid ??= { source: "stored", value: input.stored };
  }

  return {
    impl: input.buildDefault,
    source: "default",
    reason: `build default ${input.buildDefault}`,
    invalid,
  };
}

/**
 * Read the persisted preference. Returns the raw stored string (canonical or garbage —
 * resolveEngineImpl decides), or null when absent/unreadable. Never throws: hosts can
 * deny storage (private mode), which must not take down a chart mount.
 */
export function readStoredEngine(storage: EngineStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a per-browser choice. Returns true when the write landed, false when the
 * host refused it (private mode, quota, disabled). Never throws.
 */
export function persistEngineChoice(storage: EngineStorage, impl: EngineImplId): boolean {
  try {
    storage.setItem(STORAGE_KEY, impl);
    return true;
  } catch {
    return false;
  }
}

/** Drop the persisted choice (back to build default). Returns true/false like the write; never throws. */
export function clearEngineChoice(storage: EngineStorage): boolean {
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a share/rollback link: `url` with its `engine` param set to `impl`, every other
 * param (and any #hash) preserved. Accepts absolute or path-relative URLs; the query is
 * re-serialized by URLSearchParams, so encoding is canonicalized. A repeated `engine`
 * param collapses to the single new value in the first occurrence's position.
 */
export function withEngineParam(url: string, impl: EngineImplId): string {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set(ENGINE_URL_PARAM, impl);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * The operator's one-click rollback path: true when this selection came from the url or
 * the kill switch AND resolved to "lwc" — i.e. an explicit out-of-band demand for the
 * legacy renderer, not merely "lwc happened to be the default".
 */
export function isRollbackRequested(selection: EngineSelection): boolean {
  return (
    (selection.source === "url" || selection.source === "killswitch") && selection.impl === "lwc"
  );
}

/** One-line status/inventory rendering of a selection, e.g. `engine=mm (url)`. */
export function describeSelection(selection: EngineSelection): string {
  return `engine=${selection.impl} (${selection.source})`;
}
