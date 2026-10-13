// Mastermind Chart Engine — engine selection resolver (P03: the P4 default flip).
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
//   2. url ?engine=…      — override that ALSO PERSISTS the choice per browser (P03),
//                           the operator's one-click rollback lever (?engine=lwc beats
//                           any stored "mm") and the opt-in lever (?engine=mm).
//   3. stored preference  — the per-browser choice made by persistEngineChoice().
//   4. build default      — the compiled-in BUILD_DEFAULT_ENGINE ("mm" since the flip).
//
// An invalid url/stored value never silently wins: resolution falls through to the next
// source and the rejected value is reported in `selection.invalid` (typed, explicit) so
// a consumer can log it. If both url and stored are invalid, the higher-precedence one
// (url) is the one reported — one field, one story.
//
// The mount entry point resolveMountEngineSelection() layers the P03 persistence rules
// on top of resolveEngineImpl and defaults its storage to browserEngineStorage()
// (browserStorage.ts) — the ONLY module in this corner that touches browser globals, so
// the purity guarantee above (and its test) holds here unchanged.

import { browserEngineStorage } from "./browserStorage";

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
  /** Compiled-in default impl; must itself be a valid EngineImplId. Omitted means
   *  BUILD_DEFAULT_ENGINE ("mm" since the P03 flip). */
  buildDefault?: EngineImplId;
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

/**
 * The compiled-in default impl since the P4 default flip (delivered by P03): a mount
 * with no kill switch, no url override and no stored choice lands on the owned
 * renderer. Callers wanting the historical opt-in shape pass buildDefault explicitly.
 * Mutant guard: chartEngineSelect.test.ts pins this to "mm" (A01).
 */
export const BUILD_DEFAULT_ENGINE: EngineImplId = "mm";

/**
 * Build-time kill switch: NEXT_PUBLIC_CHART_ENGINE_KILLSWITCH === "1" forces every
 * mount to "lwc" — the rollback lever for a shipped bundle (the var is inlined at
 * build, so flipping it means a rebuild). The full literal property access is
 * deliberate: it is the shape Next.js statically replaces in client bundles. Tests
 * stub it with vi.stubEnv.
 */
export function isEngineKillSwitchOn(): boolean {
  return process.env.NEXT_PUBLIC_CHART_ENGINE_KILLSWITCH === "1";
}

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
 * Storage-aware mount selector for ChartPanel (P03 default flip). Resolution goes
 * through resolveEngineImpl with buildDefault = BUILD_DEFAULT_ENGINE, then the flip's
 * persistence rules apply:
 *   - kill switch on: pure short-circuit to "lwc" — nothing is READ and nothing is
 *     WRITTEN (no storage call at all) and the url is never consulted;
 *   - valid url value: that impl wins AND persistEngineChoice(storage, impl) writes
 *     the canonical choice per browser ("?engine=lwc" stores "lwc", "?engine=mm"
 *     stores "mm" — the rollback lever and the opt-in both survive refreshes);
 *   - absent/invalid url: fall through to the stored choice, then
 *     BUILD_DEFAULT_ENGINE; an invalid url value persists NOTHING.
 * storage defaults to browserEngineStorage() — null under SSR or when the host denies
 * storage, which means "no stored value, nothing to persist". Every storage touch
 * goes through the never-throwing read/persist wrappers, so this can never take down a
 * mount. killSwitch defaults to isEngineKillSwitchOn() (build-inlined flag).
 */
export function resolveMountEngineSelection(
  search: string | null | undefined,
  storage: EngineStorage | null = browserEngineStorage(),
  killSwitch: boolean = isEngineKillSwitchOn(),
): EngineSelection {
  if (killSwitch) {
    // Deliberately constructed WITHOUT search/stored so the kill switch reads nothing
    // (resolveEngineImpl's own short-circuit already ignores both — belt and braces).
    return resolveEngineImpl({ buildDefault: BUILD_DEFAULT_ENGINE, killSwitch: true });
  }
  const selection = resolveEngineImpl({
    search: search ?? undefined,
    stored: readStoredEngine(storage),
    buildDefault: BUILD_DEFAULT_ENGINE,
  });
  if (selection.source === "url" && storage !== null) {
    persistEngineChoice(storage, selection.impl);
  }
  return selection;
}

/**
 * Impl-only convenience in front of resolveMountEngineSelection. The leading parameter
 * is the same as the F-13 opt-in selector it replaces, so existing call sites —
 * `resolveMountEngineImpl(<the page's search string>)` in components/ChartPanel.tsx —
 * compile unchanged and now see post-flip semantics: "mm" is the default, a valid url
 * choice persists, and the per-browser stored choice is consulted.
 */
export function resolveMountEngineImpl(
  search: string | null | undefined,
  storage: EngineStorage | null = browserEngineStorage(),
  killSwitch: boolean = isEngineKillSwitchOn(),
): EngineImplId {
  return resolveMountEngineSelection(search, storage, killSwitch).impl;
}

/**
 * URL query parameter of the P01-A03 live probe (docs/CHART_ENGINE_MASTERPLAN.md,
 * production acceptance "forced refusal → lwc fallback"). Only honoured together with
 * `?engine=mm`; it never affects the default / lwc mount and never touches storage.
 */
export const ENGINE_PROBE_URL_PARAM = "engineProbe";

/**
 * The option group the mm renderer declares unsupported (lib/chart-engine/options.ts
 * ALLOWED_GROUPS; `trackingMode` is an LWC-native leftover). Spread into the mount
 * options only when isRefusalProbeRequested() is true, so createEngine(…, "mm") throws
 * EngineRefusalError on the wire and ChartPanel's production fallback mounts lwc with
 * the same data and documents. lwc tolerates the group (touch crosshair exit mode).
 */
export const ENGINE_REFUSAL_PROBE_OPTIONS = { trackingMode: { exitMode: 0 } } as const;

/**
 * True only when the url selects mm (engineQueryFromUrl semantics) AND carries
 * `engineProbe=refuse` (trim + lower-case, first occurrence wins). Pure: no globals.
 */
export function isRefusalProbeRequested(search: string | null | undefined): boolean {
  if (!search) return false;
  if (engineQueryFromUrl(search) !== "mm") return false;
  const raw = new URLSearchParams(search).get(ENGINE_PROBE_URL_PARAM);
  return raw !== null && raw.trim().toLowerCase() === "refuse";
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

  const buildDefault = input.buildDefault ?? BUILD_DEFAULT_ENGINE;
  return {
    impl: buildDefault,
    source: "default",
    reason: `build default ${buildDefault}`,
    invalid,
  };
}

/**
 * Read the persisted preference. Returns the raw stored string (canonical or garbage —
 * resolveEngineImpl decides), or null when absent/unreadable — including the
 * `storage === null` case (no host storage: SSR or denied access, the shape
 * browserEngineStorage() returns for both). Never throws: hosts can deny storage
 * (private mode), which must not take down a chart mount.
 */
export function readStoredEngine(storage: EngineStorage | null): string | null {
  if (storage === null) return null;
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
