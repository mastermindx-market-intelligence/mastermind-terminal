import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";
import { isolateWatchlistStore } from "./watchlistStore";
import type { InvestigationManifest } from "../lib/investigationContracts";
import type { ThesisDetail } from "../lib/theses";

// Compose the actual Thesis fixture owner and mounted editor with two retained
// Investigation transport fixtures. This does not claim live schema or rights acceptance.
test.setTimeout(120_000);
for (const zh of [false, true]) {
  test(`explicit Thesis amendment leaves two saved questions on their original belief (${zh ? "zh" : "en"})`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await fixtureAuthSetup(page, baseURL!);
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), zh ? "zh" : "en");
    await page.route("**/api/brain/me", route => route.fulfill({ json: { tier: "guest", quotas: { fast: { remaining: 0, limit: 0, period: "day" }, pro: { remaining: 0, limit: 0, period: "day" } } } }));
    const subject = {
      schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol",
      key: "AAPL", identityState: "listing_scoped", listing: { symbol: "AAPL", mic: null, securityId: null },
      companyId: null, display: "AAPL · listing scoped",
    };
    const originalContent = {
      schema: "mastermind.thesis-content/v1", title: "Capacity and margins",
      statement: "Original capacity explains the margin.", catalysts: ["Next factory disclosure"],
      falsifiers: ["Utilization falls"], risks: ["Demand attribution is incomplete"], horizon: "quarters",
      effectiveAt: "2026-10-01T09:30:00.000Z", revisionNote: "Original rationale: compare utilization before attributing demand.",
    };
    const created = await page.request.post("/api/theses", { data: { action: "create", clientRequestId: randomUUID(), subject, content: originalContent } });
    expect(created.status()).toBe(201);
    const thesisId = (await created.json()).thesisId as string;
    const readOwner = async (): Promise<ThesisDetail> => {
      const response = await page.request.get(`/api/theses?id=${thesisId}`);
      expect(response.ok()).toBe(true);
      return (await response.json()).thesis;
    };
    const original = (await readOwner()).current;
    const seeded = await page.request.post("/api/theses", { data: {
      action: "revise", id: thesisId, expectedVersion: 1, clientRequestId: randomUUID(), subject,
      content: { ...originalContent, statement: "Current working interpretation before the new amendment.", revisionNote: "Intervening owner revision." },
    } });
    expect(seeded.ok()).toBe(true);
    const ids: string[] = [randomUUID(), randomUUID()];
    const manifests: InvestigationManifest[] = ids.map((_, i) => ({
      schema: "investigation_manifest.v2", intent: { title: i ? "Copied question" : "Original question", question: "Which assumption explains the margin?", subjects: [] },
      layout_refs: [], thesis_refs: [{ thesis_id: thesisId, version_id: original.id, role: "primary" }], evidence_refs: [],
      continuation: { next_question: "What would falsify the original interpretation?" },
    }));
    const writes: unknown[] = [], investigationWrites: string[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/theses") writes.push(request.postDataJSON());
    });
    await page.route("**/api/investigations{,?*}", route => {
      const request = route.request();
      if (request.method() !== "GET") { investigationWrites.push(request.method()); return route.fulfill({ status: 500, json: { status: "unavailable" } }); }
      const id = new URL(request.url()).searchParams.get("id"), i = ids.indexOf(id!);
      return route.fulfill({ json: i < 0 ? { status: "listed", items: [] } : { status: "found", id, revision: 1, current_revision: 1, lifecycle: "active", manifest: manifests[i], committed_at: "2026-10-13T00:00:00.000Z", layouts: [] } });
    });
    await page.route("**/api/investigations/theses?*", async route => {
      const query = new URL(route.request().url()).searchParams, i = ids.indexOf(query.get("id")!);
      expect(i).toBeGreaterThanOrEqual(0);
      const owner = await readOwner();
      const pinned = owner.history.find(version => version.id === manifests[i].thesis_refs[0].version_id);
      expect(pinned).toEqual(original);
      await route.fulfill({ json: { status: "resolved", id: ids[i], revision: 1, items: [{ ref: manifests[i].thesis_refs[0], status: "available", version: pinned }] } });
    });

    await page.goto(`/analysis?view=theses&thesis=${thesisId}`);
    const workspace = page.getByTestId("thesis-workspace");
    const inspect = workspace.getByRole("button", { name: zh ? "查看版本 1" : "Inspect version 1", exact: true });
    await inspect.click();
    const historical = workspace.getByTestId("thesis-version-inspector");
    await expect(historical).toHaveAttribute("data-posture", "historical");
    for (const text of [originalContent.statement, originalContent.revisionNote, ...originalContent.catalysts, ...originalContent.falsifiers, ...originalContent.risks, "terminal.analysis_symbol"]) await expect(historical).toContainText(text);
    await expect(historical).toContainText(zh ? "记录者" : "Recorded by");
    await expect(historical.locator("time")).toHaveAttribute("datetime", original.systemRecordedAt);
    expect(writes).toHaveLength(0);
    await historical.screenshot({ path: info.outputPath("original-rationale.png") });
    const statement = "New explicit amendment: capacity alone does not explain the margin.";
    const note = "Analyst amendment after reviewing the original rationale.";
    await workspace.getByLabel(zh ? "论点陈述" : "Thesis statement", { exact: true }).fill(statement);
    await workspace.getByLabel(zh ? "修订说明" : "Revision note", { exact: true }).fill(note);
    await workspace.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
    await expect.poll(async () => (await readOwner()).currentVersion).toBe(3);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ action: "revise", id: thesisId, expectedVersion: 2, subject, content: { statement, revisionNote: note } });
    const after = await readOwner();
    expect(after.current.id).not.toBe(original.id);
    expect(after.history.find(version => version.id === original.id)).toEqual(original);
    await page.reload();
    await expect(workspace.getByLabel(zh ? "论点陈述" : "Thesis statement", { exact: true })).toHaveValue(statement);
    await inspect.click();
    await expect(historical).toContainText(originalContent.revisionNote);
    await expect(historical).toContainText(originalContent.statement);

    for (const id of ids) {
      await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
      await page.getByRole("button", { name: zh ? "打开保留论点" : "Open retained Theses", exact: true }).click();
      await expect(page.getByText(originalContent.statement, { exact: true })).toBeVisible();
      await expect(page.getByText(statement, { exact: true })).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: zh ? "打开保留论点" : "Open retained Theses", exact: true }).click();
      await expect(page.getByText(originalContent.statement, { exact: true })).toBeVisible();
    }
    expect(writes).toHaveLength(1);
    expect(investigationWrites).toHaveLength(0);
    expect((await readOwner()).history.find(version => version.id === original.id)).toEqual(original);
  });
}
