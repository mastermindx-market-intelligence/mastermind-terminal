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
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import { SectorThemeCompare } from "@/components/sector-intelligence/depth/SectorThemeCompare";
import { DepthUnavailable } from "@/components/sector-intelligence/depth/DepthUnavailable";
import styles from "./page.module.css";

const captured = capturedFixture as unknown as {
  projection: { data: Record<string, unknown> };
};

/** The captured generation's real parsed rotation history (11 × 252). */
const capturedHistory = sectorRotationHistory(captured.projection.data.history);

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
  /** Shared onNavigate sink — the e2e asserts clicks land here verbatim. */
  const onNavigate = useCallback((href: string) => {
    setNavLog((prev) => [...prev, { id: prev.length + 1, label: href }]);
  }, []);

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
          Not a product surface. Real captured generation below; sections marked
          “contract” mount synthetic contract fixtures.
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
        {null /* wired after the calls-board contract lands */}
      </HarnessSection>

      <HarnessSection id="watch" title="Bottoming Watch · captured generation">
        <DepthUnavailable field="bottoming_watch" owner="Macro sector generation" title={t("siWatchTitle")} />
      </HarnessSection>

      <HarnessSection id="flows" title="Flow matrix · captured generation">
        <DepthUnavailable field="etf_flows" owner="Macro sector generation" title={t("siFlowsTitle")} />
      </HarnessSection>

      <HarnessSection id="universes" title="Entry evidence · captured generation">
        <DepthUnavailable field="confluence" owner="Macro sector generation" title={t("siUniverseTitle")} />
      </HarnessSection>

      <HarnessSection id="theme" title="Theme / compare / history · captured generation">
        <SectorThemeCompare history={capturedHistory} labels={labels} />
      </HarnessSection>

      {/* ── synthetic contract fixtures (clearly labelled) ────────────────── */}
      <HarnessSection id="calls-contract" title="Calls board · CONTRACT fixture (synthetic)" synthetic>
        {null}
      </HarnessSection>
      <HarnessSection id="watch-contract" title="Bottoming Watch · CONTRACT fixture (synthetic)" synthetic>
        {null}
      </HarnessSection>
      <HarnessSection id="flows-contract" title="Flow matrix · CONTRACT fixture (synthetic)" synthetic>
        {null}
      </HarnessSection>
      <HarnessSection id="universes-contract" title="Entry evidence · CONTRACT fixture (synthetic)" synthetic>
        {null}
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
