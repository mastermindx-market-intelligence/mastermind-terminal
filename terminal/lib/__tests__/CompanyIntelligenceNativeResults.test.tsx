// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import CompanyIntelligenceV2Current from "../../components/fin/CompanyIntelligenceV2Current";
import { normalizeEventWorkspace, type EventWorkspaceResult } from "../eventWorkspace";
import { applyLang, LangProvider } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/native-company-results-workspaces.json"), "utf8"));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  document.documentElement.setAttribute("data-lang", "en");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); document.documentElement.setAttribute("data-lang", "en");
});
async function render(ticker: string, lang: "en" | "zh") {
  const row = fixture.objects.find((row: { body: string }) => JSON.parse(row.body).issuer.listings.some((listing: { ticker: string }) => listing.ticker === ticker));
  const original = JSON.parse(row.body);
  const workspace = normalizeEventWorkspace(original)!;
  const result: Extract<EventWorkspaceResult, { ok: true }> = {
    ok: true, state: "ready", available: true, event_id: workspace.event_id, workspace,
    authority: "context_only", is_context_only: true, display_only: true,
    receipt: { generation_id: workspace.generation_id, workspace_sha256: row.sha256, marker_sha256: "a".repeat(64), workspace_url: `${fixture.source}/generations/${workspace.generation_id}/${row.file}` },
  };
  await act(async () => {
    applyLang(lang);
    root.render(<LangProvider><CompanyIntelligenceV2Current ticker={ticker} result={result} v1={null} onOpenTx={() => {}} /></LangProvider>);
  });
  await act(async () => (container.querySelector("#ci-tab-results") as HTMLButtonElement).click());
  return original;
}
it.each(["en", "zh"] as const)("keeps TOL denominator reachable after four numeric metrics and opens its exact receipt (%s)", async lang => {
  const original = await render("TOL", lang);
  const denominator = original.facts.find((fact: { metric: string }) => fact.metric === "cancellation_rate_basis");
  expect(Array.from(container.querySelectorAll(".ci-paper-results-metrics strong")).map(el => el.textContent)).toEqual(["2508", "2388", "5.4", "7.5"]);
  const context = container.querySelector("[data-ci-metric-context]")!;
  expect(context.querySelector("span")?.textContent).toBe(lang === "zh" ? "取消率分母" : "Cancellation rate denominator");
  expect(context.querySelector("strong")?.textContent).toBe(denominator.value);
  expect(context.querySelector("small")?.textContent).toBe(denominator.basis);
  await act(async () => (context.querySelector("button") as HTMLButtonElement).click());
  expect(container.querySelector(".ci-evidence.open blockquote")?.textContent).toBe(denominator.value);
  expect(original.lifecycle.source_available_at).toBe("2026-08-18T20:46:57Z");
});
it("does not present a typed-absence denominator as a source convention", async () => {
  await render("PHM", "en");
  expect(container.querySelector("[data-ci-metric-context]")).toBeNull();
});
