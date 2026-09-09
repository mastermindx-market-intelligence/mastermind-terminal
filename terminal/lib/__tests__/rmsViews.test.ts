import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BUILTIN_VIEWS,
  RMS_COPY,
  RMS_VIEWS,
  catalystRows,
  coverageRows,
  conditionLine,
  formatScopeSentence,
  hydrationScope,
  ideaRows,
  noteRows,
  readConditionStates,
  reviewRows,
  riskRows,
  selectHydrationIds,
  thesisRows,
} from "@/lib/rmsViews";
import type { ThesisDetail, ThesisSubjectRef, ThesisSummary, ThesisVersion } from "@/lib/theses";
import { THESIS_CONTENT_SCHEMA, THESIS_SUBJECT_SCHEMA } from "@/lib/theses";

const NOW = new Date("2026-09-06T00:00:00.000Z");

function subject(key: string, display: string): ThesisSubjectRef {
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: "issuer",
    owner: "data_os.security_master",
    key,
    identityState: "resolved",
    display,
  };
}

function content(overrides: Partial<ThesisVersion["content"]> = {}): ThesisVersion["content"] {
  return {
    schema: THESIS_CONTENT_SCHEMA,
    title: "t",
    statement: "s",
    catalysts: [],
    falsifiers: [],
    risks: [],
    horizon: "unspecified",
    effectiveAt: null,
    revisionNote: null,
    ...overrides,
  };
}

function version(id: string, subj: ThesisSubjectRef, opts: Partial<ThesisVersion> = {}): ThesisVersion {
  return {
    id: `${id}-v${opts.version ?? 1}`,
    thesisId: id,
    version: 1,
    previousVersion: null,
    transition: "create",
    lifecycleState: "active",
    subject: subj,
    content: content(),
    clientRequestId: `cr-${id}`,
    systemRecordedAt: "2026-01-01T00:00:00.000Z",
    effectiveAt: null,
    ...opts,
  };
}

function summary(s: ThesisSummary): ThesisSummary {
  return s;
}

// Fixture: 6 theses across 3 subjects (A, B, C)
const subjA = subject("AAA", "Alpha Co");
const subjB = subject("BBB", "Beta Co");
const subjC = subject("CCC", "Gamma Co");

const t1 = summary({ id: "t1", currentVersion: 2, lifecycleState: "active", subject: subjA, title: "Alpha thesis revised", updatedAt: "2026-09-05T00:00:00.000Z" });
const t2 = summary({ id: "t2", currentVersion: 2, lifecycleState: "active", subject: subjB, title: "Beta thesis revised", updatedAt: "2026-09-04T00:00:00.000Z" });
const t3 = summary({ id: "t3", currentVersion: 1, lifecycleState: "active", subject: subjA, title: "Alpha idea v1", updatedAt: "2026-09-03T00:00:00.000Z" });
const t4 = summary({ id: "t4", currentVersion: 1, lifecycleState: "active", subject: subjC, title: "Gamma stale thesis", updatedAt: "2026-02-15T00:00:00.000Z" }); // ~200d before NOW
const t5 = summary({ id: "t5", currentVersion: 2, lifecycleState: "archived", subject: subjB, title: "Beta archived thesis", updatedAt: "2026-08-01T00:00:00.000Z" });
const t6 = summary({ id: "t6", currentVersion: 2, lifecycleState: "invalidated", subject: subjC, title: "Gamma invalidated thesis", updatedAt: "2026-07-01T00:00:00.000Z" });

const summaries: ThesisSummary[] = [t1, t2, t3, t4, t5, t6];

