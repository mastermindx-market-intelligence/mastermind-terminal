import type { ThesisDetail, ThesisLifecycle, ThesisSummary } from "@/lib/theses";

export type RmsViewId = "coverage" | "ideas" | "notes" | "theses" | "catalysts" | "risks" | "reviews";
export type RmsGrain = "subject" | "thesis" | "line";

export type RmsViewDef = {
  id: RmsViewId;
  grain: RmsGrain;
  /** true = the lens reads version content, so it depends on bounded hydration. */
  requiresContent: boolean;
};

/** Frozen order — this is the reading order of the rail and is part of the design. */
export const RMS_VIEWS: readonly RmsViewDef[] = [
  { id: "coverage", grain: "subject", requiresContent: false },
  { id: "ideas", grain: "thesis", requiresContent: false },
  { id: "theses", grain: "thesis", requiresContent: false },
  { id: "reviews", grain: "thesis", requiresContent: false },
  { id: "catalysts", grain: "line", requiresContent: true },
  { id: "risks", grain: "line", requiresContent: true },
  { id: "notes", grain: "line", requiresContent: true },
];
export const RMS_DEFAULT_VIEW: RmsViewId = "theses";
export const RMS_REVIEW_STALE_DAYS = 90;
/** Tighter "check on this" cadence for the saved-view Stale preset. Kept
 *  separate from RMS_REVIEW_STALE_DAYS (90), which the Reviews lens uses. */
export const RMS_SAVED_VIEW_STALE_DAYS = 30;
export const RMS_HYDRATION_BATCH = 10; // must equal the route's ids cap
/** Must equal MAX_IDS in app/api/thesis-fire-status/route.ts. Round-2 review
 *  (Opus MAJOR 2 / Grok minor 1): the client read every id in batches of this size
 *  instead of truncating at the first 50, which silently dropped theses 51..199
 *  out of the one preset that exists to surface a closed window. */
export const RMS_FIRE_STATUS_BATCH = 50;
export const MAX_SAVED_VIEWS = 50;
export const MAX_SAVED_VIEW_NAME = 80;

export type ViewFilter = {
  lifecycle: "active" | "any";
  staleDays?: number;
  windowClosed?: boolean;
  subjectGroupKey?: string;
};

export type SavedView = {
  id: string;
  name: string;
  filter: ViewFilter;
  createdAt: string;
  updatedAt: string;
};

export type BuiltinViewId = "mine" | "stale_30" | "window_closed";

export type BuiltinViewDef = {
  id: BuiltinViewId;
  filter: ViewFilter;
};

/** Frozen order. Team is absent in v1 (seat ruling R5). */
export const BUILTIN_VIEWS: readonly BuiltinViewDef[] = [
  { id: "mine", filter: { lifecycle: "active" } },
  { id: "stale_30", filter: { lifecycle: "active", staleDays: RMS_SAVED_VIEW_STALE_DAYS } },
  // Round-2 review (Opus minor 1 / Grok minor 4): spec 2.2 defaults lifecycle to
  // "active"; shipping "any" let archived and invalidated theses into the preset.
  { id: "window_closed", filter: { windowClosed: true, lifecycle: "active" } },
];

export type CoverageRow = {
  key: string;
  display: string;
  kind: "issuer" | "theme";
  theses: number;
  active: number;
  latestUpdatedAt: string;
};
export type ThesisRow = {
  id: string;
  title: string;
  subjectDisplay: string;
  subjectKey: string;
  /** Composite owner|kind|key — matches CoverageRow.key so the Coverage lens filter can select a subject unambiguously. */
  subjectGroupKey: string;
  lifecycleState: ThesisLifecycle;
  currentVersion: number;
  updatedAt: string;
  reason?: ReviewReason;
};
export type LineRow = {
  thesisId: string;
  thesisTitle: string;
  subjectKey: string;
  text: string;
  at: string;
  version: number;
  index: number;
};
export type ReviewReason = "archived" | "invalidated" | "stale" | "window_closed";

export type ConditionState =
  | { source: "unavailable" }
  | { source: "monitor"; state: "open" | "window_closed"; at: string };

/** Today the F11 monitor exposes no owner-scoped read boundary, so this returns
 *  "unavailable" for every thesis. When macro#6918 ships one, ONLY this function binds. */
