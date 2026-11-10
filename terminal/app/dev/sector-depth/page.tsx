"use client";
// ─────────────────────────────────────────────────────────────────────────────
// DEV HARNESS — Sector Intelligence retained depth (lane 7).
//
// This is NOT a product surface. It exists so the lane-7 props-only depth
// components (calls board, Bottoming Watch, flow matrix, four-universe Entry
// evidence, theme/compare/history controls) can be exercised by the e2e spec
// (e2e/sector-retained-depth.spec.ts) before the integration lane (lane 3)
// mounts them inside the real workspace. The real captured generation fixture
// drives the sections the captured generation actually carries; clearly
// labelled `*-contract` sections mount synthetic contract fixtures for the
// capabilities it does not.
//
// Gated like /dev/chart-bench: 404 in production unless explicitly enabled.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { LangProvider, useLang } from "@/lib/i18n";
import { sectorRotationHistory } from "@/lib/sectorIntelligence";
import capturedFixture from "@/lib/__tests__/fixtures/sector_generation.captured.preview.v1.json";
import callsContractFixture from "@/lib/__tests__/fixtures/sectorDepthCallsContract.v1.json";
import flowsContractFixture from "@/lib/__tests__/fixtures/sectorDepthFlowsContract.v1.json";
import flowsCarriedFixture from "@/lib/__tests__/fixtures/sectorDepthFlowsCarried.v1.json";
import servedTypedBlocksFixture from "@/lib/__tests__/fixtures/typed_blocks_entitled.json";
import type {
  ActionBoardData,
  BottomingWatchData,
  CallsNavigateTarget,
} from "@/lib/sectorDepthCalls";
import { flowsFromCarriedBlock, type FlowsData } from "@/lib/sectorDepthFlows";
import {
  confluenceBasketsFromCarriedBlock,
  confluenceNasdaqFromCarriedBlock,
  confluenceRussellFromCarriedBlock,
  confluenceSp500FromCarriedBlock,
  type UniverseBlockRead,
  type UniverseData,
  type UniverseId,
} from "@/lib/sectorDepthUniverses";
import { themeRowsFromCarriedBlock } from "@/lib/sectorDepthThemeRows";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import { SectorCallsBoard } from "@/components/sector-intelligence/depth/SectorCallsBoard";
import { SectorBottomingWatch } from "@/components/sector-intelligence/depth/SectorBottomingWatch";
import { SectorFlowMatrix } from "@/components/sector-intelligence/depth/SectorFlowMatrix";
import { SectorConfluenceUniverses } from "@/components/sector-intelligence/depth/SectorConfluenceUniverses";
import { SectorThemeCompare } from "@/components/sector-intelligence/depth/SectorThemeCompare";
import { DepthUnavailable } from "@/components/sector-intelligence/depth/DepthUnavailable";
import styles from "./page.module.css";

const captured = capturedFixture as unknown as {
  projection: { data: Record<string, unknown> };
};

/** The captured generation's real action board (hold lane populated, total 4,
 * locked 1). Cast directly: lane 3's parser does not expose action_board yet
 * (see the lane-7 PR shared-file request) — the payload shape is the admitted
 * ActionBoardData contract. */
const capturedBoard = captured.projection.data.action_board as unknown as ActionBoardData;

/** Synthetic contract fixture for the board paths the captured generation
 * cannot reach (populated buy/buy-soon/take-profit lanes, withheld rows,
 * locked>0) and for the real bottoming_watch payload shape. */
const callsContract = callsContractFixture as unknown as {
  action_board: ActionBoardData;
  bottoming_watch_payload: BottomingWatchData;
};

/** The captured generation's real parsed rotation history (11 × 252). */
const capturedHistory = sectorRotationHistory(captured.projection.data.history);

/** Synthetic flow fixtures: full-history (depth 79, as-of 2026-11-05) and the
 * early-collection case (depth 8) where 2w/1m cap and coincide. */
const flowsContract = flowsContractFixture as unknown as {
  cases: { depth8: FlowsData; depth79: FlowsData };
};

/** The v1.1 carried etf_flows typed block (wire §3), adapted through the real
 * parser. realFull holds the committed producer's own run over data/flows
 * (as-of 2026-11-05, depth 79, 11 funds — the fixture's note is the label of
 * record); realAccruing14 is a LANE-AUTHORED TEST INPUT (review N5): the same
 * real series truncated to 14 sessions by lane 7, with the full_window:false
 * flag authored by the lane to exercise that rendering path — no owner
 * statement is claimed for it. */
const flowsCarried = flowsCarriedFixture as unknown as {
  cases: { realFull: unknown; realAccruing14: unknown };
};
const carriedFull = flowsFromCarriedBlock(flowsCarried.cases.realFull);
const carriedAccruing = flowsFromCarriedBlock(flowsCarried.cases.realAccruing14);

/** The v1.1 served typed-block surface (REAL producer specimens, 2026-11-06):
 * the four confluence universes and theme_rows exactly as the integration
 * lane will receive them — each read through its own entry-contract reader. */
