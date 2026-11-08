import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
import { SHELL, LEGACY, installAllocationLegacyTransport } from "./fixtures/real-next-legacy-transport";
import { readRetainedLegacyFixture } from "./fixtures/retained-legacy-fixture";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Incumbent pure closed-transport policy.
const { guardProxy } = require("./tools/intl_return_closed_policy.cjs");
const enabled = process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === "allocation-return-controlled";
test.skip(!enabled, "Only the fixed owned allocation source-fixture runner enrolls this case");
const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");

test.beforeEach(async ({ context, baseURL }) => {
  expect(process.env.MMX_SHARED_SHELL).toBe("1");
  guardProxy(context.request, baseURL, "allocation-p12t58");
});
for (const cell of [
  { name: "dark-en-1440", width: 1440, height: 900, theme: "dark", lang: "en", locale: "en-US", touch: false },
  { name: "light-zh-390", width: 390, height: 844, theme: "light", lang: "zh", locale: "zh-CN", touch: true },
] as const) test.describe(cell.name, () => {
  test.use({ viewport: { width: cell.width, height: cell.height }, colorScheme: cell.theme, locale: cell.locale, hasTouch: cell.touch });
  test("allocation → exact theme → measurement receipt → supported context return", async ({ page, context, baseURL }, info) => {
    const fixtures = [
      { file: "allocation.fixture.json.gz", sha: "622ff9043af0abacf69424efb818da4495a77033dc1283a98d509914e35d2d9a", route: "/allocation.html", html: "e0b81a5a560407e6ee2d164655b10708fefd82515004f8a2cafd890e84e1ad47", raw: "ae0130942dc0e5f12b8116b07f0318c2b0ecd967c54bc4cdeae1ae1a5b2e28ff" },
      { file: "big-pharma.fixture.json.gz", sha: "1b90a2b3c8f6f91a7a3a0439463ea2a83ea9099d75726b60ab594e1c57c8a5fa", route: "/basket/big_pharma.html", html: "a78b4242bdf9c810505c5e843472a5b8f16dac321b4e38e84c557f9b322b9b67", raw: "900bdc0970b2a51dff43225fb814ef172c8e514b0754cb83f716f40fa2880082" },
    ].map(binding => ({ ...binding, retained: readRetainedLegacyFixture(path.join(__dirname, "fixtures/allocation-return-page", binding.file), binding.sha) }));
    for (const input of fixtures) {
      expect(input.retained.provenance.macro_source).toBe("a00c2a3eac426efaa27169af07a24bdaa822a795");
      expect(input.retained.provenance.source_delta_input_sha256).toBe("cdb802ad445aeaad7d470d4238f56390c9167e64a206d94a9da3444170ee8c72");
      expect(input.retained.provenance.route).toBe(input.route);
      expect(digest(input.retained.rawJinja)).toBe(input.raw); expect(digest(input.retained.html)).toBe(input.html);
      expect(input.retained.assets.size).toBe(23);
    }
    const assets = fixtures[0].retained.assets;
    expect([...fixtures[1].retained.assets].map(([key, value]) => [key, digest(value)])).toEqual([...assets].map(([key, value]) => [key, digest(value)]));
    expect(digest(assets.get("/assets/css/d41db61c.css")!)).toBe("d41db61cc18e20b70bed0cefb2637862da9d6caeddb349089bb01e831b78d797");
    await page.addInitScript(({ theme, lang }) => { localStorage.setItem("mmx.shell.theme", theme); localStorage.setItem("mmx.lang", lang); }, cell);
    const observations = await installAllocationLegacyTransport({ page, context, baseURL: baseURL!, documents: new Map(fixtures.map(input => [input.route, input.retained.html])), assets });
    const states: unknown[] = [];
    try {
      await page.goto(SHELL + "/allocation.html", { waitUntil: "domcontentloaded" });
      const shell = page.locator('[data-shared-shell="beta"]');
      const ready = async () => { await expect(page.locator('[data-shared-shell-phase="ready"]')).toBeVisible(); await expect(shell).toBeVisible(); };
      await ready();
      await page.evaluate(() => { (window as Window & { __t58Document?: string }).__t58Document = "allocation-retained-source"; });
      const frame = page.frameLocator("iframe[data-shared-shell-frame]");
      await expect(frame.locator("html")).toHaveAttribute("data-lang", cell.lang);
      await expect(frame.locator("html")).toHaveAttribute("data-theme", cell.theme);
      const entryText = await frame.locator("header").innerText(); expect(entryText).toContain("2026-11-06");
      const material = await frame.locator(".hero .big").evaluate(node => {
        const s = getComputedStyle(node); return { borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], colors: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor], radius: s.borderTopLeftRadius, background: s.backgroundColor };
      });
      expect(material.borders).toEqual(["1px", "1px", "1px", "1px"]); expect(new Set(material.colors).size).toBe(1); expect(material.radius).toBe("12px");
      states.push({ cell: cell.name, material, scope: "actual retained-source material observation, not full Paper or entitled serving" });
      const hero = frame.locator(".hero .big");
      await hero.scrollIntoViewIfNeeded(); await expect(hero).toBeInViewport({ ratio: 1 });
      states.push({ cell: cell.name, heroGeometry: await hero.evaluate(node => {
        const b = node.getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height, viewportWidth:innerWidth, viewportHeight:innerHeight };
      }) });
      await page.screenshot({ path: info.outputPath(`${cell.name}-hero.png`) });
      const link = frame.locator("a.tlink").filter({ hasText: "Big Pharma" }); await expect(link).toHaveCount(1);
      expect(new URL((await link.getAttribute("href"))!, LEGACY + "/allocation.html").pathname).toBe("/basket/big_pharma.html");
      await link.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`${cell.name}-entry.png`) });
      if (cell.touch) await link.tap(); else { await link.focus(); await link.press("Enter"); }
      await expect(page).toHaveURL(SHELL + "/basket/big_pharma.html"); await ready();
      expect(await page.evaluate(() => (window as Window & { __t58Document?: string }).__t58Document)).toBe("allocation-retained-source");
      const receipt = frame.locator("details.lrc-receipt"); const summary = receipt.locator("summary");
      await summary.scrollIntoViewIfNeeded(); if (cell.touch) await summary.tap(); else { await summary.focus(); await summary.press("Enter"); }
      await expect(receipt).toHaveAttribute("open", ""); expect(await receipt.innerText()).toContain("2026-11-06");
      const ledger = receipt.locator(".lrc-ledger"), rows = ledger.locator(":scope > .lrc-ledger-row");
      expect(await rows.count()).toBeGreaterThan(0);
      for (const edge of ["start", "end"] as const) {
        const row = edge === "start" ? rows.first() : rows.last();
        // The source row is display:contents: its label/text cells paint, but
        // the wrapper has no principal box and cannot be a viewport oracle.
        const label = row.locator(":scope > .lrc-ledger-label"), text = row.locator(":scope > .lrc-ledger-text");
        await expect(label).toHaveCount(1); await expect(text).toHaveCount(1);
        const geometry = () => row.evaluate(node => {
          const box = (el: Element) => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
          const ancestors=[];let parent=node.parentElement;
          while(parent && ancestors.length<4){ancestors.push({tag:parent.tagName,scrollTop:parent.scrollTop,scrollHeight:parent.scrollHeight,clientHeight:parent.clientHeight});parent=parent.parentElement;}
          return {wrapper:{display:getComputedStyle(node).display,box:box(node)},
            cells:[...node.children].map(el=>({kind:el.classList.contains("lrc-ledger-label")?"label":"text",display:getComputedStyle(el).display,box:box(el)})),
            receiptOpen:node.closest("details")?.open===true,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},ancestors};
        });
        states.push({cell:cell.name,ledgerEdge:edge,phase:"before-scroll",geometry:await geometry()});
        // Ordinary content scrolling; no CSS, visibility or threshold override.
        await text.evaluate(node=>node.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"}));
        states.push({cell:cell.name,ledgerEdge:edge,phase:"before-visibility-assertion",geometry:await geometry()});
        await expect(label).toBeInViewport({ratio:1}); await expect(text).toBeInViewport({ratio:1});
        await page.screenshot({path:info.outputPath(`${cell.name}-receipt-content-${edge}.png`)});
      }
      const member = frame.locator("#hold a.tk").filter({ hasText: /^REGN$/ }); await expect(member).toHaveCount(1);
      const memberURL = new URL((await member.getAttribute("href"))!, LEGACY + "/basket/big_pharma.html"); expect(memberURL.pathname).toBe("/stock.html"); expect(memberURL.hash).toBe("#REGN");
      const returnHref = new URL((await frame.locator("a.back").getAttribute("href"))!, LEGACY + "/basket/big_pharma.html");
      expect(returnHref.pathname + returnHref.hash).toBe("/sector_central.html#actnow-section");
      await page.screenshot({ path: info.outputPath(`${cell.name}-receipt.png`) });
      states.push({ cell: cell.name, member: memberURL.pathname + memberURL.hash, canonicalContextReturn: returnHref.pathname + returnHref.hash, receipt: "opened", observationAt: "2026-11-06" });
      await page.goBack(); await expect(page).toHaveURL(SHELL + "/allocation.html"); await ready();
      expect(await page.evaluate(() => (window as Window & { __t58Document?: string }).__t58Document)).toBe("allocation-retained-source");
      await expect(frame.locator("a.tlink").filter({ hasText: "Big Pharma" })).toHaveCount(1);
      const geometry = await frame.locator("html").evaluate(root => ({ width: innerWidth, scroll: root.scrollWidth, duplicateNav: [...document.querySelectorAll(".site-nav")].some(node => getComputedStyle(node).display !== "none") }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width); expect(geometry.duplicateNav).toBe(false);
      await page.screenshot({ path: info.outputPath(`${cell.name}-returned.png`) }); states.push({ returned: page.url(), geometry });
      expect(observations.baselines).toEqual([]); expect(observations.mutations).toEqual([]);
      expect(observations.blockedTelemetryAttempts.every(attempt => ["shell", "legacy"].includes(attempt.origin) && attempt.method === "POST"
        && attempt.path === "/api/collect" && attempt.disposition === "blocked-before-transport")).toBe(true);
      expect(observations.pageErrors).toEqual([]);
    } finally {
      await info.attach("allocation-retained-source-journey", { body: JSON.stringify({ scope: "controlled retained source/bridge/geometry only; guest shell is NOT premium entitlement, current data, served or full Paper approval", observations, states }), contentType: "application/json" });
    }
  });
});
