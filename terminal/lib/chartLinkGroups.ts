// Chart link groups (E09) — the pure model behind the per-pane link control.
//
// A multi-pane user can put charts into small named groups (A/B/C) and choose, per group, whether
// the group shares the CROSSHAIR and/or the VISIBLE WINDOW. This module owns only that choice and
// its projection onto the existing pane-sync bus (`lib/paneSync.ts` → `setPaneLinks`). It owns no
// chart state, no registration and no second bus: every mirrored crosshair and window still travels
// through paneSync's calendar-time conversion and echo bookkeeping.
//
// What a link group is NOT:
//   • not a security context. The active-security context (#821, `WorkspaceContextSession`, group
//     `active_security`) has one native owner; nothing here reads, registers with or publishes to it,
//     and changing a pane's group never changes which pane is active or which symbol any pane shows;
//   • not a timeframe bridge. A group whose members do not share one timeframe is REFUSED as a whole
//     and says so — paneSync mirrors by calendar time between same-timeframe panes only, and this
//     model never pretends otherwise;
//   • not part of the frozen `workspace_layout.v1` schema. A saved layout still carries the single
//     `sync` boolean (`projectLegacySync`), and loading one maps it back deterministically
//     (`legacyLinkState`). Custom groups persist only in this device's `mm.ws` workspace.

import type { PaneLink } from "./paneSync";

export const LINK_GROUPS = ["A", "B", "C"] as const;
export type LinkGroupId = (typeof LINK_GROUPS)[number];
export type LinkDimension = "crosshair" | "window";
export type GroupShare = { crosshair: boolean; window: boolean };

/** Device-persisted link choice. `panes[i]` is pane slot i's group, `null` = independent. */
export type ChartLinkState = {
  v: 1;
  panes: (LinkGroupId | null)[];
  share: Record<LinkGroupId, GroupShare>;
};

/**
 * Why a group does (or does not) synchronise right now. Exactly one applies:
 *   active             ≥2 registered members on one timeframe, sharing at least one dimension;
 *   waiting            the plan is live but fewer than two members have chart data registered yet;
 *   alone              only one pane is in the group — nothing to synchronise with;
 *   nothing_shared     both dimensions are switched off for the group;
 *   mixed_timeframes   members are on different timeframes — refused, never bridged;
 *   timeframe_unknown  a member's timeframe is not known — refused rather than guessed.
 */
export type LinkGroupStatus =
  | "active"
  | "waiting"
  | "alone"
  | "nothing_shared"
  | "mixed_timeframes"
  | "timeframe_unknown";

export type LinkGroupView = {
  id: LinkGroupId;
  members: number[];
  share: GroupShare;
  status: LinkGroupStatus;
  timeframes: string[];
};

export type LinkPaneView = {
  idx: number;
  group: LinkGroupId | null;
  /** `independent` for an unlinked pane; otherwise its group's status, or `waiting` while this pane has no chart data registered. */
  status: LinkGroupStatus | "independent";
};

export type ChartLinkView = {
  groups: LinkGroupView[];
  panes: LinkPaneView[];
  /** Exactly what `setPaneLinks` should apply: only members of live (active/waiting) groups. */
  plan: Record<number, PaneLink>;
  /** Any group is live — the toolbar's legacy "Sync" indicator. */
  anyLinked: boolean;
};

const BOTH: GroupShare = Object.freeze({ crosshair: true, window: true });

function isGroupId(v: unknown): v is LinkGroupId {
  return typeof v === "string" && (LINK_GROUPS as readonly string[]).includes(v);
}

function defaultShares(): Record<LinkGroupId, GroupShare> {
  return { A: { ...BOTH }, B: { ...BOTH }, C: { ...BOTH } };
}

function paneCountOf(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The deterministic legacy mapping: `sync=true` puts every pane in group A sharing both dimensions
 * (exactly the old global behaviour); `sync=false` leaves every pane independent.
 */
export function legacyLinkState(sync: boolean, paneCount: number): ChartLinkState {
  const n = paneCountOf(paneCount);
  return { v: 1, panes: Array.from({ length: n }, () => (sync ? "A" : null)), share: defaultShares() };
}

/**
 * Validate a persisted link state. Anything that is not a recognisable v1 record returns `null`, and
 * the caller falls back to the legacy `sync` mapping — never to a guessed group. Within a valid
 * record, an unknown pane entry is independent and a missing/non-boolean share flag is "on" (the
 * group default), so one damaged field cannot silently join panes that were never linked.
 */
export function normalizeLinkState(raw: unknown, paneCount: number): ChartLinkState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { v?: unknown; panes?: unknown; share?: unknown };
  if (r.v !== 1 || !Array.isArray(r.panes)) return null;
  const n = paneCountOf(paneCount);
  const rawPanes = r.panes as unknown[];
  const panes = Array.from({ length: n }, (_, i): LinkGroupId | null => {
    const g = rawPanes[i];
    return isGroupId(g) ? g : null;
  });
  const share = defaultShares();
  if (r.share && typeof r.share === "object" && !Array.isArray(r.share)) {
    for (const g of LINK_GROUPS) {
      const s = (r.share as Record<string, unknown>)[g];
      if (!s || typeof s !== "object") continue;
      const { crosshair, window } = s as { crosshair?: unknown; window?: unknown };
      share[g] = {
        crosshair: typeof crosshair === "boolean" ? crosshair : true,
        window: typeof window === "boolean" ? window : true,
      };
    }
  }
  return { v: 1, panes, share };
}

