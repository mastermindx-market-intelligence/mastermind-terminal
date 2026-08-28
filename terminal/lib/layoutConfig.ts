// ── The Saved Layout contract (versioned) ───────────────────────────────────────────────────────
// What a "Saved Layout" claims to be is the chart workspace it was saved from. It was not: the
// stored config carried ten fields and the workspace has more than that, so loading a layout
// reproduced part of it and left the rest at whatever happened to be on screen.
//
// Measured gaps in the shipped v1 config (`panes, paneTfs, activePane, tf, chartType, inds, favTF,
// compare, compareCfg, lockedVLine`):
//
//   * `sync`      — NOT saved. Save a synchronised two-pane workspace, turn Sync off, load the
//                   layout: it comes back unsynchronised. `mm.ws` (the local workspace store)
//                   already persisted `sync`, so the layout was storing LESS than the device did.
//   * `split`     — NOT saved. Load derived it from pane count, so the explicit grid the user chose
//                   was reconstructed by inference rather than restored.
//   * `indParams` — NOT saved. A layout re-enabled its indicators but ran them on whatever
//                   parameters were current, so an EMA(20) layout loaded as EMA(50) after the user
//                   had edited the input. The layout enabled the right studies and computed
//                   different numbers.
//   * `hidden`    — NOT saved. A module hidden behind the eye came back visible (and vice versa).
//
// ── What this contract deliberately does NOT own ──
// A Saved Layout is a WORKSPACE ARRANGEMENT, not a snapshot of every state atom the Terminal holds.
// Ruled out, each for a reason, not by omission:
//
//   * timeframe favourites (`favTF`) — a device/toolbar personalisation, persisted per device in
//     `mm.favTF`. v1 stored and re-applied it, so loading a colleague's-era layout silently
//     rewrote your timeframe bar. DROPPED from the contract, and ignored when reading a v1 config.
//   * drawings — they have their own per-symbol persistence plane (the drawings API, owner-keyed).
//     `0001_init.sql`'s column comment still says layouts hold "drawings"; that comment predates
//     the drawing plane and is stale. Duplicating drawing authority into layouts would give one
//     drawing two owners and a last-writer-wins conflict.
//   * drawing style preferences — device preference, same reasoning as favourites.
//   * watchlist state — account data with its own tables; a layout is not a watchlist.
//   * Day Trade Mode — a MODE with its own snapshot/restore state machine (`mm.dtm`,
//     `mm.dtmSnapshot`). A layout that also flipped the mode flag would race that machine and could
//     strand the pre-mode snapshot, making the toggle-off unable to restore the swing workspace.
//   * the symbol's drawings, alerts, and live-data settings — not workspace arrangement.
//
// ── Versioning and the read boundary ──
// Every config is normalised on read. A field a v1 config never owned normalises to `null`, which
// means "this layout makes no claim — leave the current workspace value alone", NOT "reset it to a
// default". That distinction is what keeps an old layout STABLE across loads: reinterpreting a
// missing field as the live value would make the same layout restore differently every time.
// Unknown fields from a future version are ignored, and a malformed value falls back per field
// rather than throwing — a bad row must never make the menu unusable.

export const LAYOUT_SCHEMA_VERSION = 2;

export type ParamMap = Record<string, Record<string, unknown>>;
export type CompareCfgMap = Record<string, unknown>;

/** The workspace fields a layout owns, as the shell holds them. */
export type LayoutWorkspace = {
  panes: string[];
  paneTfs: string[];
  split: number;
  activePane: number;
  sync: boolean;
  chartType: string;
  inds: string[];
  indParams: ParamMap;
  hidden: string[];
  compare: string[];
  compareCfg: CompareCfgMap;
  lockedVLine: string | null;
};

export type LayoutConfigV2 = LayoutWorkspace & { schemaVersion: typeof LAYOUT_SCHEMA_VERSION };

/** A config after the read boundary. `null` = the layout makes no claim about that field. */
export type NormalizedLayout = {
  schemaVersion: number;
  panes: string[] | null;
  paneTfs: string[] | null;
  split: number | null;
  activePane: number | null;
  sync: boolean | null;
  chartType: string | null;
  inds: string[] | null;
  indParams: ParamMap | null;
  hidden: string[] | null;
  compare: string[] | null;
  compareCfg: CompareCfgMap | null;
  lockedVLine: string | null | undefined;
};

const VALID_SPLITS = [1, 2, 4];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  // An EMPTY array is a legitimate claim ("this layout has no indicators"). An array that held
  // entries but none survived is corruption, and corruption must claim nothing rather than assert
  // emptiness — the same unavailable-is-not-empty rule the storage layer runs on.
  return out.length === 0 && v.length > 0 ? null : out;
};
const paramMap = (v: unknown): ParamMap | null => {
  if (!isRecord(v)) return null;
  const out: ParamMap = {};
  for (const [k, val] of Object.entries(v)) if (isRecord(val)) out[k] = { ...val };
  return out;
};
/** Sorted so two workspaces with the same membership serialise identically (set order is not state). */
const sortedUnique = (list: string[]): string[] => [...new Set(list)].sort();

const splitForPanes = (count: number): number => (count >= 4 ? 4 : count >= 2 ? 2 : 1);

/**
 * Capture the current workspace as a v2 config.
 *
 * `indParams` and `compareCfg` are restricted to what the layout actually activates: a layout owns
 * the parameters of the studies IT enables, not the user's whole device-wide parameter store. That
 * keeps the payload proportional to the layout and makes the round-trip exact.
 */
