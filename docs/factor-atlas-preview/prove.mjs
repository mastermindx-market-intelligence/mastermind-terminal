// Real component in fresh local browser contexts. Synthetic data only; no login/production proof.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { startPreview, terminal, proofDirectory } from "./serve.mjs";

const require = createRequire(resolve(terminal, "package.json"));
const { chromium, webkit, expect } = require("@playwright/test");
const widths = [{ width:1440,height:900 }, { width:820,height:1180 }, { width:390,height:844 }];
const sourcePaths = ["lib/factorAtlasHistory.ts", "components/factor-atlas/FactorHistoryPreview.tsx",
  "components/factor-atlas/FactorHistoryPreview.module.css", "components/charts/svgChart.ts",
  "lib/__tests__/fixtures/factorAtlasNativeSynthetic.json"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p =>
  [p, createHash("sha256").update(await readFile(resolve(terminal, p))).digest("hex")])));
const evidence = { schema:"factor_atlas.terminal_component_browser_proof.v1", observedAt:new Date().toISOString(),
  sourceHashes:await hashes(), environment:{ node:process.version,platform:process.platform },
  scope:"LOCAL_BUNDLED_NATIVE_COMPONENT_SYNTHETIC_ONLY", expectedContexts:24, results:[], unavailableEngines:[],
  authenticatedProduction:false, sourceAdmission:false, customerPublication:false, complete:false };
await mkdir(resolve(proofDirectory,"screenshots"),{ recursive:true });
let preview;
try {
  preview = await startPreview();
  for (const [engineName, engine] of [["chromium",chromium],["webkit",webkit]]) {
    if (!existsSync(engine.executablePath())) { evidence.unavailableEngines.push(engineName); continue; }
    const browser = await engine.launch({ headless:true });
    try {
      for (const viewport of widths) for (const theme of ["dark","light"]) for (const lang of ["en","zh"]) {
        const id = `${engineName}-${viewport.width}-${theme}-${lang}`, errors=[], external=[];
        const context = await browser.newContext({ viewport, colorScheme:theme, locale:lang==="zh"?"zh-CN":"en-US" });
        const page = await context.newPage();
        page.on("pageerror",error=>errors.push(error.message));
        page.on("request",request=>{ if (!request.url().startsWith(preview.url+"/") && !request.url().startsWith("data:")) external.push(request.url()); });
        const go = async (extra="") => { await page.goto(`${preview.url}/?lang=${lang}&theme=${theme}${extra}`,{ waitUntil:"networkidle" }); await expect(page.locator("h2")).toHaveText("Factor Atlas"); };
        const checkWidth = async () => assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"document overflow");
        const row = { id,engine:engineName,version:browser.version(),viewport,theme,lang,checks:[],ok:false };
        try {
          await go();
          await expect(page.getByText(lang==="zh"?"合成数据预览 — 非实时市场数据":"Synthetic preview — not live market data",{exact:true})).toBeVisible();
          await expect(page.locator('[data-metric="window-return"]')).toHaveText("0.0%");
          await expect(page.locator('svg[role="img"]')).toHaveCount(1);
          await checkWidth();
          const geometry = await page.locator("svg").evaluate(svg=>({width:svg.getBoundingClientRect().width,viewBox:svg.viewBox.baseVal.width,distorted:svg.getAttribute("preserveAspectRatio")==="none"}));
          assert(Math.abs(geometry.width-geometry.viewBox)<1 && !geometry.distorted,"pixel-space SVG");
          const tickLabels=await page.locator("svg text").allTextContents();const yLabels=tickLabels.filter(t=>t.endsWith("%"));
          assert.equal(new Set(yLabels).size,yLabels.length,"duplicate axis labels");
          await page.screenshot({path:resolve(proofDirectory,"screenshots",id+".png"),fullPage:true});
          row.checks.push("synthetic_label","source_round_trip","pixel_space_svg","unique_ticks","no_overflow");
          const anchor=page.getByLabel(lang==="zh"?"参考日期":"Comparison anchor",{exact:true});
          await anchor.fill("2026-01-29");
          await expect(page.locator('[data-metric="window-return"]')).toHaveText("-25.0%");
          await anchor.fill("2026-01-27");await expect(page.locator("svg")).toHaveCount(0);
          await anchor.fill("2026-01-28");await expect(page.locator('[data-metric="window-return"]')).toHaveText("0.0%");
          await page.locator('input[type="checkbox"]').uncheck();await expect(page.locator("svg")).toHaveCount(0);
          await expect(anchor).toHaveValue("2026-01-28");
          row.checks.push("date_change_not_rebalance","exact_anchor_no_fallback","selection_keeps_dates");
          await go("&case=gap");await expect(page.locator('[data-metric="window-return"]')).toHaveText("—");
          await page.locator("summary").click();await expect(page.locator('[data-observation="2026-01-30"]')).toContainText("—");
          await checkWidth();row.checks.push("gap_preserved","no_gap_table_overflow");
          await go("&case=compare");await expect(page.locator('[data-metric="window-return"]')).toHaveCount(2);
          await expect(page.locator('[data-metric="window-return"]').nth(1)).toHaveText("+3.0%");
          await expect(page.locator("path[data-series]")).toHaveCount(2);
          await checkWidth();row.checks.push("two_factor_comparison","no_comparison_overflow");
          if(engineName==="chromium" && theme==="dark" && lang==="en") await page.screenshot({path:resolve(proofDirectory,"screenshots",id+"-compare.png"),fullPage:true});
          await go("&case=incompatible");await expect(page.locator("svg")).toHaveCount(0);row.checks.push("mixed_mode_comparison_withheld");
          await go("&case=retained");await expect(page.locator("svg")).toHaveCount(0);
          await expect(page.getByText(lang==="zh"?"仅支持合成测试数据":"Synthetic fixture required",{exact:false})).toBeVisible();
          row.checks.push("retained_owner_not_preview_admission");
          await go("&audience=customer");await expect(page.locator("svg")).toHaveCount(0);
          await expect(page.getByText(lang==="zh"?"需要完成数据源准入":"Source admission required",{exact:true})).toBeVisible();
          await expect(page.locator('[data-metric="window-return"]')).toHaveCount(0);
          row.checks.push("customer_withheld","no_customer_numeric_frame");
          assert.deepEqual(errors,[],"browser errors");assert.deepEqual(external,[],"external source requests");
          row.checks.push("no_browser_errors","no_external_requests");row.ok=true;
        } catch(error) { row.error=String(error);row.browserErrors=errors;throw error; }
        finally { evidence.results.push(row);await context.close(); }
      }
      console.log(`${engineName}: ${evidence.results.filter(r=>r.engine===engineName&&r.ok).length} contexts passed`);
    } finally { await browser.close(); }
  }
  assert.deepEqual(await hashes(),evidence.sourceHashes,"source changed during browser proof");
  evidence.complete=evidence.results.length===24&&evidence.results.every(r=>r.ok);
  if(!evidence.complete) process.exitCode=1;
} catch(error) { evidence.failure=String(error);process.exitCode=1;console.error(String(error)); }
finally {
  if(preview) await preview.close();
  await writeFile(resolve(proofDirectory,"browser-proof.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({complete:evidence.complete,passed:evidence.results.filter(r=>r.ok).length,expected:24,unavailable:evidence.unavailableEngines}));
}
