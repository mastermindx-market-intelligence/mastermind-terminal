// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
const fixture = vi.hoisted(() => ({ lang: "en", availability: "ready", requests: [] as string[] }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: fixture.lang }) }));
vi.mock("@/lib/useInvestigationTheme", () => ({ useInvestigationTheme: () => "dark" }));
vi.mock("next/link", () => ({ default: ({children, href}: React.PropsWithChildren<{href: string}>) => <a href={href}>{children}</a> }));
// Auth is an explicit component-test collaborator, never a runtime credential or grant.
vi.mock("@/lib/supabase/investigationAuthOwner", () => ({ subscribeInvestigationAuthOwner: () => ({getSnapshot: () => ({availability: fixture.availability, principal_partition: "fixture-owner", auth_epoch: "fixture-epoch"}), unsubscribe() {}}) }));
const entry = { context: "intl-workspace-context:sha256:1807a6a6b9c3428f0a152b1f8bfa570b8f8647ca94dd998bb908886c885b3185", generation: "im-workspace-generation:f180e9f4-eeee-488d-b312-5a68d09ccf5c", fingerprint: "0dc2265e5985adaff29f0c2efbf7191be9f80472a6c0f73646a4ac1b5776f8b8", fields: ["GB.policy_rate"] };
const back = "https://www.mastermind-x.com/intl.html?view=macro&market=GB&pins=GB,EZ&horizon=3m&basis=local&return_basis=price&group=";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.lang = "en"; fixture.availability = "ready"; fixture.requests = []; sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); fixture.requests.push((init?.method ?? "GET") + " " + url);
    const bodies: Record<string, unknown> = { "/api/investigations": {status: "listed", items: []}, "/api/layouts": {layouts: []}, "/api/alerts": {alerts: []}, "/api/alerts/receipts": {outbox: []} };
    if (!Object.hasOwn(bodies, url)) throw Error("Unexpected component fixture request: " + url);
    return new Response(JSON.stringify(bodies[url]), {headers: {"content-type": "application/json"}});
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false; });
async function draw(owner: string) { await act(async () => root.render(<InvestigationWorkspace ownerKey={owner} initialIntlEntry={entry} intlReturnTo={back}/>)); }
const selection = () => Array.from(host.querySelectorAll("button")).find(button => ["Use this International selection", "使用此国际选择"].includes(button.textContent ?? ""))!;
it.each(["en", "zh"])("explains the known local-preview limitation and disables the unavailable action in %s", async lang => {
  fixture.lang = lang; await draw("local-preview");
  expect(selection().disabled).toBe(true);
  expect(host.textContent).toContain(lang === "en" ? "This local preview cannot verify source access. Return to International Markets to continue." : "此本地预览无法验证来源访问权限。请返回国际市场继续研究。");
  expect(Array.from(host.querySelectorAll("a")).find(a => a.textContent === (lang === "en" ? "Return to International Markets" : "返回国际市场"))?.getAttribute("href")).toBe(back);
  await act(async () => selection().click());
  expect(fixture.requests.some(request => request.includes("baseline") || !request.startsWith("GET "))).toBe(false);
  expect(host.querySelector('input[aria-label="Title"]')).toBeNull();
});
it.each(["ready", "unavailable"])("preserves the owner path and does not label %s identity as local preview or signed out", async availability => {
  fixture.availability = availability; await draw("fixture-owner");
  expect(selection().disabled).toBe(false);
  expect(host.textContent).not.toContain("This local preview cannot verify source access");
  expect(host.textContent).not.toContain("Sign in again");
  expect(fixture.requests.some(request => request.includes("baseline") || !request.startsWith("GET "))).toBe(false);
});
