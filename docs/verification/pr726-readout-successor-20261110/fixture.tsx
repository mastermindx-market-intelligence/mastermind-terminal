import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PrecisionEntryStrip from "../../../terminal/components/PrecisionEntryStrip";
import { buildPrecisionEntryReadout } from "../../../terminal/lib/precisionEntryReadout";

type Lang = "en" | "zh";
const BASE = {
  schema: "intel/v1", asof: "2026-11-10", tape: { stale: false },
  analysis: {
    entry: { status: "await_confluence", headline: "Wait for confluence", headline_zh: "等待共振",
      confidence: 72.4, next_trigger: "2D MACD × 3D StochRSI", spot: 118.5,
      buy_zone: { low: 116, high: 120 }, chase_above: 123, stop: 111 },
    confluence: { tier: "T3", bars_to_cross: 1.4, provisional: true, not_topped: true, htf_s1: false },
    sniper: { w2_washout: true, w2_stoch_d: 22.4, coiled: true },
  },
};
function Fixture() {
  const [lang, setLang] = useState<Lang>(new URLSearchParams(location.search).get("lang") === "zh" ? "zh" : "en");
  const [ready, setReady] = useState<unknown>(BASE);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.lang = lang;
    (window as unknown as { __precisionProof: unknown }).__precisionProof = { base: BASE, setReady, setLang };
  }, [lang]);
  const opposite = {
    ...BASE, analysis: { ...BASE.analysis, entry: { ...BASE.analysis.entry,
      headline: lang === "en" ? "" : BASE.analysis.entry.headline,
      headline_zh: lang === "zh" ? "" : BASE.analysis.entry.headline_zh } },
  };
  const cases = [
    { key: "ready", intel: ready },
    { key: "opposite-headline", intel: opposite },
    { key: "empty", intel: { tape: { stale: false }, analysis: { entry: {}, confluence: {}, sniper: {} } } },
    { key: "malformed", intel: { tape: { stale: false }, analysis: {
      entry: { confidence: "0", spot: 0, buy_zone: [100, 90] },
      confluence: { htf_s1: "false", ticks: 1.5 }, sniper: { coiled: 0, w2_stoch_d: 101 } } } },
    { key: "metadata", intel: { asof: "2026-11-10", tape: { stale: false }, analysis: {
      entry: { asof: "2026-11-10" }, confluence: { asof: "2026-11-10" }, sniper: { asof: "2026-11-09" } } } },
    { key: "partial", intel: { tape: { stale: false }, analysis: {
      entry: { headline: "Wait for a cleaner setup", headline_zh: "等待更清晰的形态", confidence: 41 },
      confluence: {}, sniper: {} } } },
    { key: "zero-false", intel: { tape: { stale: false }, analysis: {
      entry: { confidence: 0 }, confluence: { htf_s1: false, bars_to_cross: 0 },
      sniper: { w2_stoch_d: 0, w2_washout: false, coiled: false } } } },
    { key: "stale", intel: { ...BASE, tape: { stale: true } } },
    { key: "long-headline", intel: { ...BASE, analysis: { ...BASE.analysis, entry: {
      ...BASE.analysis.entry, headline: "Wait for confluence before the next published confirmation. ".repeat(4),
      headline_zh: "等待下一次已发布的确认信号，并保留当前已知的结构背景。".repeat(6) } } } },
  ];
  return <main style={{ padding: 16, width: "100%", boxSizing: "border-box" }}>
    <h1 style={{ fontSize: 16, lineHeight: "22px", margin: "0 0 6px" }}>Precision readout — isolated component proof</h1>
    <p style={{ fontSize: 11, lineHeight: "16px", margin: "0 0 12px", color: "var(--text-2)" }}>
      Synthetic source values · actual component, CSS module, product tokens and Inter assets · no shell mount
    </p>
    {cases.map(item => <section key={item.key} data-case={item.key} style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 10, lineHeight: "14px", fontWeight: 500, margin: "0 0 4px", color: "var(--text-2)" }}>{item.key}</h2>
      <PrecisionEntryStrip readout={buildPrecisionEntryReadout(item.intel)} horizon="swing" lang={lang} />
    </section>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
