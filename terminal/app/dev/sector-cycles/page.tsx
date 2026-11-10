"use client";
// Cycles lane dev harness — /dev/sector-cycles. Env-free (no Supabase), NOT
// under the authed /terminal layout: the lane's verification and regression
// stage, exactly like /dev/theater. It mounts the REAL SectorCycleLens with
// deterministic fixtures (no Math.random → stable screenshots) covering the
// deep cycles publication, the legacy rs-history feed, and the rotation
// events feed, with lang/theme/generation toggles for EN/ZH, light/dark and
// the incompatible-generation path. Fixture data is clearly labelled as such
// in the page itself (scFixtureChip).

import { useCallback, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { LangProvider, applyLang } from "@/lib/i18n";
import SectorCycleLens from "@/components/sector-intelligence/SectorCycleLens";
import type { SectorCycleCaptureHandle } from "@/components/sector-intelligence/cycles/cycleProps";

/* ── Deterministic fixture: one deep cycles publication ─────────────────────
 * Shapes mirror the parsers exactly: publicationGate / cycleRoster /
 * ontologyReading / oscHistory / rhythmReading / phaseAge / cycleRead /
 * cycleStory / cycleGrader / sectorRotationHistory / sectorRotationEpisodes. */

const AS_OF = "2026-10-30";
const PUB_ID = "cycp1-" + "a1b2c3d4".repeat(8);
const day = (i: number) => new Date(1756000000000 + i * 86_400_000).toISOString().slice(0, 10);

/** Deterministic relative-strength wave in percent, crossing zero. */
function rsWave(n: number, phase: number, amp = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(+(Math.sin((i + phase) * 0.21) * amp + Math.cos((i + phase) * 0.045) * 2.2).toFixed(2));
  }
  return out;
}

function historySector(id: string, ticker: string, phase: number) {
  const wave = rsWave(252, phase);
  return {
    id,
    kind: "sector",
    ticker,
    rs_history: wave.map((v, i) => ({ date: day(i), rs_21d: v, rs_63d: +(v * 0.6 + Math.sin(i * 0.09) * 3).toFixed(2) })),
    turns: [
      { date: day(20), k: "trough", major: true, provisional: false, mag_pct: 12.5 },
      { date: day(80), k: "peak", major: true, provisional: false, mag_pct: 15.1 },
      { date: day(150), k: "trough", major: true, provisional: false, mag_pct: 11.2 },
      { date: day(200), k: "peak", major: false, provisional: true, mag_pct: null },
    ],
  };
}

const SECTORS = [
  { id: "xlk", ticker: "XLK", name: "Technology", nameZh: "科技", phase2: "Expansion", pos: 72, basis: "tr" },
  { id: "xlf", ticker: "XLF", name: "Financials", nameZh: "金融", phase2: "Recovery", pos: 41, basis: "price" },
  { id: "xle", ticker: "XLE", name: "Energy", nameZh: "能源", phase2: "Trough", pos: 12, basis: "tr" },
  { id: "xlh", ticker: "XLV", name: "Health Care", nameZh: "医疗保健", phase2: "Peak", pos: 86, basis: "tr" },
  { id: "xly", ticker: "XLY", name: "Cons Discretionary", nameZh: "可选消费", phase2: "Downturn", pos: 24, basis: "price" },
];

