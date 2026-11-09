import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
import { SHELL, LEGACY, installAllocationSectorLegacyTransport } from "./fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "./fixtures/retained-legacy-fixture";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Existing CLOSED loopback-only protocol, selected finite case.
const { guardProxy } = require("./tools/intl_return_closed_policy.cjs");
const enabled = process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === "allocation-sector-return-controlled";
test.skip(!enabled, "Only the existing qualified CLOSED owned envelope may enroll the finite public Sector leg");
const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");
type Marker = Window & { __t58SectorDocument?: string; __t58SectorShell?: Element | null };
const bindings = [
  { file: "allocation.fixture.json.gz", sha: "622ff9043af0abacf69424efb818da4495a77033dc1283a98d509914e35d2d9a", route: "/allocation.html", html: "e0b81a5a560407e6ee2d164655b10708fefd82515004f8a2cafd890e84e1ad47", raw: "ae0130942dc0e5f12b8116b07f0318c2b0ecd967c54bc4cdeae1ae1a5b2e28ff" },
  { file: "big-pharma.fixture.json.gz", sha: "1b90a2b3c8f6f91a7a3a0439463ea2a83ea9099d75726b60ab594e1c57c8a5fa", route: "/basket/big_pharma.html", html: "a78b4242bdf9c810505c5e843472a5b8f16dac321b4e38e84c557f9b322b9b67", raw: "900bdc0970b2a51dff43225fb814ef172c8e514b0754cb83f716f40fa2880082" },
  { file: "sector-central.fixture.json.gz", sha: "45c367cb352ecb935cbe45970130aae6a20bbdfa2163d93b7b79195a8d8def70", route: "/sector_central.html", html: "dd8587b808b0bc8f06564d45d98d2b1fa1af22b1b224832189095820dd432d6a", raw: "8754f951853e93e48951836a41d2016629bd2a94144e7c2e4a7aa365f133cc70" },
] as const;
test.beforeEach(async ({ context, baseURL }) => {
  expect(process.env.MMX_SHARED_SHELL).toBe("1");
  guardProxy(context.request, baseURL, "allocation-sector-p12t58");
});
for (const cell of [
  { name: "dark-en-1440", width: 1440, height: 900, theme: "dark", lang: "en", locale: "en-US", touch: false },
  { name: "light-zh-390", width: 390, height: 844, theme: "light", lang: "zh", locale: "zh-CN", touch: true },
] as const) test.describe(cell.name, () => {
  test.use({ viewport: { width: cell.width, height: cell.height }, colorScheme: cell.theme, locale: cell.locale, hasTouch: cell.touch });
  test("Allocation → BigPharma → authored Sector public preview → Back BigPharma → Back Allocation", async ({ page, context, baseURL }, info) => {
    const fixtures=bindings.map(binding=>({...binding,retained:readRetainedLegacyFixture(path.join(__dirname,"fixtures/allocation-return-page",binding.file),binding.sha)}));
    const assets=new Map<string,Buffer>();
    for(const source of fixtures){
      expect(source.retained.provenance.macro_source).toBe("a00c2a3eac426efaa27169af07a24bdaa822a795");
      expect(source.retained.provenance.route).toBe(source.route);
      expect(digest(source.retained.html)).toBe(source.html);expect(digest(source.retained.rawJinja)).toBe(source.raw);
      for(const [name,body] of source.retained.assets){if(assets.has(name))expect(digest(assets.get(name)!)).toBe(digest(body));assets.set(name,body);}
    }
    for(const source of fixtures.slice(0,2))expect(source.retained.provenance.source_delta_input_sha256).toBe("cdb802ad445aeaad7d470d4238f56390c9167e64a206d94a9da3444170ee8c72");
    expect(fixtures[2].retained.provenance.source_kind).toBe("A00_EXACT_RETAINED_GIT_HTML_AND_TEMPLATE_NO_RENDER_OR_DATA_REFRESH");
    expect(fixtures[2].retained.provenance.source_clock_attributes).toEqual({"data-si-as-of":"2026-11-06"});
    expect(digest(assets.get("/shared_shell_bridge.js")!)).toBe("071ef7202d8886228342c00f0e7a3026eaba1d0103c4dcf1e6d204a7da77451b");
    expect(digest(assets.get("/shared_shell.css")!)).toBe("b1918ccaa2294f18c0fd5bca123e38267251c7e9d9a7c4fce1f296ef9e4c3c1e");
    for(const name of ["/sector_central_data.js","/si_workspace.js","/sector_cycles_data.js","/premiumdata/sector_central.json","/stockdata/REGN.json"])expect(assets.has(name)).toBe(false);
    await page.addInitScript(({theme,lang})=>{localStorage.setItem("mmx.shell.theme",theme);localStorage.setItem("mmx.lang",lang);},cell);
    const observations=await installAllocationSectorLegacyTransport({page,context,baseURL:baseURL!,documents:new Map(fixtures.map(source=>[source.route,source.retained.html])),assets});
    const states:unknown[]=[];
    const shell=page.locator('[data-shared-shell="beta"]'),frame=page.frameLocator("iframe[data-shared-shell-frame]");
    const ready=async()=>{
      await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible();await expect(shell).toHaveCount(1);await expect(shell).toBeVisible();
      await expect(shell.locator("header.topbar")).toHaveCount(1);await expect(page.locator("iframe[data-shared-shell-frame]")).toHaveCount(1);
      await expect(frame.locator("html")).toHaveAttribute("data-lang",cell.lang);await expect(frame.locator("html")).toHaveAttribute("data-theme",cell.theme);
    };
    const retainedDocument=async()=>{
      expect(await page.evaluate(()=>(window as Marker).__t58SectorDocument)).toBe("allocation-sector-retained-source");
      expect(await page.evaluate(()=>(window as Marker).__t58SectorShell===document.querySelector('[data-shared-shell="beta"]'))).toBe(true);
    };
    const geometry=async(label:string)=>{
      const inner=await frame.locator("html").evaluate(root=>({width:innerWidth,scroll:root.scrollWidth,duplicateNav:[...document.querySelectorAll(".site-nav")].some(node=>getComputedStyle(node).display!=="none")}));
      const outer=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      expect(inner.scroll).toBeLessThanOrEqual(inner.width);expect(outer.scroll).toBeLessThanOrEqual(outer.width);expect(inner.duplicateNav).toBe(false);states.push({label,inner,outer,url:page.url()});
    };
    try{
      await page.goto(SHELL+"/allocation.html",{waitUntil:"domcontentloaded"});await ready();
      const entry=frame.locator("a.tlink").filter({hasText:"Big Pharma"});await expect(entry).toHaveCount(1);
      expect(new URL((await entry.getAttribute("href"))!,LEGACY+"/allocation.html").pathname).toBe("/basket/big_pharma.html");
      expect(await frame.locator("header").innerText()).toContain("2026-11-06");
      await page.evaluate(()=>{(window as Marker).__t58SectorDocument="allocation-sector-retained-source";(window as Marker).__t58SectorShell=document.querySelector('[data-shared-shell="beta"]');});
      await entry.scrollIntoViewIfNeeded();if(cell.touch)await entry.tap();else{await entry.focus();await entry.press("Enter");}
      await expect(page).toHaveURL(SHELL+"/basket/big_pharma.html");await expect(frame.locator("a.back")).toHaveCount(1);await ready();await retainedDocument();
      const authoredBack=frame.locator("a.back");const destination=new URL((await authoredBack.getAttribute("href"))!,LEGACY+"/basket/big_pharma.html");
      expect(destination.pathname+destination.hash).toBe("/sector_central.html#actnow-section");
      await authoredBack.scrollIntoViewIfNeeded();if(cell.touch)await authoredBack.tap();else{await authoredBack.focus();await authoredBack.press("Enter");}
      await expect(page).toHaveURL(SHELL+"/sector_central.html#actnow-section");
      const section=frame.locator("#actnow-section"),board=section.locator("#action-board");await expect(board).toHaveCount(1);await ready();await retainedDocument();
      expect(await frame.locator("[data-si-as-of]").getAttribute("data-si-as-of")).toBe("2026-11-06");
      const title=board.locator(":scope > h2");await title.scrollIntoViewIfNeeded();await expect(title).toBeInViewport({ratio:1});
      await expect(title.locator(cell.lang==="zh"?".l-zh":".l-en").first()).toBeVisible();
      await page.screenshot({path:info.outputPath(`${cell.name}-sector-target.png`)});
      const preview=board.locator(".actitem .act-row-name").first();await preview.scrollIntoViewIfNeeded();await expect(preview).toBeVisible();await expect(preview).toBeInViewport({ratio:1});expect((await preview.innerText()).trim().length).toBeGreaterThan(0);
      await page.screenshot({path:info.outputPath(`${cell.name}-sector-public-preview.png`)});await geometry("sector-public-preview");
      states.push({cell:cell.name,sectorRoute:page.url(),clock:"retained data-si-as-of2026-11-06",scope:"source-baked public preview only; premium/private scripts absent and no REGN/body entitlement"});
      await page.goBack();await expect(page).toHaveURL(SHELL+"/basket/big_pharma.html");await expect(frame.locator("a.back")).toHaveCount(1);await ready();await retainedDocument();
      expect(new URL((await frame.locator("a.back").getAttribute("href"))!,LEGACY+"/basket/big_pharma.html").pathname).toBe("/sector_central.html");await geometry("back-big-pharma");
      await page.goBack();await expect(page).toHaveURL(SHELL+"/allocation.html");await expect(frame.locator("a.tlink").filter({hasText:"Big Pharma"})).toHaveCount(1);await ready();await retainedDocument();await geometry("back-allocation");
      expect(observations.baselines).toEqual([]);expect(observations.mutations).toEqual([]);expect(observations.pageErrors).toEqual([]);
      expect(observations.blockedTelemetryAttempts.every(attempt=>["shell","legacy"].includes(attempt.origin)&&attempt.method==="POST"&&attempt.path==="/api/collect"&&attempt.disposition==="blocked-before-transport")).toBe(true);
    }finally{
      await info.attach("allocation-public-sector-return",{body:JSON.stringify({scope:"finite controlled source journey only; public preview not premium/auth/currentdata/served/fullPaper acceptance",fixtures:bindings,observations,states}),contentType:"application/json"});
    }
  });
});
