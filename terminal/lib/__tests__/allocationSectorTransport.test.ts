import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { installAllocationLegacyTransport, installAllocationSectorLegacyTransport, installRealNextLegacyTransport, LEGACY } from "../../e2e/fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "../../e2e/fixtures/retained-legacy-fixture";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Incumbent pure CLOSED boundary, no browser or proxy invoked.
const { proxyAllowed } = require("../../e2e/tools/intl_return_closed_policy.cjs");
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../e2e/fixtures/allocation-return-page");
const pins = [
  ["allocation.fixture.json.gz", "622ff9043af0abacf69424efb818da4495a77033dc1283a98d509914e35d2d9a", "/allocation.html"],
  ["big-pharma.fixture.json.gz", "1b90a2b3c8f6f91a7a3a0439463ea2a83ea9099d75726b60ab594e1c57c8a5fa", "/basket/big_pharma.html"],
  ["sector-central.fixture.json.gz", "45c367cb352ecb935cbe45970130aae6a20bbdfa2163d93b7b79195a8d8def70", "/sector_central.html"],
] as const;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function source() {
  const loaded = pins.map(([name, pin, route]) => ({ route, value: readRetainedLegacyFixture(path.join(directory, name), pin) }));
  const assets = new Map<string, Buffer>();
  for (const { value } of loaded) for (const [name, bytes] of value.assets) {
    if (assets.has(name)) expect(hash(assets.get(name)!)).toBe(hash(bytes));
    assets.set(name, Buffer.from(bytes));
  }
  return { loaded, documents: new Map<string, Buffer>(loaded.map(({route,value}) => [route, Buffer.from(value.html)])), assets };
}
function control() {
  let routeHandler: ((route: Route) => Promise<void>) | undefined;
  const page = { on: vi.fn() };
  const context = { addCookies: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}), route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => { routeHandler = handler; }) };
  return { page, context, input: { page: page as unknown as Page, context: context as unknown as BrowserContext, baseURL: "http://127.0.0.1:42999/" },
    noIO() { expect(page.on).not.toHaveBeenCalled(); expect(context.addCookies).not.toHaveBeenCalled(); expect(context.route).not.toHaveBeenCalled(); expect(context.routeWebSocket).not.toHaveBeenCalled(); },
    async retainedGET(url: string) {
      const fulfill = vi.fn(async () => {}), abort = vi.fn(async () => {});
      const route = { request: () => ({ url: () => url, method: () => "GET" }), fulfill, abort } as unknown as Route;
      await routeHandler!(route); return { fulfill, abort };
    } };
}
afterEach(() => vi.unstubAllEnvs());
describe("finite public Sector return source envelope", () => {
  it("uses exact retained A00 body/template/clock and only explicit public assets", () => {
    const {loaded} = source(), sector = loaded[2].value;
    expect(hash(sector.html)).toBe("dd8587b808b0bc8f06564d45d98d2b1fa1af22b1b224832189095820dd432d6a");
    expect(hash(sector.rawJinja)).toBe("8754f951853e93e48951836a41d2016629bd2a94144e7c2e4a7aa365f133cc70");
    expect(sector.provenance.macro_source).toBe("a00c2a3eac426efaa27169af07a24bdaa822a795");
    expect(sector.provenance.source_clock_attributes).toEqual({ "data-si-as-of": "2026-11-06" });
    expect(sector.html.toString()).toContain('id="actnow-section"'); expect(sector.html.toString()).toContain('id="action-board"');
    expect(sector.html.toString()).toContain('class="act-row-name"');
    expect(hash(sector.assets.get("/shared_shell_bridge.js")!)).toBe("071ef7202d8886228342c00f0e7a3026eaba1d0103c4dcf1e6d204a7da77451b");
    expect(hash(sector.assets.get("/shared_shell.css")!)).toBe("b1918ccaa2294f18c0fd5bca123e38267251c7e9d9a7c4fce1f296ef9e4c3c1e");
    for (const denied of ["/sector_central_data.js", "/si_workspace.js", "/sector_cycles_data.js", "/premiumdata/sector_central.json", "/stockdata/REGN.json"]) expect(sector.assets.has(denied)).toBe(false);
  });
  it("enrolls exactly3 real retained documents and snapshots caller buffers without rendering or readiness", async () => {
    vi.stubEnv("CI", "1"); const fixture=source(), c=control();
    const html = Buffer.from(fixture.documents.get("/sector_central.html")!);
    const bridge = Buffer.from(fixture.assets.get("/shared_shell_bridge.js")!);
    const observations = await installAllocationSectorLegacyTransport({ ...c.input, documents: fixture.documents, assets: fixture.assets });
    expect(c.context.route).toHaveBeenCalledTimes(1); expect(c.context.addCookies).toHaveBeenCalledTimes(1);
    fixture.documents.get("/sector_central.html")!.fill(0); fixture.documents.clear(); fixture.assets.get("/shared_shell_bridge.js")!.fill(0); fixture.assets.clear();
    const document = await c.retainedGET(LEGACY+"/sector_central.html"); expect(document.abort).not.toHaveBeenCalled(); expect(document.fulfill).toHaveBeenCalledWith({contentType:"text/html; charset=utf-8",body:html});
    const script = await c.retainedGET(LEGACY+"/shared_shell_bridge.js"); expect(script.fulfill).toHaveBeenCalledWith({contentType:"text/javascript",body:bridge});
    expect(observations.pageErrors).toEqual([]); expect(observations.nextNavigations).toEqual([]); // no real page event or SSR/RSC execution occurred
  });
  it.each(["missing", "extra", "wrong", "empty"])("rejects %s document scope before any page/context effect", async kind => {
    const fixture=source(), c=control();
    if(kind==="missing") fixture.documents.delete("/sector_central.html");
    if(kind==="extra") fixture.documents.set("/stock.html",Buffer.from("unsupported"));
    if(kind==="wrong"){const bytes=fixture.documents.get("/sector_central.html")!;fixture.documents.delete("/sector_central.html");fixture.documents.set("/premiumdata/sector_central.json",bytes);}
    if(kind==="empty") fixture.documents.set("/sector_central.html",Buffer.alloc(0));
    await expect(installAllocationSectorLegacyTransport({...c.input,documents:fixture.documents,assets:fixture.assets})).rejects.toThrow("ALLOCATION_SECTOR_RETURN_DOCUMENT_SCOPE"); c.noIO();
  });
  it("keeps original2doc/Intl case boundaries independent from the newthird route", async () => {
    const fixture=source(), c=control();
    await expect(installAllocationLegacyTransport({...c.input,documents:fixture.documents,assets:fixture.assets})).rejects.toThrow("ALLOCATION_RETURN_DOCUMENT_SCOPE"); c.noIO();
    const input={...c.input,fixtureCase:"unknown",documents:fixture.documents,assets:fixture.assets} as unknown as Parameters<typeof installRealNextLegacyTransport>[0];
    await expect(installRealNextLegacyTransport(input)).rejects.toThrow("RETURN_FIXTURE_CASE"); c.noIO();
    vi.stubEnv("CI", "1");fixture.documents.delete("/sector_central.html");await installAllocationLegacyTransport({...c.input,documents:fixture.documents,assets:fixture.assets});expect(c.context.route).toHaveBeenCalledTimes(1);
  });
  it("admits only finite local Sector documents/RSC while original cases still exclude Sector", () => {
    const base="http://127.0.0.1:42999/", origin=base.slice(0,-1);
    for(const pathname of ["/allocation.html","/basket/big_pharma.html","/sector_central.html"]){expect(proxyAllowed(origin+pathname,"GET",base,"allocation-sector-p12t58")).toBe(true);expect(proxyAllowed(origin+pathname+"?_rsc=abc_1","HEAD",base,"allocation-sector-p12t58")).toBe(true);}
    expect(proxyAllowed(origin+"/sector_central.html","GET",base,"allocation-p12t58")).toBe(false);expect(proxyAllowed(origin+"/sector_central.html","GET",base,"intl")).toBe(false);
    for(const pathname of ["/stock.html","/premiumdata/sector_central.json","/api/investigations/baseline","/analysis","/sector_central.html?other=1","/sector_central.html#actnow-section"]){expect(proxyAllowed(origin+pathname,"GET",base,"allocation-sector-p12t58")).toBe(false);}
    expect(proxyAllowed(origin+"/sector_central.html","POST",base,"allocation-sector-p12t58")).toBe(false);expect(proxyAllowed("https://www.mastermind-x.com/sector_central.html","GET",base,"allocation-sector-p12t58")).toBe(false);
  });
});