export function captureLayoutConfig(ws: LayoutWorkspace): LayoutConfigV2 {
  const panes = [...ws.panes];
  const inds = sortedUnique(ws.inds);
  const compare = [...ws.compare];
  const indParams: ParamMap = {};
  for (const key of inds) if (isRecord(ws.indParams?.[key])) indParams[key] = { ...ws.indParams[key] };
  const compareCfg: CompareCfgMap = {};
  for (const sym of compare) if (ws.compareCfg?.[sym] !== undefined) compareCfg[sym] = ws.compareCfg[sym];
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    panes,
    paneTfs: panes.map((_, i) => ws.paneTfs[i] ?? ws.paneTfs[0] ?? "D"),
    split: VALID_SPLITS.includes(ws.split) ? ws.split : splitForPanes(panes.length),
    activePane: Math.min(Math.max(0, ws.activePane | 0), Math.max(0, panes.length - 1)),
    sync: !!ws.sync,
    chartType: ws.chartType,
    inds,
    indParams,
    hidden: sortedUnique(ws.hidden),
    compare,
    compareCfg,
    lockedVLine: typeof ws.lockedVLine === "string" ? ws.lockedVLine : null,
  };
}

/**
 * The read boundary: any stored config (v1, v2, malformed, or from a future version) becomes a
 * NormalizedLayout. Never throws.
 */
export function normalizeLayoutConfig(raw: unknown): NormalizedLayout {
  const c = isRecord(raw) ? raw : {};
  const version = typeof c.schemaVersion === "number" && Number.isFinite(c.schemaVersion) ? c.schemaVersion : 1;
  const legacy = version < 2;

  // v1 back-compat: some very old configs stored a single `active` symbol instead of `panes`.
  let panes = strings(c.panes);
  if ((!panes || !panes.length) && typeof c.active === "string" && c.active) panes = [c.active];
  if (panes && !panes.length) panes = null;

  const fallbackTf = typeof c.tf === "string" && c.tf ? c.tf : "D";
  let paneTfs = strings(c.paneTfs);
  if (panes && (!paneTfs || paneTfs.length !== panes.length)) paneTfs = panes.map((_, i) => paneTfs?.[i] ?? fallbackTf);
  if (!panes) paneTfs = null;

  const rawSplit = typeof c.split === "number" ? c.split : null;
  const split = rawSplit !== null && VALID_SPLITS.includes(rawSplit)
    ? rawSplit
    // v1 never stored the grid. Deriving it from pane count is the SAME rule the old loader used,
    // so a v1 layout keeps loading exactly as it always did — and it is a fixed function of stored
    // data, not of the live workspace, so it is stable across loads.
    : (panes ? splitForPanes(panes.length) : null);

  return {
    schemaVersion: version,
    panes,
    paneTfs,
    split,
    activePane: typeof c.activePane === "number" && Number.isFinite(c.activePane) ? Math.max(0, c.activePane | 0) : null,
    // v1 never stored Sync. A FIXED compatibility default (the app default, on) — never the live
    // value, which would make the same layout restore differently depending on when it was loaded.
    // Gated on `panes`: the default belongs to a RECOGNISABLE v1 layout, not to junk. A config that
    // carries no workspace at all claims nothing, so it must not silently switch Sync back on.
    sync: typeof c.sync === "boolean" ? c.sync : (legacy && panes ? true : null),
    chartType: typeof c.chartType === "string" && c.chartType ? c.chartType : null,
    inds: strings(c.inds),
    // v1 owned neither of these, so it must not reset them: `null` leaves the user's current
    // parameters and eye state alone rather than silently reverting them to defaults.
    indParams: paramMap(c.indParams),
    hidden: strings(c.hidden),
    compare: strings(c.compare),
    compareCfg: isRecord(c.compareCfg) ? { ...c.compareCfg } : null,
    lockedVLine: typeof c.lockedVLine === "string" ? c.lockedVLine : (c.lockedVLine === null ? null : undefined),
  };
}

/**
 * Fold a normalised layout onto the current workspace, producing the workspace the user should see.
 * Pure, so the round-trip contract is a unit test rather than a DOM crawl.
 */
export function applyLayoutConfig(layout: NormalizedLayout, current: LayoutWorkspace): LayoutWorkspace {
  const panes = layout.panes ?? current.panes;
  const paneTfs = layout.panes
    ? (layout.paneTfs ?? panes.map(() => "D"))
    : current.paneTfs;
  const inds = layout.inds ?? current.inds;
  return {
    panes,
    paneTfs,
    split: layout.split ?? (layout.panes ? splitForPanes(panes.length) : current.split),
    activePane: Math.min(layout.activePane ?? current.activePane, Math.max(0, panes.length - 1)),
    sync: layout.sync ?? current.sync,
    chartType: layout.chartType ?? current.chartType,
    inds,
    // Merge, don't replace: the layout owns the parameters of the studies it enables; parameters for
    // everything else stay as the user has them on this device.
    indParams: layout.indParams ? { ...current.indParams, ...layout.indParams } : current.indParams,
    hidden: layout.hidden ?? current.hidden,
    compare: layout.compare ?? current.compare,
    compareCfg: layout.compareCfg ?? current.compareCfg,
    lockedVLine: layout.lockedVLine === undefined ? current.lockedVLine : layout.lockedVLine,
  };
}
