/**
 * sectorLegacyMap.ts — pure legacy-destination compatibility map for Sector Intelligence.
 *
 * Implements the exact 24-anchor legacy table (21 literal entries + 3 S2 nested additions)
 * and runtime identity forms from Round 3 Architecture Contract Appendix A
 * (`templates/si_workspace.js` + `INTEGRATION_CONTRACT.md`).
 *
 * Pure and synchronous: no React, no DOM, never throws on any input.
 */

/**
 * The six legacy view meanings exactly as Appendix A (`templates/si_workspace.js`) names them.
 * Additive candidate surfaces (such as Cycles) are represented via `routedTo` / `job` without
 * redefining this six-view union (R3A-80).
 */
export const LEGACY_VIEWS = [
  "overview",
  "map",
  "moving",
  "money",
  "explore",
  "confluence",
] as const;

export type LegacyView = (typeof LEGACY_VIEWS)[number];

/** Canonical destination jobs in the unified Sector Intelligence workspace. */
export type LegacyJob = "brief" | "explore" | "research" | "watches" | "cycles";

/** The 24 exact static anchor keys from Appendix A (21 literal + 3 S2 additions). */
export type LegacyAnchorKey =
  | "actnow-section"
  | "regime"
  | "grader"
  | "si-map"
  | "rotmap-section"
  | "sc-cyclemap"
  | "board"
  | "si-movement"
  | "rc-events-mount"
  | "rotation-app"
  | "si-money"
  | "internals-section"
  | "scc-leadership"
  | "explore-section"
  | "table-section"
  | "chart-section"
  | "forming-narratives"
  | "tm-mount"
  | "confluence"
  | "sc-app"
  | "sc-top"
  | "accumulation-section"
  | "si-heat-section"
  | "si-measured";

export interface LegacySubject {
  kind: "theme" | "sector" | "name" | "read" | "generation";
  id?: string;
  signature?: string;
}

export interface LegacyDestination {
  /** One of the six legacy view meanings from Appendix A. */
  view: LegacyView;
  /** Canonical job in the unified workspace ("brief" | "explore" | "research" | "watches" | "cycles"). */
  job: LegacyJob;
  /** Exact canonical destination string from Appendix A (e.g. "Explore / native calls"). */
  canonicalDestination: string;
  /** Intra-view scroll target / logical section id from Appendix A (e.g. "si-confluence", "theme-heat-section"). */
  section?: string;
  /** Matched static anchor key when resolved from the 24-row table. */
  anchor?: LegacyAnchorKey;
  /** Parsed dynamic subject identity for runtime forms (#theme-<id>, #read-<id>, #ne-<signature>, ?g=<id>, #dossier). */
  subject?: LegacySubject;
  /** True when the route is display-only market context (e.g. #accumulation-section), never an actionable call or account watchlist. */
  displayOnly?: boolean;
  /** Target surface owner: "cycles" when candidate Cycles rehome precedence applies (#sc-cyclemap, #dossier, #cycles/*), else "sector-intelligence". */
  routedTo: "sector-intelligence" | "cycles";
  /** True when a #read-<id> trace must wait for the actual board row before opening its trace (R3A-83). */
  waitForRow?: boolean;
  /** Validated Cycles state query when entering via #cycles/f=&g=&m=&w=&s=. */
  cyclesState?: string;
}

export interface LegacyAnchorSpec {
  /** Exact anchor with leading `#` as listed in Appendix A. */
  anchor: `#${LegacyAnchorKey}`;
  /** Key without leading `#`. */
  key: LegacyAnchorKey;
  /** Legacy view from column 2 of Appendix A. */
  view: LegacyView;
  /** Scroll target from column 2 of Appendix A. */
  section: string;
  /** Canonical destination verbatim from column 3 of Appendix A. */
  canonicalDestination: string;
  /** Canonical job derived from column 3 of Appendix A. */
  job: LegacyJob;
  /** Target owner ("cycles" for #sc-cyclemap rehome precedence, "sector-intelligence" otherwise). */
  routedTo: "sector-intelligence" | "cycles";
  /** Display-only context flag (true for #accumulation-section). */
  displayOnly?: boolean;
  /** Required preserved meaning verbatim from column 4 of Appendix A. */
  preservedMeaning: string;
}

/**
 * Exact 24-row legacy anchor table from Round 3 Contract Appendix A
 * (21 literal keys in `LEGACY_ANCHORS` + 3 nested keys in `LEGACY_ANCHORS_S2`).
 */