function detailFor(s: ThesisSummary, opts: { catalysts?: string[]; risks?: string[]; note?: string | null; historyNotes?: (string | null)[] } = {}): ThesisDetail {
  const current = version(s.id, s.subject, {
    version: s.currentVersion,
    lifecycleState: s.lifecycleState,
    content: content({ catalysts: opts.catalysts ?? [], risks: opts.risks ?? [], revisionNote: opts.note ?? null }),
    systemRecordedAt: s.updatedAt,
  });
  const history: ThesisVersion[] = (opts.historyNotes ?? []).map((note, i) => version(s.id, s.subject, {
    version: i + 1,
    lifecycleState: "active",
    content: content({ revisionNote: note }),
    systemRecordedAt: `2026-0${i + 1}-01T00:00:00.000Z`,
  }));
  return {
    ...s,
    createdAt: "2026-01-01T00:00:00.000Z",
    current,
    history,
    historyTruncated: false,
  };
}

describe("rmsViews selectors", () => {
  it("coverage groups by subject, sorted by latest activity then key", () => {
    const rows = coverageRows(summaries);
    expect(rows.map((r) => r.display)).toEqual(["Alpha Co", "Beta Co", "Gamma Co"]);
    const alpha = rows.find((r) => r.display === "Alpha Co")!;
    expect(alpha.theses).toBe(2);
    expect(alpha.active).toBe(2);
    expect(coverageRows([])).toEqual([]);
  });

  it("ideas: active + currentVersion===1, newest first", () => {
    const rows = ideaRows(summaries);
    expect(rows.map((r) => r.id)).toEqual(["t3", "t4"]);
    expect(ideaRows([t1, t5, t6])).toEqual([]);
  });

  it("theses: all rows, active first then updatedAt desc then title", () => {
    const rows = thesisRows(summaries);
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(thesisRows([])).toEqual([]);
  });

  it("reviews: archived/invalidated/stale/window_closed, window_closed first then updatedAt asc", () => {
    const conditions = readConditionStates(summaries.map((s) => s.id));
    conditions.set("t2", { source: "monitor", state: "window_closed", at: "2026-09-01T00:00:00.000Z" });
    const rows = reviewRows(summaries, NOW, conditions);
    expect(rows.map((r) => r.id)).toEqual(["t2", "t4", "t6", "t5"]);
    expect(rows.find((r) => r.id === "t2")!.reason).toBe("window_closed");
    expect(rows.find((r) => r.id === "t4")!.reason).toBe("stale");
    expect(rows.find((r) => r.id === "t5")!.reason).toBe("archived");
    expect(rows.find((r) => r.id === "t6")!.reason).toBe("invalidated");
    expect(reviewRows([t1], NOW, readConditionStates(["t1"]))).toEqual([]);
  });

  it("catalysts: one row per catalyst, active theses only, author order preserved", () => {
    const details = [
      detailFor(t1, { catalysts: ["cat-a", "cat-b"] }),
      detailFor(t2, { catalysts: ["cat-c"] }),
      detailFor(t5, { catalysts: ["should-not-appear"] }), // archived, excluded
    ];
    const rows = catalystRows(details);
    expect(rows.map((r) => r.text)).toEqual(["cat-a", "cat-b", "cat-c"]);
    expect(rows[0].index).toBe(0);
    expect(rows[1].index).toBe(1);
    expect(catalystRows([detailFor(t3, { catalysts: [] })])).toEqual([]);
  });

  it("risks: one row per risk, active theses only", () => {
    const details = [detailFor(t1, { risks: ["risk-a"] }), detailFor(t5, { risks: ["excluded"] })];
    const rows = riskRows(details);
    expect(rows.map((r) => r.text)).toEqual(["risk-a"]);
    expect(riskRows([detailFor(t3, { risks: [] })])).toEqual([]);
  });

  it("notes: non-empty trimmed revisionNote across current+history, deduped, sorted desc by systemRecordedAt", () => {
    const details = [
      detailFor(t1, { note: "  final note  ", historyNotes: ["first note", null, "  "] }),
    ];
    const rows = noteRows(details);
    expect(rows.map((r) => r.text)).toEqual(["final note", "first note"]);
    expect(noteRows([detailFor(t3, { note: null, historyNotes: [] })])).toEqual([]);
  });
});

