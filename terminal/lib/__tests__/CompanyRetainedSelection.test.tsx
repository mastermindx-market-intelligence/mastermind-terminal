// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CompanyIntelligenceV2Current from "@/components/fin/CompanyIntelligenceV2Current";
import EvidenceRail from "@/components/fin/EvidenceRail";
import type { CompanyIntelligenceEvent, CompanyIntelligenceMetrics } from "@/lib/companyIntelligence";
import { normalizeEventWorkspace } from "@/lib/eventWorkspace";
import { applyLang, LangProvider } from "@/lib/i18n";
import { presentEventWorkspace } from "@/lib/eventWorkspacePresent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/native-company-results-workspaces.json"), "utf8"));
const row = fixture.objects.find((item: {body:string}) => JSON.parse(item.body).issuer.listings.some((listing:{ticker:string}) => listing.ticker === "TOL"));
const workspace = normalizeEventWorkspace(JSON.parse(row.body))!;
const presented = presentEventWorkspace(workspace, {zh:false});
const evidenceId = presented.facts[0].id;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host=document.createElement("div");document.body.append(host);root=createRoot(host);window.history.replaceState({},"","/analysis?symbol=TOL&page=intelligence"); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(lang:"en"|"zh"="en") {
  await act(async()=>{applyLang(lang);root.render(<LangProvider><CompanyIntelligenceV2Current ticker="TOL" retained result={{workspace,state:"ready"}} v1={null} onOpenTx={()=>{}} /></LangProvider>);});
}
it("restores local view and exact evidence identifier from the selected immutable event URL",async()=>{
  const url=new URL(window.location.href);url.searchParams.set("ci_lens","results");url.searchParams.set("ci_evidence",evidenceId);window.history.replaceState({},"",url);
  await render();
  expect(host.querySelector("#ci-tab-results")?.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".ci-evidence.open")).not.toBeNull();
  expect(host.querySelector('[data-ci-event-id]')?.getAttribute("data-ci-event-id")).toBe(workspace.event_id);
  expect(host.querySelector('[data-ci-generation-id]')?.getAttribute("data-ci-generation-id")).toBe(workspace.generation_id);
  const listing=workspace.issuer.listings.find(item=>item.ticker==="TOL")!;
  expect(host.querySelector('[data-ci-listing-context]')?.textContent).toContain(listing.mic);
  await render("zh");
  expect(host.querySelector("#ci-tab-results")?.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".ci-evidence.open")).not.toBeNull();
});
it("does not turn an arbitrary evidence URL into an owner source",async()=>{
  const url=new URL(window.location.href);url.searchParams.set("ci_evidence","https://evil.example/source");window.history.replaceState({},"",url);
  await render();
  expect(host.textContent).toContain("The selected evidence is unavailable");
  expect(host.querySelector('a[href^="https://evil.example"]')).toBeNull();
  expect(document.querySelector(".ci-evidence.open")).toBeNull();
});
it("writes a selected metric identifier and removes it when the inspector closes",async()=>{
  await render();
  await act(async()=>{(host.querySelector("#ci-tab-results") as HTMLButtonElement).click();});
  expect(new URLSearchParams(window.location.search).get("ci_lens")).toBe("results");
  const button=host.querySelector<HTMLButtonElement>(".ci-paper-results-metrics button");
  expect(button).not.toBeNull();
  await act(async()=>button!.click());
  expect(new URLSearchParams(window.location.search).get("ci_evidence")).toBeTruthy();
  await act(async()=>{(document.querySelector(".ci-evidence-close") as HTMLButtonElement).click();});
  expect(new URLSearchParams(window.location.search).has("ci_evidence")).toBe(false);
});

it("keeps the evidence overlay outside the research stacking context and returns keyboard focus", async () => {
  await render();
  await act(async () => (host.querySelector("#ci-tab-results") as HTMLButtonElement).click());
  const trigger = host.querySelector<HTMLButtonElement>(".ci-paper-results-metrics button")!;
  trigger.focus();
  await act(async () => trigger.click());
  const inspector = document.querySelector<HTMLElement>(".ci-evidence.open")!;
  expect(inspector).not.toBeNull();
  // A fixed inspector inside the z-index:1 research pane cannot outrank the mobile bar.
  expect(host.contains(inspector)).toBe(false);
  expect(inspector.closest(".ci-evidence-layer")?.parentElement).toBe(document.body);
  expect(document.activeElement).toBe(inspector.querySelector(".ci-evidence-close"));
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await act(async () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())));
  expect(document.querySelector(".ci-evidence.open")).toBeNull();
  expect(new URLSearchParams(window.location.search).has("ci_evidence")).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("focuses an initially open inspector after the portal move with a stable close callback", async () => {
  const metrics = {
    sentiment: null, performance: null, confidence: null, combined: null,
    call_positivity: null, management_confidence: null, analyst_criticism: null,
    future_outlook: null, revenue_growth_pct: null, eps_growth_pct: null,
    gross_margin_pct: null, analysts_count: null, questions_count: null,
  } satisfies CompanyIntelligenceMetrics;
  const event: CompanyIntelligenceEvent = {
    event_id: workspace.event_id, ticker: "TOL", fiscal_year: 2026, fiscal_quarter: 3,
    call_date: presented.event_date, summary: null, highlights: [], positive_highlights: [],
    negative_highlights: [], key_quote: null, tags: [], metrics, previous_event_deltas: metrics,
    field_lineage: { summary: null, key_quote: null, metrics: { ...metrics },
      positive_highlights: [], negative_highlights: [], highlights: [], tags: {} },
    sources: [], claim_citations_pending: true,
  };
  const onClose = vi.fn();
  const draw = (open: boolean, overlay = true) => <LangProvider><EvidenceRail event={event}
    evidence={null} open={open} overlay={overlay} onClose={onClose} onOpenTranscript={() => {}} /></LangProvider>;
  await act(async () => root.render(draw(true)));
  const inspector = document.querySelector<HTMLElement>(".ci-evidence.open")!;
  const close = inspector.querySelector<HTMLButtonElement>(".ci-evidence-close")!;
  expect(host.contains(inspector)).toBe(false);
  expect(document.activeElement).toBe(close);
  // With only the Close control, Tab must remain inside the inspector.
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => close.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => root.render(draw(false)));
  expect(document.querySelector(".ci-evidence.open")).toBeNull();
  await act(async () => root.render(draw(true, false)));
  expect(host.querySelector(".ci-evidence.open")?.getAttribute("role")).toBe("complementary");
  expect(document.querySelector(".ci-evidence-layer")).toBeNull();
});
