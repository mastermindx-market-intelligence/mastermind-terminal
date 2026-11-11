import { expect, test } from "@playwright/test";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";
import { selectAppearance } from "./presentationControls";

// Local inert consumer fixtures, never an authenticated production proof.
const snapshot = { schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-11-04T01:00:00Z", _build_meta: { asof_date: "2026-11-03" }, spot: 600,
  _matrix_source_identity: { schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: "2026-11-03", sha256: "a".repeat(64), byte_length: 1234 },
  cells: [{ strike: 600, expiry: "2026-11-20", gex: 100, call_vol: 20, put_vol: 0, call_oi: 5, put_oi: null }] };
for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`exact Lab question stage and withdrawal ${lang} ${theme}`, async ({ page }, info) => {
    const errors: string[] = [], posts: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", req => { if (req.method() === "POST" && /brain|investigat|scenario/.test(req.url())) posts.push(req.url()); });
    await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" }]);
    await page.addInitScript(({lang,theme}) => { localStorage.setItem("mm.lang", lang); localStorage.setItem("mm.theme", theme); }, {lang,theme});
    await page.route("**/mm_brain.js*", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "/* inert widget; exact bridge installed below */" }));
    let reads = 0;
    await page.route("**/api/flow?*", route => {
      if (new URL(route.request().url()).searchParams.get("f") !== "matrix:SPY") return route.fallback();
      reads++; return route.fulfill({ json: snapshot });
    });
    await page.goto("/options?tab=gex&view=research");
    const lab = page.getByRole("region", { name: lang === "en" ? "3D Research Lab" : "3D 期权研究室", exact: true });
    await expect(lab).toBeVisible({timeout:30000});
    await selectAppearance(page, lang, theme);
    await page.evaluate(principal => {
      const target = window as unknown as { MMBrain: object; MM_BRAIN_CFG?: { principal?: string | null }; __questionTest: { staged: unknown[]; cleared: unknown[] } };
      target.__questionTest = { staged: [], cleared: [] };
      target.MM_BRAIN_CFG = { ...target.MM_BRAIN_CFG, principal };
      target.MMBrain = {
        submitOptionsQuestion: (ref: unknown) => { target.__questionTest.staged.push(ref); return true; },
        clearOptionsQuestion: (ref: unknown) => { target.__questionTest.cleared.push(ref); return true; },
      };
    }, fixtureUserId("default"));
    const action = lab.getByTestId("research-question-action"), button = action.getByRole("button");
    await expect(button).toBeDisabled();
    await lab.getByRole("button", {name: lang === "en" ? "600 Call · 2026-11-20" : "600 看涨 · 2026-11-20", exact:true}).click();
    await expect(button).toBeEnabled(); await button.click();
    await expect(action.getByRole("status")).toContainText(lang === "en" ? "Selection staged in Brain" : "请在那里检查并发送");
    const read = () => page.evaluate(() => (window as unknown as {__questionTest:{staged:{evidence:{fingerprint:string};selection:string}[];cleared:unknown[]}}).__questionTest);
    const first = await read(); expect(first.staged).toHaveLength(1);
    expect(first.staged[0].evidence.fingerprint).toBe("a".repeat(64));
    expect(JSON.parse(first.staged[0].selection).primary).toEqual({expiry:"2026-11-20",side:"call",strike:"600"});
    await action.screenshot({path:info.outputPath(`question-${lang}-${theme}.png`)});
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await lab.getByRole("button", {name:lang === "en" ? "Replay & change" : "回放与变化",exact:true}).click();
    await expect(button).toBeDisabled(); expect((await read()).cleared).toEqual(first.staged);
    await lab.getByRole("button", {name:lang === "en" ? "Chain landscape" : "期权链分布",exact:true}).click();
    await button.click();
    await lab.getByRole("button", {name:lang === "en" ? "Back to Exposure" : "返回敞口",exact:true}).click();
    expect((await read()).cleared).toHaveLength(2); expect(reads).toBe(1); expect(posts).toEqual([]); expect(errors).toEqual([]);
  });
}