const servedTypedBlocks = servedTypedBlocksFixture as unknown as Record<string, unknown>;
const carriedUniverseBlocks: Partial<Record<UniverseId, UniverseBlockRead>> = {
  subsectors: confluenceSp500FromCarriedBlock(servedTypedBlocks.confluence_universe_sp500),
  nasdaq: confluenceNasdaqFromCarriedBlock(servedTypedBlocks.confluence_universe_nasdaq),
  russell: confluenceRussellFromCarriedBlock(servedTypedBlocks.confluence_universe_russell),
  baskets: confluenceBasketsFromCarriedBlock(servedTypedBlocks.confluence_universe_baskets),
};
const carriedThemeRows = themeRowsFromCarriedBlock(servedTypedBlocks.theme_rows);

/** Owner-carried emergence demonstration (v1.1 R6-09): the CONTRACT board and
 * the REAL S&P read with the flag SIMULATED on a few rows — no owner emits
 * `emerging` today. This mount exists only to exercise the rendering law: the
 * mark is driven exclusively by the carried `emerging` boolean and
 * `emergence_href` string, never derived, never changing qualification. */
const emergenceBoard: ActionBoardData = (() => {
  const clone = structuredClone(callsContract.action_board) as ActionBoardData;
  const buyNow = clone.lanes.buy_now.rows;
  if (buyNow[0]) {
    buyNow[0] = { ...buyNow[0], emerging: true, emergence_href: "/company/SYN_S1.html" };
  }
  const hold = clone.lanes.hold.rows;
  if (hold[0]) {
    // No href on purpose: the copy renders, the evidence link does not.
    hold[0] = { ...hold[0], emerging: true };
  }
  return clone;
})();

const emergenceUniverses: Partial<Record<UniverseId, UniverseData>> = (() => {
  const sp = carriedUniverseBlocks.subsectors;
  if (sp?.state !== "available") return {};
  // Flag the REAL semiconductors row's first member so the compact member
  // chip is reachable by expanding that row on the real specimen base.
  const clone = { subsectors: structuredClone(sp.data) } as Partial<Record<UniverseId, UniverseData>>;
  const group = clone.subsectors?.subsectors?.find((g) => g.key === "semiconductors");
  const member = group?.members?.[0];
  if (member) {
    member.emerging = true;
    member.emergence_href = "/company/NXPI.html";
  }
  return clone;
})();

/** id → localized display name from the captured core sectors. */
const CAPTURED_LABELS: Record<string, Record<string, string>> = (() => {
  const core = captured.projection.data.core as
    | { sectors?: { id?: string; name?: string; name_zh?: string }[] }
    | undefined;
  const en: Record<string, string> = {};
  const zh: Record<string, string> = {};
  for (const s of core?.sectors ?? []) {
    if (typeof s?.id === "string") {
      if (typeof s.name === "string") en[s.id] = s.name;
      if (typeof s.name_zh === "string") zh[s.id] = s.name_zh;
    }
  }
  return { en, zh };
})();

export default function SectorDepthHarnessPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SECTOR_DEPTH !== "1") {
    notFound();
  }
  return (
    <LangProvider>
      <HarnessBody />
    </LangProvider>
  );
}

type NavEntry = { id: number; label: string };