export const APPENDIX_A_ANCHOR_TABLE: readonly LegacyAnchorSpec[] = [
  {
    anchor: "#actnow-section",
    key: "actnow-section",
    view: "overview",
    section: "actnow-section",
    canonicalDestination: "Explore / native calls",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "All lanes; source trace and gated names retained",
  },
  {
    anchor: "#regime",
    key: "regime",
    view: "overview",
    section: "regime",
    canonicalDestination: "Explore / native calls / regime",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Keep rule/gate context separate from measured leadership",
  },
  {
    anchor: "#grader",
    key: "grader",
    view: "overview",
    section: "grader",
    canonicalDestination: "Explore / outcomes",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Existing nightly grader and qualification",
  },
  {
    anchor: "#si-map",
    key: "si-map",
    view: "map",
    section: "si-map",
    canonicalDestination: "Explore / sector map",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Selected universe and subject",
  },
  {
    anchor: "#rotmap-section",
    key: "rotmap-section",
    view: "map",
    section: "rotmap-section",
    canonicalDestination: "Explore / rotation",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Scatter plus accessible values",
  },
  {
    anchor: "#sc-cyclemap",
    key: "sc-cyclemap",
    view: "map",
    section: "sc-cyclemap",
    canonicalDestination: "Explore / Cycles",
    job: "cycles",
    routedTo: "cycles",
    preservedMeaning: "Candidate rehome takes precedence; retain exact cycle state",
  },
  {
    anchor: "#board",
    key: "board",
    view: "map",
    section: "board",
    canonicalDestination: "Explore / native calls",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Full sector call board; no conversion to descriptive order",
  },
  {
    anchor: "#si-movement",
    key: "si-movement",
    view: "moving",
    section: "si-movement",
    canonicalDestination: "Explore / rotation",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Movement source and horizon",
  },
  {
    anchor: "#rc-events-mount",
    key: "rc-events-mount",
    view: "moving",
    section: "rc-events-mount",
    canonicalDestination: "Explore / rotation / events",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Exact event, date and population",
  },
  {
    anchor: "#rotation-app",
    key: "rotation-app",
    view: "moving",
    section: "rotation-app",
    canonicalDestination: "Explore / rotation / groups",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Whole-market group scope and accessible equivalent",
  },
  {
    anchor: "#si-money",
    key: "si-money",
    view: "money",
    section: "si-money",
    canonicalDestination: "Explore / breadth and flows",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Real flow and participation definitions",
  },
  {
    anchor: "#internals-section",
    key: "internals-section",
    view: "money",
    section: "internals-section",
    canonicalDestination: "Explore / breadth",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Independent field coverage",
  },
  {
    anchor: "#scc-leadership",
    key: "scc-leadership",
    view: "money",
    section: "scc-leadership",
    canonicalDestination: "Explore / leadership evidence",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Qualification and self-grader remain explicit",
  },
  {
    anchor: "#explore-section",
    key: "explore-section",
    view: "explore",
    section: "explore-section",
    canonicalDestination: "Explore / themes",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Existing theme universe",
  },
  {
    anchor: "#table-section",
    key: "table-section",
    view: "explore",
    section: "table-section",
    canonicalDestination: "Explore / themes / table",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Search, sort and full population",
  },
  {
    anchor: "#chart-section",
    key: "chart-section",
    view: "explore",
    section: "chart-section",
    canonicalDestination: "Explore / compare",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Window, basis and selected series",
  },
  {
    anchor: "#forming-narratives",
    key: "forming-narratives",
    view: "explore",
    section: "forming-narratives",
    canonicalDestination: "Research / forming narratives",
    job: "research",
    routedTo: "sector-intelligence",
    preservedMeaning: "Existing deterministic model and separate AI commentary",
  },
  {
    anchor: "#tm-mount",
    key: "tm-mount",
    view: "explore",
    section: "tm-mount",
    canonicalDestination: "Explore / historical replay",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Reconstructed/observed-then distinction; historical controls",
  },
  {
    anchor: "#confluence",
    key: "confluence",
    view: "confluence",
    section: "si-confluence",
    canonicalDestination: "Explore / entry evidence",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Original universe; anchor target si-confluence",
  },
  {
    anchor: "#sc-app",
    key: "sc-app",
    view: "confluence",
    section: "sc-app",
    canonicalDestination: "Explore / entry evidence / table",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Existing selected group and filters",
  },
  {
    anchor: "#sc-top",
    key: "sc-top",
    view: "confluence",
    section: "sc-top",
    canonicalDestination: "Explore / entry evidence",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Original top section and complete table",
  },
  {
    anchor: "#accumulation-section",
    key: "accumulation-section",
    view: "moving",
    section: "accumulation-section",
    canonicalDestination: "Explore / accumulation context",
    job: "explore",
    routedTo: "sector-intelligence",
    displayOnly: true,
    preservedMeaning: "Preserve display-only accumulation evidence; not a user's saved Watch list",
  },
  {
    anchor: "#si-heat-section",
    key: "si-heat-section",
    view: "explore",
    section: "theme-heat-section",
    canonicalDestination: "Explore / theme heat",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Old target theme-heat-section remains equivalent",
  },
  {
    anchor: "#si-measured",
    key: "si-measured",
    view: "map",
    section: "si-measured",
    canonicalDestination: "Explore / measured leadership",
    job: "explore",
    routedTo: "sector-intelligence",
    preservedMeaning: "Generation/subject/horizon and source basis",
  },
] as const;

