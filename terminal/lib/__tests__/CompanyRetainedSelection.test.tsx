// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import CompanyIntelligenceV2Current from "@/components/fin/CompanyIntelligenceV2Current";
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
  expect(host.querySelector(".ci-evidence.open")).not.toBeNull();
  expect(host.querySelector('[data-ci-event-id]')?.getAttribute("data-ci-event-id")).toBe(workspace.event_id);
  expect(host.querySelector('[data-ci-generation-id]')?.getAttribute("data-ci-generation-id")).toBe(workspace.generation_id);
  const listing=workspace.issuer.listings.find(item=>item.ticker==="TOL")!;
  expect(host.querySelector('[data-ci-listing-context]')?.textContent).toContain(listing.mic);
  await render("zh");
  expect(host.querySelector("#ci-tab-results")?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector(".ci-evidence.open")).not.toBeNull();
});
it("does not turn an arbitrary evidence URL into an owner source",async()=>{
  const url=new URL(window.location.href);url.searchParams.set("ci_evidence","https://evil.example/source");window.history.replaceState({},"",url);
  await render();
  expect(host.textContent).toContain("The selected evidence is unavailable");
  expect(host.querySelector('a[href^="https://evil.example"]')).toBeNull();
  expect(host.querySelector(".ci-evidence.open")).toBeNull();
});
it("writes a selected metric identifier and removes it when the inspector closes",async()=>{
  await render();
  await act(async()=>{(host.querySelector("#ci-tab-results") as HTMLButtonElement).click();});
  expect(new URLSearchParams(window.location.search).get("ci_lens")).toBe("results");
  const button=host.querySelector<HTMLButtonElement>(".ci-paper-results-metrics button");
  expect(button).not.toBeNull();
  await act(async()=>button!.click());
  expect(new URLSearchParams(window.location.search).get("ci_evidence")).toBeTruthy();
  await act(async()=>{(host.querySelector(".ci-evidence-close") as HTMLButtonElement).click();});
  expect(new URLSearchParams(window.location.search).has("ci_evidence")).toBe(false);
});