function HarnessBody() {
  const t = useSectorDepthT();
  const { lang } = useLang();
  const [navLog, setNavLog] = useState<NavEntry[]>([]);
  /** Shared onNavigate sink — the e2e asserts clicks land here verbatim. The
   * calls board hands a CallsNavigateTarget (entity identity, lane-3 consumer
   * delta); when its href is null (relative owner href, N4-refused) the log
   * line falls back to "kind/id" so the click is still visible. Surfaces with
   * a conforming href keep logging the href string itself. */
  const onNavigate = useCallback(
    (hrefOrTarget: string | CallsNavigateTarget) => {
      const label =
        typeof hrefOrTarget === "string"
          ? hrefOrTarget
          : (hrefOrTarget.href ?? `${hrefOrTarget.kind}/${hrefOrTarget.id}`);
      setNavLog((prev) => [...prev, { id: prev.length + 1, label }]);
    },
    [],
  );

  useEffect(() => {
    // Default the harness to EN/west ink unless the boot script already chose.
    if (!document.documentElement.getAttribute("data-updown")) {
      document.documentElement.setAttribute("data-updown", "west");
    }
  }, []);

  const toggleLang = useCallback(() => {
    const next = document.documentElement.getAttribute("data-lang") === "zh" ? "en" : "zh";
    // Language AND directional ink flip together, exactly like the product
    // shell: ZH readers get east ink (red=up) through the token layer.
    document.documentElement.setAttribute("data-lang", next);
    document.documentElement.setAttribute("data-updown", next === "zh" ? "east" : "west");
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    window.dispatchEvent(new Event("mm:lang"));
  }, []);

  const labels = lang === "zh" ? CAPTURED_LABELS.zh : CAPTURED_LABELS.en;

  return (
    <main className={styles.page} data-harness="sector-depth">
      <header className={styles.bar}>
        <h1 className={styles.h1}>DEV HARNESS · sector retained depth (lane 7)</h1>
        <p className={styles.barNote}>
          Not a product surface. The captured generation below is a CONTROLLED
          TEST CAPTURE (population, labels and authentication were controlled
          test inputs, not production data); sections marked “contract” mount
          synthetic contract fixtures.
        </p>
        <div className={styles.ctls}>
          <button type="button" className={styles.btn} data-harness-ctl="lang" onClick={toggleLang}>
            {lang === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </header>

      <section className={styles.navlogBox} aria-label="navigation log">
        <h2 className={styles.h2}>onNavigate log</h2>
        <ol className={styles.navlog} data-harness="navlog">
          {navLog.map((n) => (
            <li key={n.id}>{n.label}</li>
          ))}
        </ol>
      </section>

      {/* ── real captured generation ─────────────────────────────────────── */}
      <HarnessSection id="calls" title="Calls board · captured generation">
        <SectorCallsBoard board={capturedBoard} onNavigate={onNavigate} />
      </HarnessSection>

      <HarnessSection id="watch" title="Bottoming Watch · captured generation">
        <DepthUnavailable field="bottoming_watch" owner="macro_sector_generation" title={t("siWatchTitle")} />
      </HarnessSection>

      <HarnessSection id="flows" title="Flow matrix · captured generation">
        <DepthUnavailable field="etf_flows" owner="macro_sector_generation" title={t("siFlowsTitle")} />
      </HarnessSection>

      <HarnessSection id="universes" title="Entry evidence · captured generation">
        <DepthUnavailable field="confluence" owner="macro_sector_generation" title={t("siUniverseTitle")} />
      </HarnessSection>

      <HarnessSection id="theme" title="Theme / compare / history · captured generation">
        <SectorThemeCompare history={capturedHistory} labels={labels} />
      </HarnessSection>

      <HarnessSection id="theme-carried" title="Theme table · CARRIED typed block, no rs_history (real producer specimen, 2026-11-06)">
        <SectorThemeCompare history={null} labels={{}} themeRows={carriedThemeRows} />
      </HarnessSection>

      {/* ── synthetic contract fixtures (clearly labelled) ────────────────── */}
      <HarnessSection id="calls-contract" title="Calls board · CONTRACT fixture (synthetic)" synthetic>
        {/* No onNavigate here on purpose: this instance proves the exact-anchor
            fallback path (<a href> verbatim from the payload). */}
        <SectorCallsBoard board={callsContract.action_board} />
      </HarnessSection>
      <HarnessSection id="watch-contract" title="Bottoming Watch · CONTRACT fixture (synthetic)" synthetic>
        <SectorBottomingWatch watch={callsContract.bottoming_watch_payload} />
      </HarnessSection>
      <HarnessSection id="flows-contract" title="Flow matrix · CONTRACT fixture (synthetic)" synthetic>
        <SectorFlowMatrix flows={flowsContract.cases.depth79} />
      </HarnessSection>
      <HarnessSection id="flows-contract-capped" title="Flow matrix · CONTRACT fixture, depth 8 (synthetic)" synthetic>
        <SectorFlowMatrix flows={flowsContract.cases.depth8} />
      </HarnessSection>
      <HarnessSection id="flows-carried" title="Flow matrix · CARRIED typed block (real producer run, 2026-11-05)">
        <SectorFlowMatrix flows={carriedFull} />
      </HarnessSection>
      <HarnessSection
        id="flows-carried-accruing"
        title="Flow matrix · LANE-AUTHORED TEST INPUT — the real producer run truncated to depth 14 by lane 7; the full_window:false flag is lane-authored, not an owner statement"
        synthetic
      >
        <SectorFlowMatrix flows={carriedAccruing} />
      </HarnessSection>
      <HarnessSection id="universes-carried" title="Entry evidence · CARRIED typed blocks (real producer specimens, 2026-11-06)">
        <SectorConfluenceUniverses universeBlocks={carriedUniverseBlocks} onNavigate={onNavigate} />
      </HarnessSection>
      <HarnessSection
        id="calls-emergence"
        title="Calls board · owner-carried emergence mark (CONTRACT fixture — flag simulated; no owner emits it today)"
        synthetic
      >
        <SectorCallsBoard board={emergenceBoard} onNavigate={onNavigate} />
      </HarnessSection>
      <HarnessSection
        id="universes-emergence"
        title="Entry evidence · member emergence chips (REAL specimen base — flag simulated; no owner emits it today)"
        synthetic
      >
        <SectorConfluenceUniverses universes={emergenceUniverses} onNavigate={onNavigate} />
      </HarnessSection>
    </main>
  );
}

function HarnessSection({
  id,
  title,
  synthetic,
  children,
}: {
  id: string;
  title: string;
  synthetic?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} data-h-section={id} data-harness-synthetic={synthetic ? "true" : undefined}>
      <h2 className={styles.h2}>
        {title}
        {synthetic && <span className={styles.synBadge}>synthetic</span>}
      </h2>
      {children}
    </section>
  );
}