const ANCHOR_BY_KEY: ReadonlyMap<string, LegacyAnchorSpec> = new Map(
  APPENDIX_A_ANCHOR_TABLE.map((spec) => [spec.key, spec]),
);

const BARE_VIEW_DESTINATIONS: Readonly<Record<LegacyView, { job: LegacyJob; canonicalDestination: string }>> = {
  overview: { job: "brief", canonicalDestination: "Brief" },
  map: { job: "explore", canonicalDestination: "Explore / sector map" },
  moving: { job: "explore", canonicalDestination: "Explore / rotation" },
  money: { job: "explore", canonicalDestination: "Explore / breadth and flows" },
  explore: { job: "explore", canonicalDestination: "Explore / themes" },
  confluence: { job: "explore", canonicalDestination: "Explore / entry evidence" },
};

/** Default fallback destination when an input is empty, unknown, or malformed (R3A-84). */
export const DEFAULT_LEGACY_DESTINATION: Readonly<LegacyDestination> = Object.freeze({
  view: "overview",
  job: "brief",
  canonicalDestination: "Brief",
  routedTo: "sector-intelligence",
});

/** Maximum raw input length examined before fast fallback. */
const MAX_INPUT_LENGTH = 2048;

/** Conservative identity token: 1..64 ASCII alphanumeric, underscore, or hyphen characters. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Conservative Cycles query token: bounded key=value pairs for f, g, m, w, s. */
const SAFE_CYCLES_QUERY_RE = /^[A-Za-z0-9_=&.,%-]{1,256}$/;

/** Known US SPDR sector symbols for dossier sector resolution (`si_workspace.js` SPDR map). */
const SPDR_SECTORS: ReadonlySet<string> = new Set([
  "xlb",
  "xlc",
  "xle",
  "xlf",
  "xli",
  "xlk",
  "xlp",
  "xlre",
  "xlu",
  "xlv",
  "xly",
]);

function makeDefaultDestination(): LegacyDestination {
  return {
    view: "overview",
    job: "brief",
    canonicalDestination: "Brief",
    routedTo: "sector-intelligence",
  };
}

function specToDestination(spec: LegacyAnchorSpec): LegacyDestination {
  const dest: LegacyDestination = {
    view: spec.view,
    job: spec.job,
    canonicalDestination: spec.canonicalDestination,
    section: spec.section,
    anchor: spec.key,
    routedTo: spec.routedTo,
  };
  if (spec.displayOnly) {
    dest.displayOnly = true;
  }
  return dest;
}

function safeDecodeURIComponent(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function isValidIdentity(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && SAFE_ID_RE.test(value);
}

/**
 * Extract normalized `{ path, search, hash }` parts from a string or object input.
 * Returns null if any piece exceeds the safety bound or is non-coercible.
 */
function decomposeInput(
  input: unknown,
): { path: string; search: string; hash: string } | null {
  if (typeof input === "string") {
    if (input.length > MAX_INPUT_LENGTH) return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { path: "", search: "", hash: "" };
    }
    let rest = trimmed;
    let hash = "";
    const hashIdx = rest.indexOf("#");
    if (hashIdx >= 0) {
      hash = rest.slice(hashIdx + 1);
      rest = rest.slice(0, hashIdx);
    }
    let search = "";
    const queryIdx = rest.indexOf("?");
    if (queryIdx >= 0) {
      search = rest.slice(queryIdx + 1);
      rest = rest.slice(0, queryIdx);
    }
    return { path: rest, search, hash };
  }

  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const rawHash = typeof record.hash === "string" ? record.hash : "";
    const rawSearch = typeof record.search === "string" ? record.search : "";
    const rawPath = typeof record.path === "string" ? record.path : "";
    if (
      rawHash.length > MAX_INPUT_LENGTH ||
      rawSearch.length > MAX_INPUT_LENGTH ||
      rawPath.length > MAX_INPUT_LENGTH
    ) {
      return null;
    }
    const cleanHash = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
    const cleanSearch = rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch;
    return { path: rawPath, search: cleanSearch, hash: cleanHash };
  }

  return null;
}

