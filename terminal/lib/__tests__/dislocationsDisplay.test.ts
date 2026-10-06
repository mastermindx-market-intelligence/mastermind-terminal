import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { EPISODE_STATES, type LiveEntryEpisode } from "@/lib/dislocations/types";
import { displayFor } from "@/lib/dislocations/source";

const baseEp = (): LiveEntryEpisode => ({
  episode_id: "1",
  ticker: "X",
  detector_id: "",
  detector_version: "",
  detector_spec_hash: "",
  state: "ARMED",
  market_session: "",
  variant: "",
  first_armed_at: "2026-01-01T00:00:00Z",
  candidate_at: null,
  last_observed_at: null,
  bar_availability: {},
  feature_snapshot: {},
  universe_admission: {},
  lobe_nominations: [],
  price_at_signal: null,
  risk_geometry: {},
  detector_score: null,
  research_priority: null,
  opportunity_score: null,
  data_quality: "ok",
  freshness: {},
  evidence_refs: [],
  schema: "mastermind.live_entry_episode.v1",
});

describe("displayFor plain-word stances and watching", () => {
  const stanceTable: Array<[string, string, string]> = [
    ["PROBING", "Washout, no turn yet", "洗盘中，尚未转向"],
    ["ARMED", "Washout, no turn yet", "洗盘中，尚未转向"],
    ["TURNING", "Turn forming, not held", "转向形成，未站稳"],
    ["CANDIDATE", "Reclaim held", "收复已站稳"],
    ["INVALIDATED", "Turn failed", "转向失败"],
    ["EXPIRED", "Ran out of session", "本节已到时"],
    ["RESOLVED", "Window closed", "观察期结束"],
  ];

  it("maps all seven states and unknown fallback (EN and ZH)", () => {
    for (const [state, en, zh] of stanceTable) {
      const d = displayFor({ ...baseEp(), state });
      expect(d.stance_en).toBe(en);
      expect(d.stance_zh).toBe(zh);
    }
    const unknown = displayFor({ ...baseEp(), state: "NOT_A_STATE" });
    expect(unknown.stance_en).toBe("Status unavailable");
    expect(unknown.stance_zh).toBe("状态不可用");
  });

  it("watching is null when keys missing, non-finite level, or unparsable date", () => {
    expect(displayFor({ ...baseEp(), risk_geometry: {} }).watching_en).toBeNull();
    expect(displayFor({ ...baseEp(), risk_geometry: { invalidation_level: 1 } }).watching_en).toBeNull();
    expect(
      displayFor({
        ...baseEp(),
        risk_geometry: { invalidation_level: 1, time_budget_until: "not-a-date" },
      }).watching_en
    ).toBeNull();
    expect(
      displayFor({
        ...baseEp(),
        risk_geometry: { invalidation_level: NaN, time_budget_until: "2026-10-03T18:45:00Z" },
      }).watching_en
    ).toBeNull();
    expect(
      displayFor({
        ...baseEp(),
        risk_geometry: { invalidation_level: "garbage", time_budget_until: "2026-10-03T18:45:00Z" },
      }).watching_en
    ).toBeNull();
  });

  it("formats watching level and ET clock from ISO", () => {
    const d = displayFor({
      ...baseEp(),
      risk_geometry: {
        invalidation_level: 182.4,
        time_budget_until: "2026-10-03T18:45:00Z",
      },
    });
    expect(d.watching_en).toBe("Turn fails below 182.40 · budget to 14:45 ET");
    expect(d.watching_zh).toBe("跌破 182.40 即失效 · 预算至 14:45 美东");
  });

  it("fresh fixture parses with all seven states and at least nine episodes", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "fixtures", "dislocations", "fresh.json"), "utf8")
    );
    expect(raw.episodes.length).toBeGreaterThanOrEqual(9);
    const states = new Set(raw.episodes.map((e: { state: string }) => e.state));
    for (const s of EPISODE_STATES) {
      expect(states.has(s)).toBe(true);
    }
    for (const ep of raw.episodes as LiveEntryEpisode[]) {
      expect(displayFor(ep).stance_en).toBeTruthy();
    }
  });
});