export function readConditionStates(
  ids: readonly string[],
  reader?: (id: string) => ConditionState | undefined,
): Map<string, ConditionState> {
  const map = new Map<string, ConditionState>();
  for (const id of ids) map.set(id, (reader && reader(id)) ?? { source: "unavailable" });
  return map;
}

const THESIS_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRE_STATUSES = new Set(["pending", "deferred", "sent"]);

export type OutboxRow = {
  payload: unknown;
  status?: unknown;
  created_at?: unknown;
};

function wellFormedThesisId(value: unknown): value is string {
  return typeof value === "string" && THESIS_ID_UUID.test(value);
}

/** Turns owner-scoped alert_outbox rows into ConditionState. A thesis with no
 *  matching row stays unavailable — never "open". Payload must be an object
 *  with a well-formed thesis_id UUID; anything else is skipped. */
export function mapOutboxToConditionStates(
  ids: readonly string[],
  rows: readonly OutboxRow[],
): Map<string, ConditionState> {
  const wanted = new Set(ids);
  const closedAt = new Map<string, string>();
  for (const row of rows) {
    const payload = row.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const thesisId = (payload as Record<string, unknown>).thesis_id;
    if (!wellFormedThesisId(thesisId) || !wanted.has(thesisId)) continue;
    if (!FIRE_STATUSES.has(typeof row.status === "string" ? row.status : "")) continue;
    const at = typeof row.created_at === "string" && row.created_at ? row.created_at : "";
    const previous = closedAt.get(thesisId);
    if (previous === undefined || at > previous) closedAt.set(thesisId, at);
  }
  return readConditionStates(ids, (id) => {
    const at = closedAt.get(id);
    return at === undefined ? undefined : { source: "monitor", state: "window_closed", at };
  });
}

/** Splits ids into route-sized batches. Pure; every id lands in exactly one batch. */
export function fireStatusBatches(
  ids: readonly string[],
  batch: number = RMS_FIRE_STATUS_BATCH,
): string[][] {
  const size = Math.max(1, Math.floor(batch));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function applyViewFilter(
  rows: readonly ThesisSummary[],
  filter: ViewFilter,
  conditions: Map<string, ConditionState>,
  now: Date,
): ThesisSummary[] {
  const lifecycle = filter.lifecycle ?? "active";
  const staleMs = typeof filter.staleDays === "number" && Number.isFinite(filter.staleDays) && filter.staleDays > 0
    ? filter.staleDays * 24 * 60 * 60 * 1000
    : null;
  return rows.filter((row) => {
    if (lifecycle === "active" && row.lifecycleState !== "active") return false;
    if (filter.subjectGroupKey) {
      const key = `${row.subject.owner}|${row.subject.kind}|${row.subject.key}`;
      if (key !== filter.subjectGroupKey) return false;
    }
    if (staleMs !== null) {
      const updated = new Date(row.updatedAt).getTime();
      if (!Number.isFinite(updated) || now.getTime() - updated < staleMs) return false;
    }
    if (filter.windowClosed) {
      const cond = conditions.get(row.id);
      if (!(cond && cond.source === "monitor" && cond.state === "window_closed")) return false;
    }
    return true;
  });
}

function toThesisRow(s: ThesisSummary, reason?: ReviewReason): ThesisRow {
  return {
    id: s.id,
    title: s.title,
    subjectDisplay: s.subject.display,
    subjectKey: s.subject.key,
    subjectGroupKey: `${s.subject.owner}|${s.subject.kind}|${s.subject.key}`,
    lifecycleState: s.lifecycleState,
    currentVersion: s.currentVersion,
    updatedAt: s.updatedAt,
    reason,
  };
}

export function coverageRows(summaries: readonly ThesisSummary[]): CoverageRow[] {
  const groups = new Map<string, { display: string; kind: "issuer" | "theme"; theses: number; active: number; latestUpdatedAt: string }>();
  for (const s of summaries) {
    const groupKey = `${s.subject.owner}|${s.subject.kind}|${s.subject.key}`;
    const display = s.subject.display || s.subject.key;
    let g = groups.get(groupKey);
    if (!g) {
      g = { display, kind: s.subject.kind, theses: 0, active: 0, latestUpdatedAt: s.updatedAt };
      groups.set(groupKey, g);
    }
    g.theses += 1;
    if (s.lifecycleState === "active") g.active += 1;
    if (s.updatedAt > g.latestUpdatedAt) g.latestUpdatedAt = s.updatedAt;
  }
  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, display: g.display, kind: g.kind, theses: g.theses, active: g.active, latestUpdatedAt: g.latestUpdatedAt }))
    .sort((a, b) => (a.latestUpdatedAt < b.latestUpdatedAt ? 1 : a.latestUpdatedAt > b.latestUpdatedAt ? -1 : a.key.localeCompare(b.key)));
}

