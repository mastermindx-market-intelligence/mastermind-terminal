import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";
import { canonicalInvestigationJson, type InvestigationManifest } from "../lib/investigationContracts";

test.setTimeout(120000);
for (const lang of ["en", "zh"] as const) test(`rejected observation remains an exact request snapshot — ${lang}`, async ({ page }, info) => {
  const copy = lang === "en"
    ? { summary: "Retained draft", heading: "Next observation", field: "Next observation (optional)", latest: "Open latest revision" }
    : { summary: "保留的草稿", heading: "下一项观察", field: "下一项观察（可选）", latest: "打开最新修订" };
  const observation = lang === "en"
    ? "  Observe margin <5% & the next report.\nKeep this original condition.  "
    : "  观察利润率 <5% & 下一份报告。\n保留这一原始条件。  ";
  const manifest: InvestigationManifest = {
    schema: "investigation_manifest.v2", argument_relations: [],
    intent: { title: "Rejected request", question: "Keep this exact request", subjects: [] },
    layout_refs: [], thesis_refs: [], evidence_refs: [],
    continuation: { next_question: "Original next question", next_observation: observation },
  };
  const command = { id: "10000000-0000-4000-8000-000000000021", operation_id: "20000000-0000-4000-8000-000000000021", action: "revise", expected_revision: 3, manifest };
  const owner = "e2e00000-0000-4000-8000-000000000001";
  const key = `mm.investigation.pending.v2:${owner}`;
  const retained = JSON.stringify({ owner, command, phase: "rejected", reason: "limit_reached" });
  const latest = structuredClone(manifest);
  latest.intent.title = "Later owner revision";
  latest.continuation.next_observation = "A different later owner observation";
  const originalLatest = canonicalInvestigationJson(latest);
  const writes: string[] = [], operationReads: string[] = [], telemetry: string[] = [];
  await fixtureAuthSetup(page, info.project.use.baseURL!);
  await page.addInitScript(({ lang, key, retained }) => {
    localStorage.setItem("mm.lang", lang);
    if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, retained);
  }, { lang, key, retained });
  await page.route("**/api/collect", async route => { telemetry.push(route.request().method()); await route.fulfill({ status: 204 }); });
  await page.route("**/api/layouts", route => route.fulfill({ json: { layouts: [], teams: [], teamRead: { ok: true } } }));
  await page.route("**/api/investigations{,?*}", async route => {
    const request = route.request(), q = new URL(request.url()).searchParams;
    if (request.method() !== "GET") { await route.abort(); return; }
    if (q.has("operation_id")) { operationReads.push(q.get("operation_id")!); await route.fulfill({ status: 503, json: { status: "unavailable" } }); return; }
    if (q.has("id")) {
      expect(q.get("id")).toBe(command.id);
      await route.fulfill({ json: { status: "found", id: command.id, revision: 4, current_revision: 4, lifecycle: "active", manifest: latest, committed_at: "2026-10-14T01:00:00.000Z", layouts: [] } }); return;
    }
    await route.fulfill({ json: { status: "listed", items: [] } });
  });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && path !== "/api/collect" && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${path}`);
  });
  await page.goto("/analysis?view=investigations");
  const details = page.locator("details").filter({ has: page.locator("summary", { hasText: copy.summary }) });
  const region = details.getByRole("region", { name: copy.heading, exact: true });
  const field = page.getByLabel(copy.field, { exact: true });
  await expect(field).toHaveValue(observation);
  await details.locator("summary").click();
  await expect(region).toBeVisible();
  expect(await region.locator("p").textContent()).toBe(observation);
  await region.scrollIntoViewIfNeeded(); await region.screenshot({ path: info.outputPath("original-request-observation.png") });
  await field.fill("A later unsaved editor draft");
  expect(await region.locator("p").textContent()).toBe(observation);
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(retained);
  await page.getByRole("button", { name: copy.latest, exact: true }).click();
  await expect(page.getByRole("heading", { name: latest.intent.title, exact: true })).toBeVisible();
  const saved = page.getByRole("region", { name: lang === "en" ? "Saved question" : "已保存问题", exact: true });
  await expect(saved.getByRole("region", { name: copy.heading, exact: true })).toContainText(latest.continuation.next_observation!);
  expect(await region.locator("p").textContent()).toBe(observation);
  await details.scrollIntoViewIfNeeded(); await details.screenshot({ path: info.outputPath("retained-beside-newer-owner.png") });
  await page.reload();
  await expect(field).toHaveValue(observation);
  await details.locator("summary").click();
  expect(await region.locator("p").textContent()).toBe(observation);
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(retained);
  expect(canonicalInvestigationJson(latest)).toBe(originalLatest);
  expect(writes).toEqual([]); expect(operationReads).toEqual([]);
  writeFileSync(info.outputPath("OWNER_EXACT.json"), JSON.stringify({ lang, retained, finalRetained: await page.evaluate(key => sessionStorage.getItem(key), key), latest: originalLatest, finalLatest: canonicalInvestigationJson(latest), writes, operationReads, telemetry, scope: "Isolated rejected-request snapshot and a different later owner revision; no resend, new save, live owner or release effect" }, null, 2) + "\n");
});
