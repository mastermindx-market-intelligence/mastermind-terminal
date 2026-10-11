// Local verification harness only. No route, market-data fetch or source admission.
import React from "react";
import { createRoot } from "react-dom/client";
import { FactorHistoryPreview } from "../../terminal/components/factor-atlas/FactorHistoryPreview";
import original from "../../terminal/lib/__tests__/fixtures/factorAtlasNativeSynthetic.json";

async function main() {
  const params = new URLSearchParams(location.search), lang = params.get("lang") === "zh" ? "zh" : "en";
  document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";
  document.documentElement.lang = lang;
  const scenario = params.get("case") || "round-trip", first = structuredClone(original);
  const items: { basketId: string; label: readonly [string, string]; payload: typeof original }[] = [
    { basketId: "mag7", label: ["Synthetic round trip", "合成往返示例"], payload: first },
  ];
  if (scenario === "gap") {
    first.status = "PARTIAL";
    Object.assign(first.points[1], { index_level: null, return: null, reasons: ["MISSING_OR_INVALID_HELD_PRICE"] });
  }
  if (scenario === "retained") first.evidence_kind = "RETAINED_OWNER_INPUT";
  if (scenario === "compare" || scenario === "incompatible") {
    const other = structuredClone(original);
    other.basket_id = other.request.basket_id = "fixture:steady-control";
    other.source_refs.construction = "fixture:terminal-preview/steady-control-v1";
    other.points[0].return = 0.02; other.points[0].index_level = 102;
    other.points[1].return = 0.01; other.points[1].index_level = 103.02;
    if (scenario === "incompatible") other.history_mode = other.request.history_mode = "PIT_AS_KNOWN";
    items.push({ basketId: other.basket_id, label: ["Synthetic steady control", "合成平稳对照"], payload: other });
  }
  // Changed scenarios are explicitly fabricated test vectors. Give them distinct
  // harness-byte references; these are NOT native producer digest attestations.
  if (scenario !== "round-trip") for (const item of items) {
    item.payload.source_refs.code = "fixture:terminal-preview-harness/v1";
    const { result_digest: _ignored, ...core } = item.payload;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(core)));
    item.payload.result_digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  }
  const audience = params.get("audience") === "customer" ? "customer" : "synthetic-preview";
  createRoot(document.getElementById("root")!).render(<React.StrictMode><FactorHistoryPreview
    items={items} initialWindow={{ anchorDate: "2026-01-28", endDate: "2026-01-30" }} audience={audience} lang={lang}
  /></React.StrictMode>);
}
main().catch(error => { document.body.textContent = `Preview harness failed: ${String(error)}`; });