export function ideaRows(summaries: readonly ThesisSummary[]): ThesisRow[] {
  return summaries
    .filter((s) => s.lifecycleState === "active" && s.currentVersion === 1)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map((s) => toThesisRow(s));
}

export function thesisRows(summaries: readonly ThesisSummary[]): ThesisRow[] {
  return [...summaries]
    .sort((a, b) => {
      const aActive = a.lifecycleState === "active" ? 0 : 1;
      const bActive = b.lifecycleState === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.title.localeCompare(b.title);
    })
    .map((s) => toThesisRow(s));
}

export function reviewRows(
  summaries: readonly ThesisSummary[],
  now: Date,
  conditions: Map<string, ConditionState>,
): ThesisRow[] {
  const staleMs = RMS_REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000;
  const rows: ThesisRow[] = [];
  for (const s of summaries) {
    const cond = conditions.get(s.id);
    let reason: ReviewReason | undefined;
    if (cond && cond.source === "monitor" && cond.state === "window_closed") reason = "window_closed";
    else if (s.lifecycleState === "archived") reason = "archived";
    else if (s.lifecycleState === "invalidated") reason = "invalidated";
    else if (s.lifecycleState === "active") {
      const updated = new Date(s.updatedAt).getTime();
      if (Number.isFinite(updated) && now.getTime() - updated >= staleMs) reason = "stale";
    }
    if (reason) rows.push(toThesisRow(s, reason));
  }
  return rows.sort((a, b) => {
    const aClosed = a.reason === "window_closed" ? 0 : 1;
    const bClosed = b.reason === "window_closed" ? 0 : 1;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
  });
}

function lineRowsFor(details: readonly ThesisDetail[], pick: (content: ThesisDetail["current"]["content"]) => string[]): LineRow[] {
  const active = details
    .filter((d) => d.lifecycleState === "active")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const rows: LineRow[] = [];
  for (const d of active) {
    const items = pick(d.current.content);
    items.forEach((text, index) => {
      rows.push({
        thesisId: d.id,
        thesisTitle: d.title,
        subjectKey: d.subject.key,
        text,
        at: d.updatedAt,
        version: d.currentVersion,
        index,
      });
    });
  }
  return rows;
}

export function catalystRows(details: readonly ThesisDetail[]): LineRow[] {
  return lineRowsFor(details, (c) => c.catalysts);
}

export function riskRows(details: readonly ThesisDetail[]): LineRow[] {
  return lineRowsFor(details, (c) => c.risks);
}

