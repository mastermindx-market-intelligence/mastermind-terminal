// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
import Company from "@/components/fin/CompanyIntelligenceV2Current";
import { normalizeEventWorkspace } from "@/lib/eventWorkspace";
import { applyLang, LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.setAttribute("data-lang", "en"); });
it.each(["en", "zh"] as const)("does not promote generic retained source quotes into risk conclusions (%s)", async lang => {
  const workspace = normalizeEventWorkspace(golden)!;
  expect(workspace).not.toBeNull();
  const quote = workspace.claims.find(claim => claim.claim_id === "claim_demand_vs_supply")!;
  expect(quote.kind).toBe("quote");
  await act(async () => {
    applyLang(lang);
    root.render(<LangProvider><Company ticker="AAPL" result={{ workspace, state: "ready" }} retained v1={null} onOpenTx={() => {}} /></LangProvider>);
  });
  const panel = [...host.querySelectorAll(".ci-paper-insight")].find(section => section.querySelector("h4")?.textContent === (lang === "zh" ? "关注事项" : "Watchpoints"));
  expect(panel).toBeDefined();
  expect([...host.querySelectorAll("h4")].map(node => node.textContent)).not.toContain(lang === "zh" ? "关键风险" : "Key risks");
  const button = [...panel!.querySelectorAll("button")].find(node => node.querySelector("strong")?.textContent === quote.text)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  expect(host.querySelector(".ci-evidence.open blockquote")?.textContent).toBe(quote.source_span?.display_excerpt);
  expect(host.querySelector(".ci-paper-watch header p")?.textContent).toBe(lang === "zh" ? "本次事件的指引与关注事项" : "Guidance and watchpoints from this event");
});

it.each(["en", "zh"] as const)("renders an unclassified internal watch metric with a generic label and its exact source (%s)", async lang => {
  const workspace = normalizeEventWorkspace(golden)!;
  const claim = workspace.claims.find(row => row.claim_id === "claim_fx_headwind")!;
  expect(claim.metric).toBe("fx_yoy_headwind");
  await act(async () => {
    applyLang(lang);
    root.render(<LangProvider><Company ticker="AAPL" result={{ workspace, state: "ready" }} retained v1={null} onOpenTx={() => {}} /></LangProvider>);
  });
  const row = [...host.querySelectorAll(".ci-paper-watch-list>button")].find(button => button.querySelector("strong")?.textContent === claim.text)!;
  expect(row).toBeDefined();
  expect(row.querySelector("span")?.textContent).toBe(lang === "zh" ? "关注事项" : "Watchpoint");
  expect(row.textContent).not.toContain("fx_yoy_headwind");
  await act(async () => (row as HTMLButtonElement).click());
  expect(host.querySelector(".ci-evidence.open blockquote")?.textContent).toBe(claim.source_span?.display_excerpt);
});
