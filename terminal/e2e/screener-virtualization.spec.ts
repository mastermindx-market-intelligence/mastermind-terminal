import { test, expect, type Request } from "@playwright/test";
import { prepare } from "./smartScreensFixture";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = "screener viewport regression";
const classificationCatalog = "/data/scan/classification.json";
// Count browser requests, not calls suppressed by cache/coverage/canonicalization.
// Any non-allowlisted financial path is visible, including plain SYMBOL.json.
const perSymbol = (path: string) => (path.startsWith("/data/") && !["/data/manifest.json", "/data/coverage.json", classificationCatalog].includes(path.split("?")[0])) || (path.startsWith("/api/flow") && new URL(path, "http://fixture.local").searchParams.get("f") !== "gexstate_index");
test.use({ locale: "en-US" });
for (const n of [100, 9500])
    test(`whole manifest ${n} keeps bounded rows and full results without financial fanout`, async ({ page, browser }, info) => {
        test.setTimeout(120000);
        const symbols: Record<string, unknown> = {}, move = [null, 2.999, 3, 6];
        const sym = (i: number) => `IW${String(i).padStart(5, "0")}`;
        for (let i = 0; i < n; i++)
            symbols[sym(i)] = { name: `Scale fixture ${i}`, last: 50 + (i % 7), chg: move[i % 4], vol: 2000000, sec: "Equities", mkt: "NASDAQ" };
        const body = JSON.stringify({ as_of: "2026-10-14", symbols });
        const served = JSON.parse(body) as {
            symbols: Record<string, {
                chg: number | null;
            }>;
        };
        expect(Object.keys(served.symbols)).toHaveLength(n);
        const expectedUp3 = Object.values(served.symbols).filter(r => r.chg !== null && r.chg >= 3).length;
        const bodyReads: Promise<void>[] = [], external: string[] = [];
        await page.route("**/*", r => { const u = new URL(r.request().url()); return u.origin === new URL(info.project.use.baseURL!).origin ? r.fallback() : r.abort("blockedbyclient"); });
        type Event = {
            path: string;
            method: string;
            type: string;
            at: number;
            status?: number;
            failed?: string;
            complete?: boolean;
            bodyBytes?: number;
            phase: string;
        };
        const events: Event[] = [], pending = new Map<Request, Event>(), checkpoints: unknown[] = [];
        let phase = "initial", err: string | null = null;
        await prepare(page.context(), info.project.use.baseURL!, `iw2-scale-${n}-${info.project.name}`, false);
        page.on("request", r => { const u = new URL(r.url()); if (u.origin !== new URL(info.project.use.baseURL!).origin) {
            external.push(u.origin + u.pathname);
            return;
        } const e = { path: u.pathname + u.search, method: r.method(), type: r.resourceType(), at: performance.now(), phase }; events.push(e); pending.set(r, e); });
        page.on("response", res => { const e = pending.get(res.request()); if (e) {
            e.status = res.status();
            if (e.path.split("?")[0] === "/data/manifest.json")
                bodyReads.push(res.body().then(b => { e.bodyBytes = b.length; }));
        } });
        page.on("requestfinished", r => { const e = pending.get(r); if (e)
            e.complete = true; pending.delete(r); });
        page.on("requestfailed", r => { const e = pending.get(r); if (e)
            e.failed = r.failure()?.errorText; pending.delete(r); });
        await page.route("**/data/manifest.json**", route => route.fulfill({ contentType: "application/json", body, headers: { "content-length": String(Buffer.byteLength(body)) } }));
        await page.route("**/api/flow?f=gexstate_index*", route => route.fulfill({ status: 404, json: { status: "fixture_absent" } }));
        await page.route("**/data/coverage.json**", route => route.fulfill({ status: 404, json: { status: "fixture_absent" } }));
        // One global catalog is independently absent, never a per-listing financial read.
        await page.route(`**${classificationCatalog}`, route => route.fulfill({ status: 404, json: { status: "fixture_absent" } }));
        await page.route("**/data/IWDETECT.slice.json", route => route.fulfill({ json: { detector: "control" } }));
        const financial = () => events.filter(x => x.path.startsWith("/data/") || x.path.startsWith("/api/flow"));
        const writes = () => events.filter(x => x.path.startsWith("/api/") && x.path !== "/api/collect" && !["GET", "HEAD"].includes(x.method));
        const count = page.locator(".scr2-status > span").first().locator("b").first();
        const rows = page.locator("tbody tr .sym-cell");
        const search = page.locator("input.scr2-search");
        const moveSelect = page.locator("select.scr2-select:has(option[value='up3'])");
        const settle = async () => { await expect.poll(() => [...pending.values()].filter(x => x.path === "/data/manifest.json" || x.path.startsWith("/api/flow?f=gexstate_index") || x.path.split("?")[0] === classificationCatalog).length, { timeout: 15000 }).toBe(0); await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))); };
        const checkpoint = async (name: string) => checkpoints.push({ name, visibleRows: await rows.count(), resultCount: await count.textContent(), dataRequests: financial().map(x => ({ ...x })), geometry: await page.locator(".scr2-table").evaluate(el => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, documentHeight: document.documentElement.scrollHeight, scrollTop: el.scrollTop, windowY: window.scrollY })), at: performance.now() });
        try {
            await page.goto("/discover?tab=screener");
            await expect(count).toHaveText(n.toLocaleString("en-US"), { timeout: 45000 });
            await expect(page.locator(".scr2-asof")).toContainText("2026-10-14");
            await settle();
            expect(await rows.count()).toBeGreaterThan(0);
            expect(await rows.count()).toBeLessThan(n);
            await expect.poll(() => page.locator(".scr2-table").evaluate(el => el.clientHeight)).toBeLessThanOrEqual(info.project.use.viewport!.height);
            await checkpoint("all-rows-counted-rendered-count-retained");
            await expect(page.locator("[data-scr-fault],tr.scr2-skel-row,.scr2-hidden")).toHaveCount(0);
            await expect(page.locator("main.scr2.u-view")).toBeVisible();
            await expect(page.locator("table.scr2 thead th")).toHaveCount(8);
            const pitch = await page.locator("tbody tr:has(.sym-cell)").first().evaluate(el => el.getBoundingClientRect().height);
            expect(pitch).toBe(44);
            const spacers = await page.locator("tr.scr2-spacer").evaluateAll(els => els.reduce((sum, el) => sum + parseFloat((el as HTMLElement).style.height), 0));
            expect(spacers / pitch + await rows.count()).toBe(n);
            await Promise.all(bodyReads);
            expect(events.find(e => e.path.split("?")[0] === "/data/manifest.json")?.bodyBytes).toBe(Buffer.byteLength(body));
            const initial = financial().length;
            phase = "UI-only-filter-search-sort";
            await search.fill(sym(n - 1));
            await expect(count).toHaveText("1");
            await expect(rows).toHaveCount(1);
            await expect(rows.first()).toContainText(sym(n - 1));
            await expect(page.locator("tbody tr:has(.sym-cell)").first()).toContainText((50 + ((n - 1) % 7)).toFixed(2));
            await page.screenshot({ path: info.outputPath("tail.png"), fullPage: false });
            await checkpoint("tail-exact");
            await search.fill("");
            await moveSelect.selectOption("up3");
            await expect(moveSelect).toHaveValue("up3");
            await expect(count).toHaveText(expectedUp3.toLocaleString("en-US"));
            for (const offset of [1, 2, 3, 4]) {
                await search.fill(sym(n - offset));
                await expect(count).toHaveText(offset <= 2 ? "1" : "0");
                await checkpoint(`boundary-tail-minus-${offset}`);
            }
            await search.fill("");
            await expect(count).toHaveText(expectedUp3.toLocaleString("en-US"));
            await moveSelect.selectOption("any");
            await expect(count).toHaveText(n.toLocaleString("en-US"));
            await page.locator(".scr2-table th").first().click();
            await page.locator(".scr2-table th").first().click();
            await page.locator(".scr2-table").hover();
            await page.mouse.wheel(0, 1000000);
            await expect.poll(() => rows.allTextContents()).toContainEqual(expect.stringContaining(sym(n - 1)));
            await settle();
            await checkpoint("sorted-scrolled-tail");
            await page.screenshot({ path: info.outputPath("universe-bottom.png"), fullPage: false });
            expect(financial().length).toBe(initial);
            expect(financial().filter(x => perSymbol(x.path))).toEqual([]);
            expect(writes()).toEqual([]);
            const observedManifest = financial().filter(x => x.path.split("?")[0] === "/data/manifest.json");
            expect(observedManifest.filter(x => x.status === 200 && x.complete).length).toBe(1);
            const observedCatalog = financial().filter(x => x.path.split("?")[0] === classificationCatalog);
            expect(observedCatalog).toHaveLength(1);
            expect(observedCatalog[0]).toMatchObject({ method: "GET", status: 404, complete: true, phase: "initial" });
            phase = "detector-positive-control";
            const before = events.filter(x => perSymbol(x.path)).length;
            await page.evaluate(() => fetch("/data/IWDETECT.slice.json").then(r => r.json()));
            await expect.poll(() => events.filter(x => perSymbol(x.path)).length).toBe(before + 1);
            expect(events.filter(x => perSymbol(x.path) && x.phase !== "detector-positive-control")).toEqual([]);
            expect(external).toEqual([]);
        }
        catch (e) {
            err = String(e);
            throw e;
        }
        finally {
            writeFileSync(info.outputPath("SCALING_MEASUREMENTS.json"), JSON.stringify({ source, n, browser: browser.version(), viewport: info.project.use.viewport, manifestBytes: Buffer.byteLength(body), manifestSha256: createHash("sha256").update(body).digest("hex"), fixedMovePartition: move, expectedUp3, external, checkpoints, events, unfinished: [...pending.values()], ownerWrites: writes(), error: err, scope: "Actual Chromium browser request census with route-fulfilled manifest bytes, fixed absent flow/coverage/global classification, fresh context per cell and prewarmed devserver. Positive control verifies request classifier only, not cache-mediated app calls. Not production, wire-transfer bytes, pipeline, Brain, full saved-screen integration, cache-attempt count or SLO acceptance." }, null, 2) + "\n");
        }
    });
