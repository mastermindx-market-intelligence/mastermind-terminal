// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseWtiPath, primaryReading, readingText, WTI_CHAIN, WTI_LEGS } from "../wtiPath";
import WtiLivePath from "@/components/workspaces/WtiLivePath";
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/components/settings/SettingsProvider", () => ({ useSettings: () => ({ open: vi.fn() }) }));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({ useOnboarding: () => ({ open: vi.fn() }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const label = (en: string) => ({ en, zh: en });
function snapshot() {
  return { schema: "ontology_explorer_snapshot.v1", source: {
    chain: WTI_CHAIN, rev: 4, source_manifest_hash: "sha256:" + "f".repeat(64), asof: "2026-01-02", built: "2026-01-03" },
    state: { label: label("Stopped") }, path: { sequence: [...WTI_LEGS], legs: WTI_LEGS.map((id,i) => ({
      node_id: id, index: i+1, title: label(id), observation: "observed", confirmed: (i > 0) as boolean | null,
      src: "source", receipts: i === 2 ? [{ op: "eq", value: "rising", threshold: "rising", passed: true },
        { op: "gt", value: 34, threshold: 30, passed: true }] : [{ metric: "ret_pct", op: "gt", value: 0, threshold: 25, passed: false }] })) },
    first_blocking_leg: { node_id: "oil_shock" }, contradiction: null,
    what_changed: { status: "comparison_unavailable", items: [], note: label("No recorded transition.") } };
}
it("preserves episode, missing verdict, zero reading and both yield receipts", () => {
  const raw = snapshot();
  raw.path.legs[0].observation = "incomplete"; raw.path.legs[0].confirmed = null;
  const data = parseWtiPath(raw), leg = data.legs[2], receipt = primaryReading(leg)!;
  expect(data.episode.en).toBe("Stopped"); expect(data.legs[0].confirmed).toBeNull();
  expect(data.legs[0].receipts[0].value).toBe(0); expect(leg.receipts).toHaveLength(2);
  expect(readingText(receipt.value, receipt, leg.id, "en")).toBe("34 bp");
});
it("rejects the wrong chain, reordered legs, malformed observation and contradictory blocker", () => {
  for (const change of [(r: ReturnType<typeof snapshot>) => { r.source.chain = "different"; },
    (r: ReturnType<typeof snapshot>) => { r.path.legs.reverse(); },
    (r: ReturnType<typeof snapshot>) => { r.path.legs[0].observation = "missing"; },
    (r: ReturnType<typeof snapshot>) => { r.first_blocking_leg.node_id = "yield_rise"; }]) {
    const r = snapshot(); change(r); expect(() => parseWtiPath(r)).toThrow();
  }
});
afterEach(() => { window.history.replaceState(null, "", "/"); });
it("opens a deep-linked condition and updates evidence on hash navigation", async () => {
  window.history.replaceState(null, "", "/wti-live-path#ox-leg-yield_rise");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<WtiLivePath explorer="/ontology.html" read={{ status: "ready", data: parseWtiPath(snapshot()) }} requestedRevision="3" />));
    expect(host.querySelector('[aria-current="true"]')?.getAttribute("href")).toBe("#ox-leg-yield_rise");
    expect(host.querySelector("section[aria-live]")?.textContent).toContain("34 bp");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("revision");
    await act(async () => { window.location.hash = "#ox-leg-duration_derate"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(host.querySelector("#wti-evidence-title")?.textContent).toBe("duration_derate");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