export function noteRows(details: readonly ThesisDetail[]): LineRow[] {
  const seen = new Set<string>();
  const rows: { row: LineRow; systemRecordedAt: string }[] = [];
  for (const d of details) {
    const versions = [d.current, ...d.history];
    for (const v of versions) {
      const note = v.content.revisionNote;
      if (typeof note !== "string") continue;
      const trimmed = note.trim();
      if (!trimmed) continue;
      const dedupeKey = `${d.id}|${v.version}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        row: {
          thesisId: d.id,
          thesisTitle: d.title,
          subjectKey: d.subject.key,
          text: trimmed,
          at: v.systemRecordedAt,
          version: v.version,
          index: 0,
        },
        systemRecordedAt: v.systemRecordedAt,
      });
    }
  }
  return rows
    .sort((a, b) => (a.systemRecordedAt < b.systemRecordedAt ? 1 : a.systemRecordedAt > b.systemRecordedAt ? -1 : 0))
    .map((entry) => entry.row);
}

export function selectHydrationIds(
  summaries: readonly ThesisSummary[],
  loadedIds: ReadonlySet<string>,
  batch: number = RMS_HYDRATION_BATCH,
): string[] {
  return [...summaries]
    .filter((s) => !loadedIds.has(s.id))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, batch)
    .map((s) => s.id);
}

export function hydrationScope(
  summaries: readonly ThesisSummary[],
  loadedIds: ReadonlySet<string>,
): { loaded: number; total: number; complete: boolean } {
  const total = summaries.length;
  const loaded = summaries.filter((s) => loadedIds.has(s.id)).length;
  return { loaded, total, complete: total === 0 ? true : loaded >= total };
}

/** Round-2 review r3 MAJOR-2: the scope sentence must name the actual counted subset
 *  ("active theses" — the content lenses only ever hydrate the `active` subset, m5) and
 *  must not lie with a plural when there is exactly one (minor 4). */
export function formatScopeSentence(
  loaded: number,
  total: number,
  complete: boolean,
  copy: RmsCopy,
  /** Round-3 review (Meta-CEO B ruling R1): true while a built-in preset or a saved
   *  view is narrowing the list, so the counted set is the view's own active theses
   *  and the sentence must say so instead of naming the whole workspace. */
  filtered: boolean = false,
): string {
  if (complete) {
    if (filtered) {
      return total === 1
        ? copy.scopeViewCompleteSingular
        : copy.scopeViewComplete.replace("{total}", String(total));
    }
    return total === 1
      ? copy.scopeCompleteSingular
      : copy.scopeComplete.replace("{total}", String(total));
  }
  if (filtered) {
    return total === 1
      ? copy.scopeViewSingular.replace("{loaded}", String(loaded))
      : copy.scopeView.replace("{loaded}", String(loaded)).replace("{total}", String(total));
  }
  return total === 1
    ? copy.scopeSingular.replace("{loaded}", String(loaded))
    : copy.scope.replace("{loaded}", String(loaded)).replace("{total}", String(total));
}

export function conditionLine(state: ConditionState, lang: "en" | "zh"): string {
  const copy = RMS_COPY[lang];
  if (state.source === "unavailable") return copy["condition.unavailable"];
  return state.state === "window_closed" ? copy["condition.window_closed"] : copy["condition.open"];
}

export type RmsCopy = {
  lensRailLabel: string;
  name: Record<RmsViewId, string>;
  what: Record<RmsViewId, string>;
  empty: Record<RmsViewId, string>;
  reason: Record<ReviewReason, string>;
  /** {loaded}/{total} placeholders; total > 1. Names the actual counted subset — the
   *  content lenses only ever hydrate `active` theses (m5), so the sentence must say
   *  "active theses", never bare "theses" (round-2 review r3 MAJOR-2: an unqualified
   *  count reads as "all your theses" when it is really a filtered subset). */
  scope: string;
  /** {loaded} placeholder only; total === 1 (round-2 review r3 MAJOR-2 minor 4). */
  scopeSingular: string;
  /** {total} placeholder; total > 1. */
  scopeComplete: string;
  /** total === 1. */
  scopeCompleteSingular: string;
  /** Round-3 review (Meta-CEO B ruling R1): under an active built-in preset or saved
   *  view the counted set is the VIEW's active theses, not the workspace's — so the
   *  sentence may never say "all {total} active theses" / "of your {total} active
   *  theses" while a view is narrowing the list. {loaded}/{total}; total > 1. */
  scopeView: string;
  /** {loaded} placeholder only; total === 1, under an active view. */
  scopeViewSingular: string;
  /** {total} placeholder; total > 1, under an active view, fully loaded. */
  scopeViewComplete: string;
  /** total === 1, under an active view, fully loaded. */
  scopeViewCompleteSingular: string;
  /** {n} placeholder — the actual pending increment (`min(RMS_HYDRATION_BATCH,
   *  remaining)`), never a hardcoded "10" (Meta-CEO B ruling r4 minor 2: a fixed "10"
   *  read false whenever fewer than 10 theses remained). */
  showMore: string;
  unavailableLens: string;
  /** A fault on a batch AFTER the first must never read as the terminal
   *  `unavailableLens` state while earlier rows are still mounted (round-2 review r3
   *  MAJOR-1) — this is the inline, row-level notice shown under the still-visible
   *  list, distinct from `unavailableLens` (which may render only when zero rows are
   *  hydrated). {n} placeholder — same pending-increment count as `showMore` (ruling
   *  r4 minor 2). */
  hydrationFault: string;
  "condition.window_closed": string;
  "condition.open": string;
  "condition.unavailable": string;
  countUnknown: string;
  /** {active}/{theses} placeholders. */
  coverageRatio: string;
  /** {subject} placeholder. */
  filteredBySubject: string;
  /** {view} placeholder — the lens-head sentence while a built-in preset or a saved
   *  view is narrowing the list. Round-3 review (Meta-CEO B ruling R1): the head used
   *  to print `what[view]` ("Everything you have written.") over a filtered slice,
   *  which is the same false claim the subject-filter repair already closed. */
  filteredByView: string;
  /** {view} and {subject} placeholders — both filters at once. */
  filteredByViewAndSubject: string;
  clearFilter: string;
  /** {subject} placeholder — shown instead of `empty.theses` when a Coverage subject
   *  filter is active and resolves to zero rows; never claims "No theses yet." while
   *  the workspace actually holds theses (round-2 review MAJOR). */
  filteredEmpty: string;
  /** Screen-reader-only word appended to the Theses lens rail badge when a subject
   *  filter is active — the badge already shows the filtered count (round-2 review r3
   *  minor 7: the filtered count needs a marker so it does not read as the total). */
  filteredMarker: string;
  "savedViews.title": string;
  "savedViews.newView": string;
  "savedViews.namePlaceholder": string;
  "savedViews.save": string;
  "savedViews.rename": string;
  "savedViews.delete": string;
  "savedViews.confirmDelete": string;
  "savedViews.limitReached": string;
  /** Round-3 review (Meta-CEO B ruling R4): holding MORE than the cap is not the same
   *  statement as having reached it — "Delete one to save another" also pointed at a
   *  visible set that excluded the hidden rows. */
  "savedViews.truncated": string;
  /** Round-3 review (Meta-CEO B ruling R4): a name the route rejects is not a failed
   *  read. `savedViews.unavailable` is for a failed fetch/save/delete only (spec 2.8);
   *  this names the actual problem. */
  "savedViews.nameRequired": string;
  "savedViews.empty": string;
  "savedViews.unavailable": string;
  /** Round-4 review (Meta-CEO B ruling R3): a delete the route resolves as "that row
   *  is not here" is not a failed READ of a list the user is looking at. Spec 2.8
   *  reserves `savedViews.unavailable` for a failed fetch/save/delete; this names the
   *  actual outcome, and the workspace re-reads the list behind it. */
  "savedViews.alreadyRemoved": string;
  /** Shown when a SAVED view resolves to zero rows. Round-2 review BLOCKER 3: this
   *  slice used to fall through to `empty.theses` ("No theses yet."), which is false
   *  while the workspace holds theses — the spec names that exact misreport. */
  "savedViews.viewEmpty": string;
  "builtin.mine": string;
  "builtin.stale30": string;
  "builtin.staleWhat": string;
  "builtin.windowClosed": string;
  "builtin.team": string;
  "builtin.teamTooltip": string;
  "builtin.windowClosedEmpty": string;
  "builtin.mineEmpty": string;
  /** Round-2 review BLOCKER 2: the Stale preset's zero-row state used to print
   *  `builtin.staleWhat` ("No changes in 30 days."), the exact inverse of the truth —
   *  an empty Stale list means everything DID change inside the window. */
  "builtin.staleEmpty": string;
};

export const RMS_COPY: { en: RmsCopy; zh: RmsCopy } = {
  en: {
    lensRailLabel: "Views of your research",
    name: {
      coverage: "Coverage",
      ideas: "Ideas",
      theses: "Theses",
      reviews: "Worth a look",
      catalysts: "Catalysts",
      risks: "Risks",
      notes: "Revision notes",
    },
    what: {
      coverage: "What you have a view on.",
      ideas: "Written once, not revisited.",
      theses: "Everything you have written.",
      reviews: "Archived, no longer valid, or untouched for 90 days.",
      catalysts: "What you said would move these.",
      risks: "What you said could go wrong.",
      notes: "What you wrote when you changed your mind.",
    },
    empty: {
      coverage: "Nothing is covered yet. Write a thesis and its subject appears here.",
      ideas: "Nothing new is waiting. Every thesis has been revisited at least once.",
      theses: "No theses yet. Start with a view you could be wrong about.",
      reviews: "Nothing is waiting for a second look.",
      catalysts: "No catalysts written down in the theses loaded here.",
      risks: "No risks written down in the theses loaded here.",
      notes: "No revision notes yet. They appear when you save a change and say why.",
    },
    reason: {
      archived: "Archived",
      invalidated: "Marked no longer valid",
      stale: "No changes in 90 days",
      window_closed: "The window you were watching has closed",
    },
    scope: "Showing lines from {loaded} of your {total} active theses.",
    scopeSingular: "Showing lines from {loaded} of your 1 active thesis.",
    scopeComplete: "Showing lines from all {total} active theses.",
    scopeCompleteSingular: "Showing lines from all 1 active thesis.",
    scopeView: "Showing lines from {loaded} of the {total} active theses in this view.",
    scopeViewSingular: "Showing lines from {loaded} of the 1 active thesis in this view.",
    scopeViewComplete: "Showing lines from all {total} active theses in this view.",
    scopeViewCompleteSingular: "Showing lines from the 1 active thesis in this view.",
    showMore: "Show {n} more",
    // Not "Your thesis store did not answer..." — the strong heading right above this
    // paragraph already says exactly that; repeating it read as a stutter (sibling
    // repair on this branch).
    unavailableLens: "This view has nothing to show right now. Nothing has been changed.",
    hydrationFault: "{n} more could not be loaded. Try again.",
    "condition.window_closed": "The window you were watching has closed",
    "condition.open": "The window you were watching is still open.",
    "condition.unavailable": "Condition checks are not connected yet.",
    countUnknown: "—",
    coverageRatio: "{active} active of {theses} written",
    filteredBySubject: "Only what you have written about {subject}.",
    filteredByView: "Only what matches the \u201c{view}\u201d view.",
    filteredByViewAndSubject: "Only what matches the \u201c{view}\u201d view, and only about {subject}.",
    clearFilter: "Show everything",
    filteredEmpty: "Nothing written about {subject} right now. Clear the filter to see every thesis.",
    filteredMarker: "filtered",
    "savedViews.title": "Your saved views",
    "savedViews.newView": "Save this view",
    "savedViews.namePlaceholder": "Name this view",
    "savedViews.save": "Save",
    "savedViews.rename": "Rename",
    "savedViews.delete": "Delete this view",
    "savedViews.confirmDelete": "Delete this saved view? This cannot be undone.",
    "savedViews.limitReached": "You have reached the limit of 50 saved views. Delete one to save another.",
    "savedViews.truncated": "You have more than 50 saved views. The oldest are hidden until you delete some.",
    "savedViews.nameRequired": "Give this view a name before you save it.",
    "savedViews.empty": "No saved views yet. Filter the list, then save it with a name.",
    "savedViews.unavailable": "Your saved views did not load. Nothing has been changed.",
    "savedViews.alreadyRemoved": "That view was already removed.",
    "savedViews.viewEmpty": "No theses match this view.",
    // Round-4 review (Meta-CEO B ruling R7): this chip ships `lifecycle: "active"`, so
    // clicking it drops archived and invalidated theses — which the unfiltered Theses
    // lens does show. "Yours" named ownership as the cause of a lifecycle narrowing, and
    // under owner-only RLS ownership filters nothing at all. The label now says what the
    // predicate does, so the head sentence quoting it ("Only what matches the “…” view.")
    // is true.
    "builtin.mine": "Your active theses",
    "builtin.stale30": "Stale",
    "builtin.staleWhat": "No changes in 30 days.",
    "builtin.windowClosed": "Window closed",
    "builtin.team": "Team (not yet available)",
    "builtin.teamTooltip": "Team sharing for theses is not built yet.",
    "builtin.windowClosedEmpty": "Nothing has a closed window right now.",
    "builtin.mineEmpty": "Nothing here yet.",
    "builtin.staleEmpty": "Everything here changed in the last 30 days. Nothing is stale.",
  },
  zh: {
    lensRailLabel: "研究视角",
    name: {
      coverage: "覆盖范围",
      ideas: "初步想法",
      theses: "全部论点",
      reviews: "值得复看",
      catalysts: "催化因素",
      risks: "风险",
      notes: "修订记录",
    },
    what: {
      coverage: "你已有观点的标的。",
      ideas: "只写过一次，还没再动。",
      theses: "你写过的全部内容。",
      reviews: "已归档、已失效，或 90 天没动过。",
      catalysts: "你认为会推动它们的因素。",
      risks: "你认为可能出问题的地方。",
      notes: "你改变想法时写下的说明。",
    },
    empty: {
      coverage: "还没有覆盖任何标的。写下一条论点，标的就会出现在这里。",
      ideas: "没有待处理的新想法。每条论点都至少修订过一次。",
      theses: "暂无论点。从一个你可能判断错的观点开始。",
      reviews: "没有需要复看的内容。",
      catalysts: "已载入的论点中没有写下催化因素。",
      risks: "已载入的论点中没有写下风险。",
      notes: "暂无修订说明。保存修改并写下原因后会显示在这里。",
    },
    reason: {
      archived: "已归档",
      invalidated: "已标记为失效",
      stale: "90 天没有改动",
      window_closed: "你关注的观察窗口已结束",
    },
    scope: "正在显示 {total} 条活跃论点中 {loaded} 条的内容。",
    scopeSingular: "正在显示 1 条活跃论点中 {loaded} 条的内容。",
    scopeComplete: "正在显示全部 {total} 条活跃论点的内容。",
    scopeCompleteSingular: "正在显示这 1 条活跃论点的全部内容。",
    scopeView: "正在显示这个视图中 {total} 条活跃论点里 {loaded} 条的内容。",
    scopeViewSingular: "正在显示这个视图中 1 条活跃论点里 {loaded} 条的内容。",
    scopeViewComplete: "正在显示这个视图中全部 {total} 条活跃论点的内容。",
    scopeViewCompleteSingular: "正在显示这个视图中这 1 条活跃论点的全部内容。",
    showMore: "再载入 {n} 条",
    unavailableLens: "此视角暂时没有内容可显示。没有任何内容被更改。",
    hydrationFault: "接下来的 {n} 条未能载入。请重试。",
    "condition.window_closed": "你关注的观察窗口已结束",
    "condition.open": "你关注的观察窗口仍然开着。",
    "condition.unavailable": "条件检查尚未接入",
    countUnknown: "—",
    coverageRatio: "共写了 {theses} 条，其中 {active} 条活跃",
    filteredBySubject: "仅显示关于 {subject} 的内容。",
    filteredByView: "仅显示符合「{view}」视图的内容。",
    filteredByViewAndSubject: "仅显示符合「{view}」视图、并且关于 {subject} 的内容。",
    clearFilter: "显示全部",
    filteredEmpty: "目前没有关于 {subject} 的论点。清除筛选可查看全部论点。",
    filteredMarker: "已筛选",
    "savedViews.title": "你保存的视图",
    "savedViews.newView": "保存此视图",
    "savedViews.namePlaceholder": "为这个视图命名",
    "savedViews.save": "保存",
    "savedViews.rename": "重命名",
    "savedViews.delete": "删除此视图",
    "savedViews.confirmDelete": "删除这个已保存的视图？此操作无法撤销。",
    "savedViews.limitReached": "已达到 50 个已保存视图的上限。请先删除一个再保存新的。",
    "savedViews.truncated": "你保存的视图超过 50 个。最早的那些暂时不显示，删除一些之后才会出现。",
    "savedViews.nameRequired": "保存前请先为这个视图命名。",
    "savedViews.empty": "还没有保存任何视图。先筛选列表，再为其保存命名。",
    "savedViews.unavailable": "无法加载已保存的视图。没有任何内容被更改。",
    "savedViews.alreadyRemoved": "该视图已被删除。",
    "savedViews.viewEmpty": "没有符合这个视图的论点。",
    "builtin.mine": "你的进行中论点",
    "builtin.stale30": "长期未更新",
    "builtin.staleWhat": "30 天没有改动。",
    "builtin.windowClosed": "观察窗口已结束",
    "builtin.team": "团队（暂未开放）",
    "builtin.teamTooltip": "论点的团队共享功能尚未上线。",
    "builtin.windowClosedEmpty": "目前没有观察窗口已结束的论点。",
    "builtin.mineEmpty": "这里还没有内容。",
    "builtin.staleEmpty": "这里的论点最近 30 天都有改动，没有长期未更新的。",
  },
};