describe("rmsViews copy", () => {
  it("EN/ZH parity: every EN key exists in ZH, non-empty, and not byte-identical", () => {
    function walk(en: unknown, zh: unknown, path: string) {
      if (en && typeof en === "object" && !Array.isArray(en)) {
        for (const k of Object.keys(en as Record<string, unknown>)) {
          walk((en as Record<string, unknown>)[k], (zh as Record<string, unknown>)?.[k], `${path}.${k}`);
        }
        return;
      }
      expect(zh, `missing zh for ${path}`).toBeDefined();
      expect(zh, `empty zh for ${path}`).not.toBe("");
      if (path !== ".countUnknown") {
        expect(zh, `zh identical to en for ${path}`).not.toBe(en);
      }
    }
    walk(RMS_COPY.en, RMS_COPY.zh, "");
  });

  it("EN notes lens label is 'Revision notes', matching ZH 修订记录 (this round's review minor-3)", () => {
    expect(RMS_COPY.en.name.notes).toBe("Revision notes");
    expect(RMS_COPY.zh.name.notes).toBe("修订记录");
  });

  it("contains no banned falsifier/refuted vocabulary", () => {
    const blob = JSON.stringify(RMS_COPY);
    expect(blob).not.toMatch(/falsifier|falsified|refuted|证伪/i);
  });

  it("window-closed copy is byte-pinned EN/ZH", () => {
    expect(conditionLine({ source: "monitor", state: "window_closed", at: "x" }, "en")).toBe(
      "The window you were watching has closed",
    );
    expect(conditionLine({ source: "monitor", state: "window_closed", at: "x" }, "zh")).toBe(
      "你关注的观察窗口已结束",
    );
  });

  it("scope sentence names the actual counted subset ('active theses'), never a bare, unqualified count (round-2 review r3 MAJOR-2)", () => {
    // Every EN template that quotes a live count carries "active" — the content
    // lenses only ever hydrate the active subset (m5), so an unqualified "theses"
    // reads as "all your theses" when it is really a filtered one.
    expect(RMS_COPY.en.scope).toMatch(/active/);
    expect(RMS_COPY.en.scopeComplete).toMatch(/active/);
    expect(RMS_COPY.en.scopeSingular).toMatch(/active/);
    expect(RMS_COPY.en.scopeCompleteSingular).toMatch(/active/);
    expect(RMS_COPY.zh.scope).toMatch(/活跃/);
    expect(RMS_COPY.zh.scopeComplete).toMatch(/活跃/);
    // The partial-count template names the subset it counts out of — reviewer check
    // per the ruling: grep copy for "of your".
    expect(RMS_COPY.en.scope).toMatch(/of your/);
    expect(RMS_COPY.en.scopeSingular).toMatch(/of your/);
  });

  it("formatScopeSentence: plural/singular x partial/complete (round-2 review r3 minor 4)", () => {
    expect(formatScopeSentence(10, 12, false, RMS_COPY.en)).toBe("Showing lines from 10 of your 12 active theses.");
    expect(formatScopeSentence(12, 12, true, RMS_COPY.en)).toBe("Showing lines from all 12 active theses.");
    // Singular: never "1 active theses" — the count must not lie about plurality.
    expect(formatScopeSentence(0, 1, false, RMS_COPY.en)).toBe("Showing lines from 0 of your 1 active thesis.");
    expect(formatScopeSentence(1, 1, false, RMS_COPY.en)).toBe("Showing lines from 1 of your 1 active thesis.");
    expect(formatScopeSentence(1, 1, true, RMS_COPY.en)).toBe("Showing lines from all 1 active thesis.");
    expect(formatScopeSentence(1, 1, false, RMS_COPY.en)).not.toMatch(/1 active theses/);
    expect(formatScopeSentence(1, 1, true, RMS_COPY.en)).not.toMatch(/1 active theses/);
  });

  // Round-3 review (Meta-CEO B ruling R1): under an active view the counted set is
  // the VIEW's active theses, so the sentence may not claim "all {total} active
  // theses" / "of your {total} active theses" of the whole workspace.
  it("formatScopeSentence: the filtered variants scope themselves to the view, EN and ZH", () => {
    expect(formatScopeSentence(1, 2, false, RMS_COPY.en, true)).toBe("Showing lines from 1 of the 2 active theses in this view.");
    expect(formatScopeSentence(2, 2, true, RMS_COPY.en, true)).toBe("Showing lines from all 2 active theses in this view.");
    expect(formatScopeSentence(0, 1, false, RMS_COPY.en, true)).toBe("Showing lines from 0 of the 1 active thesis in this view.");
    expect(formatScopeSentence(1, 1, true, RMS_COPY.en, true)).toBe("Showing lines from the 1 active thesis in this view.");
    expect(formatScopeSentence(2, 2, true, RMS_COPY.en, true)).not.toContain("of your");
    // Round-5 review (Meta-CEO B ruling R3d): the ZH strings this packet adds name the
    // active lifecycle 有效 — the word the row status chip beside them already uses.
    expect(formatScopeSentence(1, 2, false, RMS_COPY.zh, true)).toBe("正在显示这个视图中 2 条有效论点里 1 条的内容。");
    expect(formatScopeSentence(2, 2, true, RMS_COPY.zh, true)).toBe("正在显示这个视图中全部 2 条有效论点的内容。");
    expect(formatScopeSentence(0, 1, false, RMS_COPY.zh, true)).toBe("正在显示这个视图中 1 条有效论点里 0 条的内容。");
    expect(formatScopeSentence(1, 1, true, RMS_COPY.zh, true)).toBe("正在显示这个视图中这 1 条有效论点的全部内容。");
  });

  it("formatScopeSentence: ZH plural/singular x partial/complete (round-2 review r3 minor 4 — ZH was asserted only via /活跃/ on the raw templates, never through a rendered sentence)", () => {
    expect(formatScopeSentence(10, 12, false, RMS_COPY.zh)).toBe("正在显示 12 条活跃论点中 10 条的内容。");
    expect(formatScopeSentence(12, 12, true, RMS_COPY.zh)).toBe("正在显示全部 12 条活跃论点的内容。");
    expect(formatScopeSentence(0, 1, false, RMS_COPY.zh)).toBe("正在显示 1 条活跃论点中 0 条的内容。");
    expect(formatScopeSentence(1, 1, false, RMS_COPY.zh)).toBe("正在显示 1 条活跃论点中 1 条的内容。");
    expect(formatScopeSentence(1, 1, true, RMS_COPY.zh)).toBe("正在显示这 1 条活跃论点的全部内容。");
    expect(RMS_COPY.zh.scopeSingular).toMatch(/活跃/);
    expect(RMS_COPY.zh.scopeCompleteSingular).toMatch(/活跃/);
  });

  it("typed not-connected condition (honest, not a transient error), and readConditionStates returns it for every id today", () => {
    expect(conditionLine({ source: "unavailable" }, "en")).toBe("Condition checks are not connected yet.");
    expect(conditionLine({ source: "unavailable" }, "zh")).toBe("条件检查尚未接入");
    const states = readConditionStates(["a", "b", "c"]);
    expect(states.size).toBe(3);
    for (const v of states.values()) expect(v).toEqual({ source: "unavailable" });
  });
});

