import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const FIXTURES = path.join(process.cwd(), "fixtures", "dislocations");

beforeEach(() => {
  delete process.env.MACRO_LIVE_DIR;
  delete process.env.TERMINAL_E2E_FIXTURE;
});

afterEach(async () => {
  const { resetDislocationsSourceCacheForTests } = await import("@/lib/dislocations/source");
  resetDislocationsSourceCacheForTests();
  delete process.env.MACRO_LIVE_DIR;
  delete process.env.TERMINAL_E2E_FIXTURE;
});

async function loadSource() {
  return import("@/lib/dislocations/source");
}

describe("dislocations source", () => {
  it("S1 readSource fresh: materialized asof, cache hit on same mtime", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dislo-src-"));
    const file = path.join(dir, "entry_radar.json");
    await fs.copyFile(path.join(FIXTURES, "fresh.json"), file);
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const { readSource } = await loadSource();
    const first = await readSource(file, now);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.servedFromCache).toBe(false);
    const age = (now - Date.parse(first.file.asof)) / 1000;
    expect(age).toBeGreaterThanOrEqual(115);
    expect(age).toBeLessThanOrEqual(125);
    expect(first.file.episodes?.length).toBe(4);

    const second = await readSource(file, now);
    expect(second.kind).toBe("ok");
    if (second.kind === "ok") expect(second.servedFromCache).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("S2 mtime bump reloads empty episodes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dislo-src-"));
    const file = path.join(dir, "entry_radar.json");
    await fs.copyFile(path.join(FIXTURES, "fresh.json"), file);
    const { readSource } = await loadSource();
    await readSource(file);
    await fs.copyFile(path.join(FIXTURES, "empty.json"), file);
    const st = await fs.stat(file);
    const bumped = new Date(st.mtimeMs + 1000);
    await fs.utimes(file, bumped, bumped);
    const again = await readSource(file);
    expect(again.kind).toBe("ok");
    if (again.kind === "ok") {
      expect(again.servedFromCache).toBe(false);
      expect(again.file.episodes?.length ?? 0).toBe(0);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("S3 missing file without cache", async () => {
    const { readSource } = await loadSource();
    const res = await readSource(path.join(os.tmpdir(), "dislo-missing-never.json"));
    expect(res).toEqual({ kind: "unavailable", reason: "missing", lastGood: null });
  });

  it("S3b malformed.json", async () => {
    const { readSource } = await loadSource();
    const res = await readSource(path.join(FIXTURES, "malformed.json"));
    expect(res.kind).toBe("unavailable");
    if (res.kind === "unavailable") {
      expect(res.reason).toBe("malformed");
      expect(res.lastGood).toBeNull();
    }
  });

  it("S3c wrong schema", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dislo-schema-"));
    const file = path.join(dir, "entry_radar.json");
    await fs.writeFile(file, JSON.stringify({ schema: "other" }), "utf8");
    const { readSource } = await loadSource();
    const res = await readSource(file);
    expect(res).toMatchObject({ kind: "unavailable", reason: "schema", lastGood: null });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("S4 stale cache through malformed within MAX_STALE_MS", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dislo-stale-"));
    const file = path.join(dir, "entry_radar.json");
    await fs.copyFile(path.join(FIXTURES, "fresh.json"), file);
    const t0 = 1_700_000_000_000;
    const { readSource, MAX_STALE_MS } = await loadSource();
    const good = await readSource(file, t0);
    expect(good.kind).toBe("ok");
    await fs.writeFile(file, "{not json", "utf8");
    const st = await fs.stat(file);
    await fs.utimes(file, new Date(st.mtimeMs + 5000), new Date(st.mtimeMs + 5000));
    const within = await readSource(file, t0 + MAX_STALE_MS - 1);
    expect(within.kind).toBe("ok");
    if (within.kind === "ok") {
      expect(within.servedFromCache).toBe(true);
      expect(within.fallback_reason).toBe("malformed");
    }

    const past = await readSource(file, t0 + MAX_STALE_MS + 1);
    expect(past.kind).toBe("unavailable");
    if (past.kind === "unavailable") {
      expect(past.reason).toBe("malformed");
      expect(past.lastGood?.asof).toBe((good as { file: { asof: string } }).file.asof);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("S5 freshness fresh.json", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES, "fresh.json"), "utf8"));
    const { materializeAsof, freshness } = await loadSource();
    const file = materializeAsof(raw, now);
    const v = freshness(file, now);
    expect(v.stale).toBe(false);
    expect(v.reason).toBe("fresh");
    expect(v.pack_fresh).toBe(true);
  });

  it("S5b stale_pack pack_old", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES, "stale_pack.json"), "utf8"));
    const { materializeAsof, freshness } = await loadSource();
    const v = freshness(materializeAsof(raw, now), now);
    expect(v.stale).toBe(true);
    expect(v.reason).toBe("pack_old");
  });

  it("S5c old_file file_old in_window", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES, "old_file.json"), "utf8"));
    const { materializeAsof, freshness } = await loadSource();
    const v = freshness(materializeAsof(raw, now), now);
    expect(v.stale).toBe(true);
    expect(v.reason).toBe("file_old");
  });

  it("S5d out_of_window 2h not stale", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const file = {
      asof: new Date(now - 2 * 3600 * 1000).toISOString(),
      schema: "entry_radar.live/v1",
      session: "2026-10-03",
      pack: { as_of: "2026-10-03" },
      health: { state: "out_of_window" },
    };
    const { freshness } = await loadSource();
    const v = freshness(file, now);
    expect(v.stale).toBe(false);
    expect(v.reason).toBe("fresh");
  });

  it("S5e out_of_window 27h stale", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const file = {
      asof: new Date(now - 27 * 3600 * 1000).toISOString(),
      schema: "entry_radar.live/v1",
      session: "2026-10-03",
      pack: { as_of: "2026-10-03" },
      health: { state: "out_of_window" },
    };
    const { freshness } = await loadSource();
    const v = freshness(file, now);
    expect(v.stale).toBe(true);
    expect(v.reason).toBe("file_old");
  });

  it("S5f garbage asof no_asof", async () => {
    const { freshness } = await loadSource();
    const v = freshness(
      {
        asof: "garbage",
        schema: "entry_radar.live/v1",
        session: "2026-10-03",
        pack: { as_of: "2026-10-03" },
        health: { state: "in_window" },
      },
      Date.now()
    );
    expect(v.stale).toBe(true);
    expect(v.reason).toBe("no_asof");
  });

  it("S6 resolveSourcePath cookie and env matrix", async () => {
    const { resolveSourcePath, liveDir } = await loadSource();
    process.env.MACRO_LIVE_DIR = "/tmp/macro-live-test";
    expect(resolveSourcePath("fresh")).toBe(path.join("/tmp/macro-live-test", "entry_radar.json"));

    process.env.TERMINAL_E2E_FIXTURE = "1";
    expect(resolveSourcePath("fresh")).toMatch(/fixtures\/dislocations\/fresh\.json$/);
    expect(resolveSourcePath("../etc")).toBe(path.join("/tmp/macro-live-test", "entry_radar.json"));
    expect(resolveSourcePath(undefined)).toBe(path.join(liveDir(), "entry_radar.json"));
  });

  it("S7 stance display sort knowableAtMax", async () => {
    const { EPISODE_STATES } = await import("@/lib/dislocations/types");
    const { stanceOf, displayFor, sortNewestFirst, knowableAtMax } = await loadSource();

    for (const s of EPISODE_STATES) {
      expect(stanceOf(s)).toBeDefined();
    }
    expect(stanceOf("PROBING")).toBe("forming");
    expect(stanceOf("CANDIDATE")).toBe("confirmed");
    expect(stanceOf("RESOLVED")).toBe("ended");
    expect(stanceOf("UNKNOWN")).toBe("forming");

    const baseEp = {
      episode_id: "1",
      ticker: "X",
      detector_id: "",
      detector_version: "",
      detector_spec_hash: "",
      state: "ARMED",
      market_session: "",
      variant: "",
      first_armed_at: "2026-01-01T00:00:00Z",
      candidate_at: null as string | null,
      last_observed_at: null as string | null,
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
    };
    const forming = displayFor(baseEp);
    expect(forming.stance_en).toBe("Watching — not confirmed yet");
    expect(forming.stance_zh).toBe("观察中——尚未确认");

    const confirmed = displayFor({
      ...baseEp,
      state: "CANDIDATE",
      candidate_at: "2026-01-02T00:00:00Z",
    });
    expect(confirmed.stance_en).toBe("Reclaim confirmed — see when it was knowable");

    const ended = displayFor({ ...baseEp, state: "RESOLVED" });
    expect(ended.stance_en).toBe("Ended — kept for the record");

    const eps = [
      { episode_id: "b", state: "ARMED", last_observed_at: "2026-01-02T00:00:00Z" },
      { episode_id: "a", state: "ARMED", last_observed_at: "2026-01-02T00:00:00Z" },
      { episode_id: "c", state: "ARMED", last_observed_at: "2026-01-03T00:00:00Z" },
    ].map((p) => ({
      episode_id: p.episode_id,
      ticker: "T",
      detector_id: "",
      detector_version: "",
      detector_spec_hash: "",
      state: p.state,
      market_session: "",
      variant: "",
      first_armed_at: null,
      candidate_at: null,
      last_observed_at: p.last_observed_at,
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
    }));

    const sorted = sortNewestFirst(eps);
    expect(sorted.map((e) => e.episode_id)).toEqual(["c", "a", "b"]);
    expect(knowableAtMax(eps)).toBe("2026-01-03T00:00:00Z");
  });

  it("D6 fixture @now re-materialises on every serve when now advances", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    const fixturePath = path.join(FIXTURES, "fresh.json");
    const t0 = Date.parse("2026-10-03T20:00:00.000Z");
    const { readSource, freshness } = await loadSource();
    const first = await readSource(fixturePath, t0);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(freshness(first.file, t0).stale).toBe(false);

    const t1 = t0 + 30 * 60 * 1000;
    const second = await readSource(fixturePath, t1);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.servedFromCache).toBe(true);
    expect(freshness(second.file, t1).stale).toBe(false);
    const age = (t1 - Date.parse(second.file.asof)) / 1000;
    expect(age).toBeGreaterThanOrEqual(115);
    expect(age).toBeLessThanOrEqual(125);
  });

  it("D7a pack dated after session is not pack_fresh", async () => {
    const now = Date.parse("2026-10-03T20:00:00.000Z");
    const { freshness } = await loadSource();
    const v = freshness(
      {
        asof: new Date(now - 60_000).toISOString(),
        schema: "entry_radar.live/v1",
        session: "2026-10-01",
        pack: { as_of: "2026-10-03" },
        health: { state: "in_window" },
      },
      now
    );
    expect(v.pack_fresh).toBe(false);
    expect(v.reason).toBe("pack_asof_after_session");
    expect(v.stale).toBe(true);
  });

  it("D7b sort uses plain string compare not localeCompare", async () => {
    const { sortNewestFirst } = await loadSource();
    const mk = (episode_id: string, last_observed_at: string) => ({
      episode_id,
      ticker: "T",
      detector_id: "",
      detector_version: "",
      detector_spec_hash: "",
      state: "ARMED",
      market_session: "",
      variant: "",
      first_armed_at: null,
      candidate_at: null,
      last_observed_at,
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
    const sameTs = [
      mk("ep-z", "2026-01-02T00:00:00Z"),
      mk("ep-a", "2026-01-02T00:00:00Z"),
      mk("ep-m", "2026-01-02T00:00:00Z"),
    ];
    expect(sortNewestFirst(sameTs).map((e) => e.episode_id)).toEqual(["ep-a", "ep-m", "ep-z"]);
  });
});