/**
 * Parse `?g=<id>` measured-group query parameter when valid and non-duplicated.
 */
function parseMeasuredGroupQuery(search: string): string | null {
  if (!search || search.length > MAX_INPUT_LENGTH) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const allG = params.getAll("g");
  if (allG.length !== 1) return null;
  const gVal = allG[0];
  if (!isValidIdentity(gVal)) return null;
  return gVal;
}

/**
 * Check if path points to a legacy basket or sector dossier page:
 * - `basket/<id>.html`
 * - `sectors/<SYM>.html`
 */
function resolvePathSubject(
  path: string,
): { kind: "theme" | "sector"; id: string; isCycleDossier?: boolean } | null {
  if (!path) return null;
  const basketMatch = /(?:^|\/)basket\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.html$/i.exec(path);
  if (basketMatch && isValidIdentity(basketMatch[1])) {
    return { kind: "theme", id: basketMatch[1] };
  }
  const sectorMatch = /(?:^|\/)sectors\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.html$/i.exec(path);
  if (sectorMatch && isValidIdentity(sectorMatch[1])) {
    const sym = sectorMatch[1].toLowerCase();
    if (SPDR_SECTORS.has(sym)) {
      return { kind: "sector", id: sym, isCycleDossier: true };
    }
  }
  return null;
}

/**
 * Resolve any legacy Sector Intelligence URL, hash fragment, query string, or decomposed
 * `{ hash, path, search }` object into its canonical `LegacyDestination`.
 *
 * Never throws on any input (malformed percent-encoding, empty strings, huge strings,
 * script injection attempts, or unexpected runtime types).
 */
