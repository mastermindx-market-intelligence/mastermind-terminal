/** Real Next.js AppShell smoke proof for the explicitly development-only route.
 * Requires an operator-started loopback-only Next dev server with ADMIN_DEV=1 and
 * TERMINAL_E2E_FIXTURE=1. Never targets production or accesses a retained feed.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { terminal, proofDirectory } from "./serve.mjs";
const require = createRequire(resolve(terminal, "package.json"));
const { chromium, webkit, expect } = require("@playwright/test");
const raw = process.env.FACTOR_ATLAS_LOCAL_URL || "http://127.0.0.1:49281";
const origin = new URL(raw);
assert(origin.protocol === "http:" && origin.hostname === "127.0.0.1"
  && origin.pathname === "/" && !origin.username && !origin.password,
  "Shell browser proof requires a 127.0.0.1 HTTP origin; no production host.");
const sourcePaths = [
 "terminal/app/(shell)/admin/factor-atlas-preview/page.tsx",
 "terminal/components/factor-atlas/FactorHistoryShellPreview.tsx",
 "terminal/components/factor-atlas/FactorHistoryPreview.tsx",
 "terminal/components/factor-atlas/FactorHistoryPreview.module.css",
 "terminal/lib/factorAtlasHistory.ts",
 "terminal/lib/__tests__/fixtures/factorAtlasNativeSynthetic.json",
];
const repo = resolve(terminal, "..");
const hash = async (path) => createHash("sha256").update(await readFile(resolve(repo, path))).digest("hex");
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, await hash(path)])));
const proof = { schema:"factor_atlas.next_shell_dev_browser_proof.v1",
  sourceHashes, observedAt: new Date().toISOString(),
  scope:"REAL_NEXT_SHELL_DEVELOPMENT_ONLY_SYNTHETIC_FIXTURE",
  productionAccess:false, admittedSource:false, authenticatedProduction:false,
  viewports:[[1440,900],[820,1180],[390,844]], themes:["dark","light"],languages:["en","zh"],
  browsers:["chromium","webkit"], results:[], complete:false };
const captures = resolve(proofDirectory,"next-shell-screenshots");
await mkdir(captures,{ recursive:true });
try {
  for (const [name, browserType] of [["chromium",chromium],["webkit",webkit]]) {
    const browser = await browserType.launch({headless:true});
    try {
      for (const [width,height] of proof.viewports) for (const theme of proof.themes) for (const lang of proof.languages) {
        const ctx = await browser.newContext({viewport:{width,height}, colorScheme:theme,
          locale:lang==="zh"?"zh-CN":"en-US"});
        const label=`${name}-${width}-${theme}-${lang}`, errors=[];
        await ctx.addCookies([{name:"mm_e2e_rs30",value:"1",url:origin.origin}]);
        await ctx.addInitScript(({lang,theme})=>{
          const apply = () => {
            if (!document.documentElement) return false;
            document.documentElement.setAttribute("data-lang",lang);
            document.documentElement.setAttribute("data-theme",theme);
            localStorage.setItem("mm.lang",lang);
            return true;
          };
          if (!apply()) {
            const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
            observer.observe(document, { childList: true });
          }
        },{lang,theme});
        const page=await ctx.newPage();
        page.on("pageerror",error=>errors.push(error.message));
        const r={label,browser:name,viewport:{width,height},lang,theme,checks:[],ok:false};
        try {
          const resp=await page.goto(new URL("/admin/factor-atlas-preview",origin).href,{waitUntil:"networkidle",timeout:60000});
          assert.equal(resp?.status(),200,"Next dev owner preview HTTP status");
          await expect(page.getByText(lang==="zh"?"合成数据预览 — 非实时市场数据":"Synthetic preview — not live market data",{exact:true})).toBeVisible();
          await expect(page.locator('[data-metric="window-return"]')).toHaveText("0.0%");
          await expect(page.getByLabel(lang==="zh"?"查找因子":"Find factors",{exact:true})).toBeVisible();
          await expect(page.locator('svg[role="img"]')).toHaveCount(1);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"horizontal overflow");
          r.checks.push("real_next_shell","dev_owner_gate","localized_synthetic_label","source_return","search","svg","no_overflow");
          if ((width===1440 || width===390) && name==="chromium") {
            await page.screenshot({path:resolve(captures,label+".png"),fullPage:true});
          }
          const anchor=page.getByLabel(lang==="zh"?"参考日期":"Comparison anchor",{exact:true});
          await anchor.fill("2026-01-29");
          await expect(page.locator('[data-metric="window-return"]')).toHaveText("-25.0%");
          await anchor.fill("2026-01-27");
          await expect(page.locator("svg[role='img']")).toHaveCount(0);
          r.checks.push("source_holdings_preserved","exact_anchor_no_fallback");
          assert.deepEqual(errors,[],"page runtime errors");r.checks.push("zero_page_errors");r.ok=true;
        }catch(e){r.error=String(e);r.pageErrors=errors;throw e;}
        finally {proof.results.push(r);await ctx.close();}
      }
    } finally {await browser.close();}
    console.log(`${name}: ${proof.results.filter(r=>r.browser===name&&r.ok).length} contexts passed`);
  }
  for (const [path,expected] of Object.entries(sourceHashes)) assert.equal(await hash(path),expected,"source drift: "+path);
  proof.complete=proof.results.length===24 && proof.results.every(r=>r.ok);
  assert(proof.complete,"incomplete browser coverage");
} catch (e) {proof.failure=String(e);process.exitCode=1;console.error(e);}
finally {
  await writeFile(resolve(proofDirectory,"next-shell-browser-proof.json"),JSON.stringify(proof,null,2)+"\n");
  console.log(JSON.stringify({complete:proof.complete,passes:proof.results.filter(x=>x.ok).length,total:24}));
}