describe("coverage lens round trip", () => {
  it("clicking a Coverage row's key selects the same subject's rows via subjectGroupKey (B1)", () => {
    const summaries: ThesisSummary[] = [
      {
        id: "t1",
        title: "Thesis 1",
        subject: subject("NVDA", "Nvidia"),
        lifecycleState: "active",
        currentVersion: 1,
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "t2",
        title: "Thesis 2",
        subject: subject("NVDA", "Nvidia"),
        lifecycleState: "active",
        currentVersion: 2,
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ];
    const coverage = coverageRows(summaries);
    expect(coverage).toHaveLength(1);
    const groupKey = coverage[0].key;
    const rows = thesisRows(summaries).filter((r) => r.subjectGroupKey === groupKey);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });
});

describe("condition read seam (B5)", () => {
  it("readConditionStates threads an injected per-id reader through to reviewRows/conditionLine", () => {
    const states = readConditionStates(["t1", "t2"], (id) =>
      id === "t1" ? { source: "monitor", state: "window_closed", at: "2026-09-05T00:00:00.000Z" } : undefined,
    );
    expect(states.get("t1")).toEqual({ source: "monitor", state: "window_closed", at: "2026-09-05T00:00:00.000Z" });
    expect(states.get("t2")).toEqual({ source: "unavailable" });

    const summaries: ThesisSummary[] = [
      {
        id: "t1",
        title: "Thesis 1",
        subject: subject("NVDA", "Nvidia"),
        lifecycleState: "active",
        currentVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const rows = reviewRows(summaries, NOW, states);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("window_closed");
    expect(conditionLine(states.get("t1")!, "en")).toBe("The window you were watching has closed");
  });
});

describe("no new schema", () => {
  it("carries no thesis migration of its own — 0012 is present (owned by terminal#502, already merged), and no thesis-scoped file was added or renamed by this packet", () => {
    // Round-2 review BLOCKER: a hardcoded whole-directory equality list is base-fragile
    // by construction — any *unrelated* migration landing on master (e.g. 0013, a
    // different lane's packet) breaks this test on merge, even though this packet never
    // touches the migrations directory at all. The invariant this guard actually owns is
    // narrower and base-stable: 0012_thesis_objects.sql exists (this packet's filter
    // layer depends on it) and no thesis-scoped schema file was added/renamed by *this*
    // PR (a `thesis_saved_views` table, a renamed/duplicated 0012, etc). Sibling packets
    // landing their own numbered migrations on master must never fail this test.
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    const entries = fs.readdirSync(dir);
    expect(entries).toContain("0012_thesis_objects.sql");
    const thesisScoped = entries.filter(
      (name) => /thesis/i.test(name) && name !== "0012_thesis_objects.sql",
    );
    expect(thesisScoped).toEqual([]);
  });

  it("route.ts and the thesis store module (theses.ts) contain no DDL or unexpected table access", () => {
    // B3 (round-2 review): the two files that actually touch the data layer are route.ts
    // (dispatches reads) and lib/theses.ts (the only module that calls `.from(...)`).
    // rmsViews.ts is a pure in-memory filter layer with zero table access, so grepping it
    // proved nothing about the DDL/table-access guard this test exists to enforce.
    const route = fs.readFileSync(path.resolve(__dirname, "../../app/api/theses/route.ts"), "utf8");
    const store = fs.readFileSync(path.resolve(__dirname, "../theses.ts"), "utf8");
    for (const src of [route, store]) {
      expect(src).not.toMatch(/create\s+table/i);
      expect(src).not.toMatch(/alter\s+table/i);
      expect(src).not.toMatch(/insert\s+into/i);
      const fromMatches = [...src.matchAll(/\.from\(["']([^"']+)["']\)/g)].map((m) => m[1]);
      for (const table of fromMatches) {
        expect(["theses", "thesis_versions"]).toContain(table);
      }
    }
  });
});

describe("grain contract", () => {
  it("RMS_VIEWS matches the frozen ids/order/grain/requiresContent table", () => {
    expect(RMS_VIEWS.map((v) => [v.id, v.grain, v.requiresContent])).toEqual([
      ["coverage", "subject", false],
      ["ideas", "thesis", false],
      ["theses", "thesis", false],
      ["reviews", "thesis", false],
      ["catalysts", "line", true],
      ["risks", "line", true],
      ["notes", "line", true],
    ]);
    expect(RMS_VIEWS.filter((v) => v.requiresContent)).toHaveLength(3);
  });
});

describe("bounded hydration", () => {
  const all = Array.from({ length: 15 }, (_, i) =>
    summary({
      id: `h${i}`,
      currentVersion: 1,
      lifecycleState: "active",
      subject: subjA,
      title: `h${i}`,
      updatedAt: new Date(2026, 0, i + 1).toISOString(),
    }),
  );

  it("selectHydrationIds returns <=10 newest-updated unloaded ids, never repeating loaded ids", () => {
    const loaded = new Set<string>();
    const first = selectHydrationIds(all, loaded);
    expect(first.length).toBe(10);
    // newest updatedAt first => highest index first
    expect(first[0]).toBe("h14");
    const loaded2 = new Set(first);
    const second = selectHydrationIds(all, loaded2);
    expect(second.length).toBe(5);
    for (const id of second) expect(loaded2.has(id)).toBe(false);
  });

  it("hydrationScope reports loaded/total/complete at 0, partial, full", () => {
    expect(hydrationScope(all, new Set())).toEqual({ loaded: 0, total: 15, complete: false });
    expect(hydrationScope(all, new Set(all.slice(0, 10).map((s) => s.id)))).toEqual({ loaded: 10, total: 15, complete: false });
    expect(hydrationScope(all, new Set(all.map((s) => s.id)))).toEqual({ loaded: 15, total: 15, complete: true });
    expect(hydrationScope([], new Set())).toEqual({ loaded: 0, total: 0, complete: true });
  });
});

// ---------------------------------------------------------------------------
// Round-4 review of PR #546 (B-F11-4), Meta-CEO B seat rulings R3 and R7.
// Both tests below were RED at head 5ecf748f.
// ---------------------------------------------------------------------------
describe("rmsViews copy — round-4 repairs (B-F11-4, PR #546)", () => {
  // R7: the chip ships `lifecycle: "active"`, so clicking it removes archived and
  // invalidated theses — but the label promised only ownership, and under owner-only
  // RLS ownership filters nothing. The head sentence then named the wrong cause
  // ("Only what matches the “Yours” view.") for a lifecycle narrowing. The label now
  // says what the predicate does, in both languages.
  it("R7 the 'mine' chip label names the lifecycle it actually filters, EN and ZH", () => {
    const preset = BUILTIN_VIEWS.find((v) => v.id === "mine")!;
    expect(preset.filter.lifecycle).toBe("active");
    expect(RMS_COPY.en["builtin.mine"]).toBe("Your active theses");
    // Round-5 review (ruling R3d): 进行中 read as "being drafted" and was a THIRD word
    // for the one lifecycle; the chip now says what every row chip beside it says.
    expect(RMS_COPY.zh["builtin.mine"]).toBe("你的有效论点");
    // The bare ownership words are what round 3 shipped and what this ruling withdrew.
    expect(RMS_COPY.en["builtin.mine"]).not.toBe("Yours");
    expect(RMS_COPY.zh["builtin.mine"]).not.toBe("你的");
  });

  // R3: deleting a row that is already gone is not a failed READ of a list that is
  // visibly on screen. `savedViews.unavailable` is reserved by spec 2.8 for a failed
  // fetch/save/delete; a resolved-but-absent row gets its own plain sentence.
  it("R3 an already-removed saved view has its own sentence, EN and ZH", () => {
    expect(RMS_COPY.en["savedViews.alreadyRemoved"]).toBe("That view was already removed.");
    expect(RMS_COPY.zh["savedViews.alreadyRemoved"]).toBe("该视图已被删除。");
    expect(RMS_COPY.en["savedViews.alreadyRemoved"]).not.toBe(RMS_COPY.en["savedViews.unavailable"]);
    expect(RMS_COPY.zh["savedViews.alreadyRemoved"]).not.toBe(RMS_COPY.zh["savedViews.unavailable"]);
  });
});

// ---------------------------------------------------------------------------
// Round-5 review of PR #546 (B-F11-4), Meta-CEO B seat rulings R2, R3a and R3d.
// Every test below was RED at head 0d648864.
// ---------------------------------------------------------------------------
describe("rmsViews copy — round-5 repairs (B-F11-4, PR #546)", () => {
  // R2: a subject filter and a view narrow the Theses lens at the same time. The
  // categorical view sentence is false in that state, so the combined state gets its
  // own sentence, naming the narrowing the reader can undo to see the rest.
  it("R2 the combined view-and-subject empty state has its own sentence, EN and ZH", () => {
    expect(RMS_COPY.en.filteredByViewAndSubjectEmpty).toBe(
      "Nothing matches this view for {subject}. Clear the subject filter to see the rest of the view.",
    );
    expect(RMS_COPY.zh.filteredByViewAndSubjectEmpty).toBe(
      "这个视图中没有关于{subject}的论点。清除标的筛选即可查看视图中的其余内容。",
    );
    // It carries the subject, unlike the categorical sentences it replaces.
    expect(RMS_COPY.en.filteredByViewAndSubjectEmpty).toContain("{subject}");
    expect(RMS_COPY.zh.filteredByViewAndSubjectEmpty).toContain("{subject}");
    expect(RMS_COPY.en.filteredByViewAndSubjectEmpty).not.toBe(RMS_COPY.en["savedViews.viewEmpty"]);
    expect(RMS_COPY.zh.filteredByViewAndSubjectEmpty).not.toBe(RMS_COPY.zh["savedViews.viewEmpty"]);
    // And it is not the subject-only sentence either: that one tells the reader to
    // clear the filter "to see every thesis", which a view still prevents.
    expect(RMS_COPY.en.filteredByViewAndSubjectEmpty).not.toBe(RMS_COPY.en.filteredEmpty);
    expect(RMS_COPY.zh.filteredByViewAndSubjectEmpty).not.toBe(RMS_COPY.zh.filteredEmpty);
  });

  // R3a: `listSavedViews` sorts by `updatedAt` descending and slices the cap, so the
  // hidden rows are the least recently UPDATED, not the oldest created. A view made
  // two years ago but renamed today stays visible.
  it("R3a the truncation sentence names the ordering the read actually uses, EN and ZH", () => {
    expect(RMS_COPY.en["savedViews.truncated"]).toBe(
      "You have more than 50 saved views. The least recently updated are hidden until you delete some.",
    );
    expect(RMS_COPY.zh["savedViews.truncated"]).toBe(
      "已保存的视图超过 50 个。最久未更新的那些暂时不显示，删除一些后会重新显示。",
    );
    expect(RMS_COPY.en["savedViews.truncated"]).not.toContain("The oldest");
    expect(RMS_COPY.zh["savedViews.truncated"]).not.toContain("最早");
  });

  // R3d: one Chinese word for the one lifecycle across every string this packet adds.
  it("R3d every ZH string this packet adds names the active lifecycle 有效", () => {
    for (const key of ["scopeView", "scopeViewSingular", "scopeViewComplete", "scopeViewCompleteSingular"] as const) {
      expect(RMS_COPY.zh[key], key).toContain("有效论点");
      expect(RMS_COPY.zh[key], key).not.toContain("活跃");
    }
    expect(RMS_COPY.zh["builtin.mine"]).toContain("有效");
    expect(RMS_COPY.zh["builtin.mine"]).not.toContain("进行中");
    // The pre-existing master sentences are deliberately NOT edited by this packet —
    // harmonising them is the copy owner's follow-up, recorded in DEVIATIONS.
    expect(RMS_COPY.zh.scope).toContain("活跃论点");
    expect(RMS_COPY.zh.scopeComplete).toContain("活跃论点");
  });
});