export function resolveLegacyDestination(
  input: string | { hash?: string; path?: string; search?: string },
): LegacyDestination {
  const parts = decomposeInput(input);
  if (!parts) {
    return makeDefaultDestination();
  }

  const { path, search, hash: rawHash } = parts;
  const groupFromQuery = parseMeasuredGroupQuery(search);

  // 1. Check `#cycles/...` before full-hash decode (matches `si_workspace.js:route` line 444)
  if (rawHash.startsWith("cycles/")) {
    const qs = rawHash.slice("cycles/".length);
    if (!qs || !SAFE_CYCLES_QUERY_RE.test(qs)) {
      return makeDefaultDestination();
    }
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(qs);
    } catch {
      return makeDefaultDestination();
    }
    const sym = params.get("s");
    if (sym !== null && sym !== "" && !isValidIdentity(sym)) {
      return makeDefaultDestination();
    }
    const dest: LegacyDestination = {
      view: "map",
      job: "cycles",
      canonicalDestination: "Explore / Cycles",
      section: "sc-cyclemap",
      routedTo: "cycles",
      cyclesState: qs,
    };
    if (sym) {
      dest.subject = {
        kind: SPDR_SECTORS.has(sym.toLowerCase()) ? "sector" : "theme",
        id: sym.toLowerCase(),
      };
    }
    return dest;
  }

  // Decode percent-encoded hash once; malformed encoding falls back safely.
  const decodedHash = safeDecodeURIComponent(rawHash);
  if (decodedHash === null) {
    return makeDefaultDestination();
  }

  // 2. Empty hash: check `?g=<id>` measured-group codec or path-level dossier/basket links
  if (decodedHash === "") {
    if (groupFromQuery !== null) {
      return {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore / measured leadership",
        section: "si-measured",
        anchor: "si-measured",
        subject: { kind: "sector", id: groupFromQuery },
        routedTo: "sector-intelligence",
      };
    }
    if (search.trim().length > 0) {
      // Non-empty query that failed `?g=` validation -> fallback
      return makeDefaultDestination();
    }
    const pathSubj = resolvePathSubject(path);
    if (pathSubj) {
      if (pathSubj.kind === "theme") {
        return {
          view: "explore",
          job: "explore",
          canonicalDestination: "Explore → theme/basket detail",
          section: "explore-section",
          subject: { kind: "theme", id: pathSubj.id },
          routedTo: "sector-intelligence",
        };
      }
      return {
        view: "map",
        job: "explore",
        canonicalDestination: "Explore → sector dossier",
        section: "si-map",
        subject: { kind: "sector", id: pathSubj.id },
        routedTo: "sector-intelligence",
      };
    }
    return makeDefaultDestination();
  }

  // 3. Old `#theme-heat-section` target remains equivalent to `#si-heat-section` (Appendix A row 23).
  // Must precede the `#theme-<id>` prefix check so `theme-heat-section` is not swallowed as a theme id.
  if (decodedHash === "theme-heat-section") {
    const heatSpec = ANCHOR_BY_KEY.get("si-heat-section")!;
    return specToDestination(heatSpec);
  }

  // 4. Runtime family 1: `#theme-<id>` (R3A-10, R3A-82)
  if (decodedHash.startsWith("theme-")) {
    const themeId = decodedHash.slice("theme-".length);
    if (!isValidIdentity(themeId)) {
      return makeDefaultDestination();
    }
    return {
      view: "explore",
      job: "explore",
      canonicalDestination: "Explore → theme/basket detail",
      section: "explore-section",
      subject: { kind: "theme", id: themeId },
      routedTo: "sector-intelligence",
    };
  }

  // 5. Runtime family 2: `#read-<id>` (R3A-83 — waits for actual row and opens trace)
  if (decodedHash.startsWith("read-")) {
    const readId = decodedHash.slice("read-".length);
    if (!isValidIdentity(readId)) {
      return makeDefaultDestination();
    }
    return {
      view: "overview",
      job: "explore",
      canonicalDestination: "Explore / native calls",
      section: "actnow-section",
      subject: { kind: "read", id: readId },
      routedTo: "sector-intelligence",
      waitForRow: true,
    };
  }

  // 6. Runtime family 3: `#ne-<signature>` (forming narrative card deep link)
  if (decodedHash.startsWith("ne-")) {
    const signature = decodedHash.slice("ne-".length);
    if (!isValidIdentity(signature)) {
      return makeDefaultDestination();
    }
    return {
      view: "explore",
      job: "research",
      canonicalDestination: "Research / forming narratives",
      section: "forming-narratives",
      subject: { kind: "name", signature },
      routedTo: "sector-intelligence",
    };
  }

  // 7. Candidate Cycles / dossier precedence (`REHOME` in `si_workspace.js`: `#dossier`, `#dossier/<id>`, `#cycle`, `#cycles`)
  if (decodedHash === "dossier" || decodedHash === "cycles" || decodedHash === "cycle") {
    const pathSubj = resolvePathSubject(path);
    const dest: LegacyDestination = {
      view: "map",
      job: "cycles",
      canonicalDestination: "Explore / Cycles",
      section: "sc-cyclemap",
      routedTo: "cycles",
    };
    if (pathSubj) {
      dest.subject = { kind: pathSubj.kind, id: pathSubj.id };
    } else if (groupFromQuery !== null) {
      dest.subject = { kind: "sector", id: groupFromQuery };
    }
    return dest;
  }

  if (decodedHash.startsWith("dossier-") || decodedHash.startsWith("dossier/")) {
    const dossierId = decodedHash.slice("dossier-".length);
    if (!isValidIdentity(dossierId)) {
      return makeDefaultDestination();
    }
    return {
      view: "map",
      job: "cycles",
      canonicalDestination: "Explore / Cycles",
      section: "sc-cyclemap",
      subject: { kind: "sector", id: dossierId.toLowerCase() },
      routedTo: "cycles",
    };
  }

  // 8. Old `#si-confluence` target remains equivalent to `#confluence` (Appendix A row 19)
  if (decodedHash === "si-confluence") {
    const confSpec = ANCHOR_BY_KEY.get("confluence")!;
    return specToDestination(confSpec);
  }

  // 9. Exact 24-row static table lookup
  const matchedSpec = ANCHOR_BY_KEY.get(decodedHash);
  if (matchedSpec) {
    const dest = specToDestination(matchedSpec);
    if (
      (matchedSpec.key === "si-measured" || matchedSpec.key === "si-map") &&
      groupFromQuery !== null
    ) {
      dest.subject = { kind: "sector", id: groupFromQuery };
    }
    return dest;
  }

  // 10. Direct legacy view hashes (`#overview`, `#map`, `#moving`, `#money`, `#explore`, `#confluence` — note `#confluence` is in table above)
  if ((LEGACY_VIEWS as readonly string[]).includes(decodedHash)) {
    const view = decodedHash as LegacyView;
    const bare = BARE_VIEW_DESTINATIONS[view];
    const dest: LegacyDestination = {
      view,
      job: bare.job,
      canonicalDestination: bare.canonicalDestination,
      routedTo: "sector-intelligence",
    };
    if (view === "map" && groupFromQuery !== null) {
      dest.section = "si-measured";
      dest.subject = { kind: "sector", id: groupFromQuery };
    }
    return dest;
  }

  // 11. Unknown / malformed hash -> safe default fallback (Brief / overview)
  return makeDefaultDestination();
}
