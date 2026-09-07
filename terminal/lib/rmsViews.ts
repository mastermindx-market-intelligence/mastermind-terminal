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
export const RMS_HYDRATION_BATCH = 10; // must equal the route's ids cap

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
): string {
  if (complete) {
    return total === 1
      ? copy.scopeCompleteSingular
      : copy.scopeComplete.replace("{total}", String(total));
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
  clearFilter: string;
  /** {subject} placeholder — shown instead of `empty.theses` when a Coverage subject
   *  filter is active and resolves to zero rows; never claims "No theses yet." while
   *  the workspace actually holds theses (round-2 review MAJOR). */
  filteredEmpty: string;
  /** Screen-reader-only word appended to the Theses lens rail badge when a subject
   *  filter is active — the badge already shows the filtered count (round-2 review r3
   *  minor 7: the filtered count needs a marker so it does not read as the total). */
  filteredMarker: string;
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
    clearFilter: "Show everything",
    filteredEmpty: "Nothing written about {subject} right now. Clear the filter to see every thesis.",
    filteredMarker: "filtered",
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
    showMore: "再载入 {n} 条",
    unavailableLens: "此视角暂时没有内容可显示。没有任何内容被更改。",
    hydrationFault: "接下来的 {n} 条未能载入。请重试。",
    "condition.window_closed": "你关注的观察窗口已结束",
    "condition.open": "你关注的观察窗口仍然开着。",
    "condition.unavailable": "条件检查尚未接入",
    countUnknown: "—",
    coverageRatio: "共写了 {theses} 条，其中 {active} 条活跃",
    filteredBySubject: "仅显示关于 {subject} 的内容。",
    clearFilter: "显示全部",
    filteredEmpty: "目前没有关于 {subject} 的论点。清除筛选可查看全部论点。",
    filteredMarker: "已筛选",
  },
};