const cyclesPayload = {
  meta: {
    asOf: AS_OF,
    rs_history: {
      schema: "sector_cycles.rs_history.v1",
      mode: "reconstructed_price_history",
      naturally_observed: false,
      basis: "tr",
      benchmark: "SPY",
      horizons_sessions: [21, 63],
      max_points_per_sector: 252,
    },
    structure_basis: "tr",
    membership: "current_membership",
    history_mode: "reconstructed_price_history",
    classifier: "cycle_pos_v2",
    live_hazard_parity: { verdict: "PARITY_HOLDS" },
    benchmark: "SPY",
    n_baskets: 2,
  },
  evidence: {
    schema: "sector_cycles.evidence.v1",
    status: "verified",
    publicationId: PUB_ID,
    asOf: AS_OF,
    region: "us",
    parts: { core: "verified", series: "verified" },
  },
  sectors: SECTORS.map((sec, idx) => ({
    id: sec.id,
    ticker: sec.ticker,
    kind: "sector",
    name: sec.name,
    name_zh: sec.nameZh,
    basis: sec.basis,
    now: {
      phase: sec.phase2, // legacy v2 name equals ontology here; xlh differs below
      phase_v2: sec.phase2,
      phase_v2_source: "ontology",
      pos_v2: sec.pos,
      phase_v2_position_input: "pos_v2",
      above200d: sec.pos > 50,
      read: `${sec.name} sits in the ${sec.phase2} phase of its cycle.`,
      read_zh: `${sec.nameZh}处于${sec.phase2}阶段。`,
      phase_v2_age: { status: idx === 2 ? "lower_bound" : "measured", sessions: 18 + idx * 7 },
      ...(idx === 2 ? { observed_from: day(120) } : {}),
      clocks: { ladder: sec.pos > 50 ? "RALLY ON" : "DECLINE" },
      divergence: idx === 4,
      hazard: {
        direction: sec.phase2 === "Trough" || sec.phase2 === "Downturn" ? "down" : "up",
        turn_kind: sec.phase2 === "Trough" || sec.phase2 === "Downturn" ? "trough" : "peak",
        "1m": { p: 0.18, source: "MODEL", cell_verdict: "PASS" },
        "3m": { p: 0.34, source: "PRIOR" },
        "6m": { p: 0.41, source: "MODEL", cell_verdict: "PASS" },
      },
    },
    estimate_kinds: {
      hazard: { "1m": "qualified_model_cell", "3m": "prior_only", "6m": "qualified_model_cell" },
      model_cell_current_claim: "parity_holds",
      live_feature_parity: { verdict: "PARITY_HOLDS" },
    },
    rhythm: {
      schema: "sector_cycles.rhythm.v1",
      as_of: AS_OF,
      kind: "descriptive_rhythm",
      window: { low: "2026-12", central: "2027-02", high: "2027-04" },
      next_turn: sec.phase2 === "Trough" || sec.phase2 === "Downturn" ? "peak" : "trough",
      overdue: idx === 1,
    },
    story: {
      en: "The advance matured; the leg is stretched versus its own median half-cycle.",
      zh: "上行已趋成熟；本段涨幅相对自身中位半周期已偏长。",
      epoch: AS_OF,
      expires_asof: "2026-11-13",
    },
    osc: Array.from({ length: 24 }, (_, i) => ({
      x: +(2024 + i * 0.125).toFixed(3),
      v: +Math.abs(Math.sin(i * 0.55) * 92 + 4).toFixed(1),
    })),
    grader: {
      available: true,
      note: null,
      by_horizon: {
        "21d": { n: 34, n_directional: 27, n_correct_directional: 17, n_neutral: 7, conditional_directional_hit_rate: 0.63, rank_ic: 0.11, mean_excess_vs_bench: 0.004, note: null },
        "63d": { n: 21, n_directional: 16, n_correct_directional: 9, n_neutral: 5, conditional_directional_hit_rate: 0.5625, rank_ic: 0.07, mean_excess_vs_bench: 0.002, note: null },
        "126d": { n: 9, n_directional: 0, n_correct_directional: 0, n_neutral: 9, conditional_directional_hit_rate: null, rank_ic: null, mean_excess_vs_bench: null, note: "accruing" },
      },
    },
  })),
  baskets: [
    {
      id: "b-aiinfra", kind: "basket", name: "AI Infrastructure", name_zh: "AI 基础设施",
      basis: "tr", coverage: 0.96, n_members: 24, n_stale_members: 1,
      now: { basis: "tr", phase: "Expansion", rs_21d: 2.4, rs_63d: 5.1 },
    },
    {
      id: "b-nuclear", kind: "basket", name: "Nuclear Renaissance", name_zh: "核能复兴",
      basis: "tr", coverage: 1.0, n_members: 12, n_stale_members: 0,
      now: { basis: "tr", phase: "Trough", rs_21d: -1.2, rs_63d: 3.3 },
    },
  ],
};