/** Keep only the listed original pane slots, in order (a restore that dropped unknown symbols). */
export function pickLinkPanes(state: ChartLinkState, slots: readonly number[]): ChartLinkState {
  return { ...state, panes: slots.map((i) => state.panes[i] ?? null) };
}

/**
 * Fit a state to a new pane count: removed slots leave their group, NEW slots start independent.
 * Returns the same object when nothing changes so a React state setter can bail out.
 */
export function fitLinkState(state: ChartLinkState, paneCount: number): ChartLinkState {
  const n = paneCountOf(paneCount);
  if (state.panes.length === n) return state;
  return { ...state, panes: Array.from({ length: n }, (_, i) => state.panes[i] ?? null) };
}

export function assignPaneGroup(state: ChartLinkState, idx: number, group: LinkGroupId | null): ChartLinkState {
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.panes.length) return state;
  if (group !== null && !isGroupId(group)) return state;
  if (state.panes[idx] === group) return state;
  const panes = state.panes.slice();
  panes[idx] = group;
  return { ...state, panes };
}

export function setGroupShare(state: ChartLinkState, group: LinkGroupId, dim: LinkDimension, on: boolean): ChartLinkState {
  if (!isGroupId(group) || state.share[group][dim] === on) return state;
  return { ...state, share: { ...state.share, [group]: { ...state.share[group], [dim]: on } } };
}

/**
 * The single `sync` boolean a saved layout (frozen `workspace_layout.v1`) can carry: `true` only
 * when the state IS the legacy all-linked shape — every pane in one group sharing both dimensions.
 * Any narrower grouping saves as `false` rather than over-claiming a global link it does not have.
 */
export function projectLegacySync(state: ChartLinkState, paneCount: number): boolean {
  const n = paneCountOf(paneCount);
  if (!n) return false;
  const first = state.panes[0] ?? null;
  if (!first) return false;
  for (let i = 0; i < n; i++) if ((state.panes[i] ?? null) !== first) return false;
  return state.share[first].crosshair && state.share[first].window;
}

/**
 * Resolve the state against the panes that exist now. `registered` is the set of pane ids paneSync
 * currently holds (chart data loaded); when omitted, every member counts as registered.
 */
export function chartLinkView(
  state: ChartLinkState,
  paneTfs: readonly (string | null | undefined)[],
  paneCount: number,
  registered?: ReadonlySet<number> | null,
): ChartLinkView {
  const n = paneCountOf(paneCount);
  const isRegistered = (i: number) => !registered || registered.has(i);
  const groups: LinkGroupView[] = [];
  const plan: Record<number, PaneLink> = {};
  const statusOf = new Map<LinkGroupId, LinkGroupStatus>();

  for (const id of LINK_GROUPS) {
    const members: number[] = [];
    for (let i = 0; i < n; i++) if (state.panes[i] === id) members.push(i);
    if (!members.length) continue;
    const share = { ...state.share[id] };
    const tfs = members.map((i) => (typeof paneTfs[i] === "string" ? (paneTfs[i] as string) : ""));
    const timeframes = [...new Set(tfs.filter(Boolean))];
    let status: LinkGroupStatus;
    if (members.length < 2) status = "alone";
    else if (!share.crosshair && !share.window) status = "nothing_shared";
    else if (tfs.some((tf) => !tf)) status = "timeframe_unknown";
    else if (timeframes.length > 1) status = "mixed_timeframes";
    else status = members.filter(isRegistered).length >= 2 ? "active" : "waiting";
    if (status === "active" || status === "waiting") {
      for (const i of members) plan[i] = { group: id, crosshair: share.crosshair, window: share.window };
    }
    statusOf.set(id, status);
    groups.push({ id, members, share, status, timeframes });
  }

  const panes: LinkPaneView[] = Array.from({ length: n }, (_, idx) => {
    const group = state.panes[idx] ?? null;
    if (!group) return { idx, group: null, status: "independent" as const };
    const status = statusOf.get(group) ?? "alone";
    return { idx, group, status: status === "active" && !isRegistered(idx) ? "waiting" : status };
  });

  return { groups, panes, plan, anyLinked: Object.keys(plan).length > 0 };
}
