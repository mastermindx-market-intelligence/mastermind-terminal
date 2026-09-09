import { describe, expect, it } from "vitest";
import {
  BUILTIN_VIEWS,
  MAX_SAVED_VIEWS,
  RMS_REVIEW_STALE_DAYS,
  RMS_SAVED_VIEW_STALE_DAYS,
  applyViewFilter,
  readConditionStates,
  reviewRows,
} from "@/lib/rmsViews";
import type { ConditionState } from "@/lib/rmsViews";
import type { ThesisSubjectRef, ThesisSummary } from "@/lib/theses";
import { THESIS_SUBJECT_SCHEMA } from "@/lib/theses";

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

function summary(partial: ThesisSummary): ThesisSummary {
  return partial;
}

const subjA = subject("AAA", "Alpha Co");
const subjB = subject("BBB", "Beta Co");

const tFresh = summary({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  currentVersion: 2,
  lifecycleState: "active",
  subject: subjA,
  title: "Fresh alpha",
  updatedAt: "2026-09-01T00:00:00.000Z",
});
const tStale45 = summary({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  currentVersion: 1,
  lifecycleState: "active",
  subject: subjA,
  title: "Forty-five day stale",
  updatedAt: "2026-07-23T00:00:00.000Z", // 45 days before NOW
});
const tStale200 = summary({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  currentVersion: 1,
  lifecycleState: "active",
  subject: subjB,
  title: "Long stale",
  updatedAt: "2026-02-15T00:00:00.000Z",
});
const tArchived = summary({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  currentVersion: 2,
  lifecycleState: "archived",
  subject: subjB,
  title: "Archived beta",
  updatedAt: "2026-09-02T00:00:00.000Z",
});
const tClosed = summary({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  currentVersion: 1,
  lifecycleState: "active",
  subject: subjB,
  title: "Closed window",
  updatedAt: "2026-08-20T00:00:00.000Z",
});

const rows: ThesisSummary[] = [tFresh, tStale45, tStale200, tArchived, tClosed];

describe("saved-view constants and built-ins", () => {
  it("keeps the 30-day check-on-this constant independent of the 90-day review constant", () => {
    expect(RMS_SAVED_VIEW_STALE_DAYS).toBe(30);
    expect(RMS_REVIEW_STALE_DAYS).toBe(90);
    expect(RMS_SAVED_VIEW_STALE_DAYS).not.toBe(RMS_REVIEW_STALE_DAYS);
  });

  it("BUILTIN_VIEWS is frozen as mine, stale_30, window_closed — Team is absent in v1", () => {
    expect(BUILTIN_VIEWS.map((v) => v.id)).toEqual(["mine", "stale_30", "window_closed"]);
    expect((BUILTIN_VIEWS as readonly { id: string }[]).some((v) => v.id === "team")).toBe(false);
  });

  it("caps saved views at 50", () => {
    expect(MAX_SAVED_VIEWS).toBe(50);
  });
});

describe("applyViewFilter", () => {
  it("mine: active lifecycle only (always-true under RLS-scoped input besides archived rows)", () => {
    const mine = BUILTIN_VIEWS.find((v) => v.id === "mine")!;
    const filtered = applyViewFilter(rows, mine.filter, readConditionStates(rows.map((r) => r.id)), NOW);
    expect(filtered.map((r) => r.id)).toEqual([
      tFresh.id, tStale45.id, tStale200.id, tClosed.id,
    ]);
    expect(filtered.some((r) => r.id === tArchived.id)).toBe(false);
  });

  it("stale_30: 30-day boundary, distinct from 90-day reviewRows", () => {
    const stale = BUILTIN_VIEWS.find((v) => v.id === "stale_30")!;
    const filtered = applyViewFilter(rows, stale.filter, readConditionStates(rows.map((r) => r.id)), NOW);
    expect(filtered.map((r) => r.id).sort()).toEqual([tStale45.id, tStale200.id].sort());
    expect(filtered.some((r) => r.id === tFresh.id)).toBe(false);

    const reviews = reviewRows(rows, NOW, readConditionStates(rows.map((r) => r.id)));
    const reviewStaleIds = reviews.filter((r) => r.reason === "stale").map((r) => r.id);
    expect(reviewStaleIds).toEqual([tStale200.id]);
    expect(reviewStaleIds).not.toContain(tStale45.id);
  });

  it("window_closed: only confirmed monitor rows; no match stays unavailable and is excluded", () => {
    const conditions = new Map<string, ConditionState>([
      [tClosed.id, { source: "monitor", state: "window_closed", at: "2026-09-01T00:00:00.000Z" }],
      [tFresh.id, { source: "unavailable" }],
    ]);
    const preset = BUILTIN_VIEWS.find((v) => v.id === "window_closed")!;
    const filtered = applyViewFilter(rows, preset.filter, conditions, NOW);
    expect(filtered.map((r) => r.id)).toEqual([tClosed.id]);
    const unmatched = applyViewFilter(
      [tFresh],
      preset.filter,
      readConditionStates([tFresh.id]),
      NOW,
    );
    expect(unmatched).toEqual([]);
  });

  it("subjectGroupKey reuses Coverage grouping", () => {
    const key = `${subjA.owner}|${subjA.kind}|${subjA.key}`;
    const filtered = applyViewFilter(
      rows,
      { lifecycle: "any", subjectGroupKey: key },
      readConditionStates(rows.map((r) => r.id)),
      NOW,
    );
    expect(filtered.map((r) => r.id).sort()).toEqual([tFresh.id, tStale45.id].sort());
  });

  it("combinations: subject + staleDays", () => {
    const key = `${subjA.owner}|${subjA.kind}|${subjA.key}`;
    const filtered = applyViewFilter(
      rows,
      { lifecycle: "active", staleDays: 30, subjectGroupKey: key },
      readConditionStates(rows.map((r) => r.id)),
      NOW,
    );
    expect(filtered.map((r) => r.id)).toEqual([tStale45.id]);
  });
});