const historyPayload = {
  meta: { asOf: AS_OF, rs_history: cyclesPayload.meta.rs_history },
  sectors: SECTORS.map((sec, idx) => historySector(sec.id, sec.ticker, idx * 1.7)),
};

const eventsPayload = {
  schema: "rotation_events.v1",
  ok: true,
  as_of: AS_OF,
  generated_utc: `${AS_OF} 22:05 UTC`,
  authority: { sole: "macro-engine" },
  episodes: [
    {
      pair: "xly->xlk", donor: "xly", receiver: "xlk",
      from_name_en: "Cons Discretionary", to_name_en: "Technology",
      from_name_zh: "可选消费", to_name_zh: "科技",
      started: day(120), closed: day(180), day_n: 42, reason: "replay",
    },
  ],
  total_closed_recent: 1,
};

/* ── Harness page ─────────────────────────────────────────────────────────── */

export default function SectorCyclesHarness() {
  if (process.env.NODE_ENV === "production") notFound();

  const [lang, setLang] = useState<"en" | "zh">("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [generationState, setGenerationState] = useState<"current" | "replaced">("current");
  const captureRef = useRef<SectorCycleCaptureHandle>(null);

  const generation = useMemo(
    () =>
      generationState === "current"
        ? { accessGeneration: "ag-1", region: "us" as const, asOf: AS_OF, publicationId: PUB_ID }
        : { accessGeneration: "ag-2", region: "us" as const, asOf: "2026-11-06", publicationId: "cycp1-" + "9f8e7d6c".repeat(8) },
    [generationState],
  );

  const onLang = useCallback((next: "en" | "zh") => {
    setLang(next);
    applyLang(next);
  }, []);
  const onTheme = useCallback((next: "dark" | "light") => {
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
  }, []);

  return (
    <LangProvider>
      <div style={{ padding: "14px 16px 60px", maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
            padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10,
            background: "var(--panel)", marginBottom: 12, fontSize: 12,
          }}
        >
          <strong>DEV harness · SectorCycleLens</strong>
          <span style={{ color: "var(--text-2)" }}>Fixture data — not live evidence</span>
          <label>
            <input
              type="radio"
              name="harness-lang"
              checked={lang === "en"}
              onChange={() => onLang("en")}
            />{" "}
            EN
          </label>
          <label>
            <input
              type="radio"
              name="harness-lang"
              checked={lang === "zh"}
              onChange={() => onLang("zh")}
            />{" "}
            ZH
          </label>
          <label>
            <input type="radio" name="harness-theme" checked={theme === "dark"} onChange={() => onTheme("dark")} />{" "}
            Dark
          </label>
          <label>
            <input type="radio" name="harness-theme" checked={theme === "light"} onChange={() => onTheme("light")} />{" "}
            Light
          </label>
          <label>
            <input
              type="radio"
              name="harness-gen"
              checked={generationState === "current"}
              onChange={() => setGenerationState("current")}
            />{" "}
            Generation current
          </label>
          <label>
            <input
              type="radio"
              name="harness-gen"
              checked={generationState === "replaced"}
              onChange={() => setGenerationState("replaced")}
            />{" "}
            Generation replaced
          </label>
        </div>
        <SectorCycleLens
          generation={generation}
          subject={{ family: "sectors", id: "xlk" }}
          region="us"
          accessGeneration={generation.accessGeneration}
          returnBinding="self"
          captureRef={captureRef}
          cyclesFeed={{ state: "ready", data: cyclesPayload }}
          historyFeed={{ state: "ready", data: historyPayload }}
          eventsFeed={{ state: "ready", data: eventsPayload }}
        />
      </div>
    </LangProvider>
  );
}

