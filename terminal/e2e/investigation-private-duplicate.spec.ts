import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import golden from "../lib/__tests__/fixtures/aapl-event-workspace.json";
import { canonicalInvestigationJson, type InvestigationManifest } from "../lib/investigationContracts";
import { normalizeEventWorkspace } from "../lib/eventWorkspace";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";

// Browser transport fixtures prove the mounted private-copy path; they do not
// establish production persistence, transitive rights or schema cutover.
test.setTimeout(120_000);
const originalId = "10000000-0000-4000-8000-000000000011";
const thesisId = "20000000-0000-4000-8000-000000000011";
const thesisVersion = "30000000-0000-4000-8000-000000000011";
const reference = {
  owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: golden.event_id,
  mode: "pinned" as const, version_ref: golden.generation_id, fingerprint: "a".repeat(64),
};
const basis: InvestigationManifest = {
  schema: "investigation_manifest.v2",
  intent: {
    title: "Retained private question", question: "  Which assumption explains the change?\n",
    subjects: [
      { kind: "security", owner: "terminal.analysis_symbol", object_id: "AAPL" },
      { kind: "security", owner: "terminal.analysis_symbol", object_id: "MSFT" },
      { kind: "issuer", owner: "data_os.security_master", object_id: golden.issuer.company_id },
    ],
    horizon: "Next two quarters", research_as_of: "2026-10-04T09:30:00.000Z",
  },
  layout_refs: [{ layout_id: "50000000-0000-4000-8000-000000000011", layout_revision_id: "60000000-0000-4000-8000-000000000011", digest: "b".repeat(64), role: "primary" }],
  thesis_refs: [{ thesis_id: thesisId, version_id: thesisVersion, role: "alternative" }],
  evidence_refs: [reference], review_baseline_ref: reference,
  argument_relations: [{
    source: { kind: "evidence", ...reference },
    target: { kind: "thesis", thesis_id: thesisId, version_id: thesisVersion },
    relation: "weakens", rationale: "Retain the original interpretation and author context.",
  }],
  continuation: { next_question: "What would falsify this?", next_observation: "The next reported margin." },
};
// An argument endpoint has no fingerprint field in the owner schema.
delete (basis.argument_relations![0].source as { fingerprint?: string }).fingerprint;
type Command = { id: string; operation_id: string; action: string; expected_revision: number; manifest: InvestigationManifest };
function committed(id: string, manifest: InvestigationManifest, operationId = "70000000-0000-4000-8000-000000000011", revision = 1) {
  return {
    status: "committed", id, revision, lifecycle: "active", manifest,
    committed_at: "2026-10-04T10:00:00Z", investigation_id: id,
    revision_id: `80000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    sequence: revision, parent_revision_id: revision === 1 ? null : `80000000-0000-4000-8000-${String(revision - 1).padStart(12, "0")}`,
    operation_id: operationId, author_ref: "40000000-0000-4000-8000-000000000011",
    recorded_at: "2026-10-04T10:00:00Z",
    manifest_digest: createHash("sha256").update(canonicalInvestigationJson(manifest)).digest("hex"),
  };
}
async function setup(page: Page, origin: string, lang: "en" | "zh") {
  await fixtureAuthSetup(page, origin);
  await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  await page.route("**/api/layouts", route => route.fulfill({ json: { layouts: [], teams: [], teamRead: { ok: true } } }));
  await page.route("**/api/investigations/baseline?*", route => route.fulfill({ json: {
    ok: true, workspace: normalizeEventWorkspace(golden), reference,
    receipt: { schema: "earnings.retained_baseline.v1", owner: reference.owner, company_id: golden.issuer.company_id,
      event_id: golden.event_id, generation_id: golden.generation_id, fingerprint: reference.fingerprint,
      public_known_at: golden.lifecycle.source_available_at, platform_known_at: golden.lifecycle.observed_at,
      generation_emitted_at: golden.generated_at, rights: { allowed: true, policy_version: "test.transport_only", checked_at: "2026-10-04T10:00:00Z" } },
  } }));
}

for (const lang of ["en", "zh"] as const) {
  test(`private duplicate preserves exact references and writes only on explicit Save — ${lang}`, async ({ page }, info) => {
    await setup(page, info.project.use.baseURL!, lang);
    const copy = lang === "en" ? { duplicate: "Duplicate as new research", cancel: "Cancel editing", save: "Save research", title: "Title", question: "Research question", status: "Unsaved copy of revision 1. Choose Save research to save a separate question." }
      : { duplicate: "复制为新研究", cancel: "取消编辑", save: "保存研究", title: "标题", question: "研究问题", status: "版本 1 的未保存副本。选择保存研究以保存独立问题。" };
    const originalBytes = canonicalInvestigationJson(basis);
    const commands: Command[] = [];
    let saved: ReturnType<typeof committed> | null = null;
    await page.route("**/api/investigations{,?*}", async route => {
      const request = route.request(), query = new URL(request.url()).searchParams;
      if (request.method() === "POST") {
        const command = request.postDataJSON() as Command; commands.push(command);
        saved = committed(command.id, command.manifest, command.operation_id);
        await route.fulfill({ json: saved }); return;
      }
      if (query.has("id")) {
        const record = query.get("id") === originalId ? committed(originalId, basis) : saved;
        await route.fulfill({ json: { ...record, status: "found", current_revision: 1, layouts: [] } }); return;
      }
      await route.fulfill({ json: { status: "listed", items: [
        { id: originalId, revision: 1, lifecycle: "active", title: basis.intent.title, question: basis.intent.question, updated_at: "2026-10-04T10:00:00Z" },
        ...(saved ? [{ id: saved.id, revision: 1, lifecycle: "active", title: saved.manifest.intent.title, question: saved.manifest.intent.question, updated_at: saved.committed_at }] : []),
      ] } });
    });
    await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=1`);
    const duplicate = page.getByRole("button", { name: copy.duplicate, exact: true });
    await expect(duplicate).toBeEnabled(); await duplicate.click();
    await expect(page.getByText(copy.status, { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy.title, { exact: true })).toHaveValue(basis.intent.title);
    await expect(page.getByLabel(copy.question, { exact: true })).toHaveValue(basis.intent.question);
    expect(commands).toHaveLength(0);
    await page.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(page.getByRole("heading", { name: basis.intent.title, exact: true })).toBeVisible();
    expect(commands).toHaveLength(0);
    await duplicate.click();
    await page.getByLabel(copy.title, { exact: true }).fill("A separate private question");
    await expect(page.getByText(copy.status, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: copy.save, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("private-duplicate-unsaved.png"), fullPage: true });
    await page.getByRole("button", { name: copy.save, exact: true }).click();
    await expect(page.getByRole("heading", { name: "A separate private question", exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ action: "create", expected_revision: 0 });
    expect(commands[0].id).not.toBe(originalId);
    expect(commands[0].manifest).toEqual({ ...basis, intent: { ...basis.intent, title: "A separate private question" } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "A separate private question", exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(canonicalInvestigationJson(basis)).toBe(originalBytes);
    await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=1`);
    await expect(page.getByRole("heading", { name: basis.intent.title, exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
  });
}

test("failed newer readback cannot turn an older visible revision into a duplicate", async ({ page }, info) => {
  await setup(page, info.project.use.baseURL!, "en");
  const commands: Command[] = []; let head = 1, failRead = false;
  let revisionTwo: InvestigationManifest | null = null;
  await page.route("**/api/investigations{,?*}", async route => {
    const request = route.request(), query = new URL(request.url()).searchParams;
    if (request.method() === "POST") {
      const command = request.postDataJSON() as Command; commands.push(command); head = 2; revisionTwo = command.manifest; failRead = true;
      await route.fulfill({ json: committed(originalId, revisionTwo, command.operation_id, 2) }); return;
    }
    if (query.has("id")) {
      if (failRead) { await route.fulfill({ status: 503, json: { status: "unavailable" } }); return; }
      const revision = Number(query.get("revision") || head);
      await route.fulfill({ json: { ...committed(originalId, revision === 1 ? basis : revisionTwo!, undefined, revision), status: "found", current_revision: head, layouts: [] } }); return;
    }
    await route.fulfill({ json: { status: "listed", items: [{ id: originalId, revision: head, lifecycle: "active", title: basis.intent.title, question: basis.intent.question, updated_at: "2026-10-04T10:00:00Z" }] } });
  });
  await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=1`);
  const duplicate = page.getByRole("button", { name: "Duplicate as new research", exact: true });
  await expect(duplicate).toBeEnabled();
  await page.getByRole("button", { name: "Edit saved question", exact: true }).click();
  await page.getByLabel("Research question", { exact: true }).fill("The newly committed question");
  await page.getByRole("button", { name: "Save research", exact: true }).click();
  await expect(page.getByText("Saved, but exact readback is unavailable. Reopen this revision to verify it.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await expect(duplicate).toBeDisabled();
  expect(commands).toHaveLength(1); expect(commands[0]).toMatchObject({ action: "revise", expected_revision: 1 });
  await page.screenshot({ path: info.outputPath("private-duplicate-unverified-revision.png"), fullPage: true });
  failRead = false;
  await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=2`);
  await expect(duplicate).toBeEnabled(); await duplicate.click();
  await expect(page.getByLabel("Research question", { exact: true })).toHaveValue("The newly committed question");
  expect(commands).toHaveLength(1);
});

for (const lang of ["en", "zh"] as const) {
  test(`copied research reopens both original competing beliefs after their heads advance — ${lang}`, async ({ page }, info) => {
    await setup(page, info.project.use.baseURL!, lang);
    const primaryId = "20000000-0000-4000-8000-000000000012";
    const primaryVersion = "30000000-0000-4000-8000-000000000012";
    const retained: InvestigationManifest = { ...basis, thesis_refs: [
      { thesis_id: primaryId, version_id: primaryVersion, role: "primary" },
      { thesis_id: thesisId, version_id: thesisVersion, role: "alternative" },
    ] };
    const c = lang === "en" ? { edit: "Edit saved question", browse: "Browse my Theses", version: "Version", cancel: "Cancel editing", duplicate: "Duplicate as new research", save: "Save research", title: "Title", open: "Open retained Theses", primary: "Primary", alternative: "Alternative", unavailable: "These exact Thesis versions are unavailable. Current beliefs have not replaced them." }
      : { edit: "编辑问题", browse: "浏览个人论点", version: "版本", cancel: "取消编辑", duplicate: "复制为新研究", save: "保存研究", title: "标题", open: "打开保留论点", primary: "主要", alternative: "替代", unavailable: "这些确切论点版本暂不可用，未替换为当前观点。" };
    const version = (primary: boolean, number: number) => ({
      id: number === 1 ? (primary ? primaryVersion : thesisVersion) : `30000000-0000-4000-8000-00000000002${primary ? "1" : "2"}`,
      thesisId: primary ? primaryId : thesisId, version: number, lifecycleState: "active",
      systemRecordedAt: "2026-10-04T00:00:00.000Z",
      content: { title: primary ? "Capacity belief" : "Demand belief", statement: number === 1
        ? (primary ? "Original capacity explains the margin." : "Original demand explains the margin.")
        : (primary ? "Amended capacity belief." : "Amended demand belief."),
        catalysts: ["Next reported margin"], falsifiers: ["Opposite margin result"], risks: ["Incomplete disclosure"], horizon: "quarters" },
      subject: { display: "Apple" },
    });
    const commands: Command[] = [], thesisReads: Array<{ id: string | null; revision: string | null }> = [];
    const unexpectedWrites: string[] = [];
    let saved: ReturnType<typeof committed> | null = null;
    let mode: "exact" | "old-investigation" | "wrong-version" | "missing-alternative" = "exact";
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET" && ["/api/theses", "/api/investigations/theses"].includes(path)) unexpectedWrites.push(path);
    });
    await page.route("**/api/theses{,?*}", route => {
      const id = new URL(route.request().url()).searchParams.get("id"), primary = id === primaryId;
      return route.fulfill({ json: id ? { thesis: { id, current: version(primary, 2), history: [version(primary, 2), version(primary, 1)], historyTruncated: false } }
        : { theses: [{ id: primaryId, title: "Capacity belief", currentVersion: 2 }, { id: thesisId, title: "Demand belief", currentVersion: 2 }], truncated: false } });
    });
    await page.route("**/api/investigations{,?*}", route => {
      const request = route.request(), query = new URL(request.url()).searchParams;
      if (request.method() === "POST") {
        const command = request.postDataJSON() as Command; commands.push(command);
        saved = committed(command.id, command.manifest, command.operation_id);
        return route.fulfill({ json: saved });
      }
      if (query.has("id")) return route.fulfill({ json: { ...(query.get("id") === originalId ? committed(originalId, retained) : saved), status: "found", current_revision: 1, layouts: [] } });
      return route.fulfill({ json: { status: "listed", items: [committed(originalId, retained), ...(saved ? [saved] : [])].map(record => ({ id: record.id, revision: 1, lifecycle: "active", title: record.manifest.intent.title, question: record.manifest.intent.question, updated_at: record.committed_at })) } });
    });
    await page.route("**/api/investigations/theses?*", route => {
      const query = new URL(route.request().url()).searchParams;
      thesisReads.push({ id: query.get("id"), revision: query.get("revision") });
      return route.fulfill({ json: { status: "resolved", id: mode === "old-investigation" ? originalId : query.get("id"), revision: Number(query.get("revision")), items: retained.thesis_refs.map((ref, i) =>
        mode === "missing-alternative" && i === 1 ? { ref, status: "unavailable" }
          : { ref, status: "available", version: version(i === 0, mode === "wrong-version" ? 2 : 1) }) } });
    });
    await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=1`);
    await page.getByRole("button", { name: c.edit, exact: true }).click();
    await page.getByRole("button", { name: c.browse, exact: true }).click();
    for (const label of ["Capacity belief", "Demand belief"]) {
      await page.getByRole("button", { name: `${label} · ${c.version} 2`, exact: true }).click();
      await expect(page.getByText(label === "Capacity belief" ? "Amended capacity belief." : "Amended demand belief.", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: c.cancel, exact: true }).click();
    expect(commands).toHaveLength(0);
    await page.getByRole("button", { name: c.duplicate, exact: true }).click();
    await page.getByLabel(c.title, { exact: true }).fill("Competing beliefs in a separate question");
    await page.getByRole("button", { name: c.save, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Competing beliefs in a separate question", exact: true })).toBeVisible();
    expect(commands).toHaveLength(1); expect(commands[0]).toMatchObject({ action: "create", expected_revision: 0 });
    expect(commands[0].id).not.toBe(originalId); expect(commands[0].manifest.thesis_refs).toEqual(retained.thesis_refs);
    const open = page.getByRole("button", { name: c.open, exact: true });
    const primaryBody = page.getByText("Original capacity explains the margin.", { exact: true });
    const alternativeBody = page.getByText("Original demand explains the margin.", { exact: true });
    const expectPins = async (id: string) => {
      await open.click(); await expect(primaryBody).toBeVisible(); await expect(alternativeBody).toBeVisible();
      await expect(page.getByText(c.primary, { exact: true })).toBeVisible();
      await expect(page.getByText(c.alternative, { exact: true })).toBeVisible();
      await expect(page.getByText("Amended capacity belief.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Amended demand belief.", { exact: true })).toHaveCount(0);
      expect(thesisReads.at(-1)).toEqual({ id, revision: "1" });
    };
    await expectPins(commands[0].id);
    await primaryBody.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("copied-competing-beliefs.png"), fullPage: true });
    await page.reload(); await expectPins(commands[0].id);
    for (const invalid of ["old-investigation", "wrong-version"] as const) {
      mode = invalid; await open.click();
      await expect(page.getByText(c.unavailable, { exact: true })).toBeVisible();
      await expect(primaryBody).toHaveCount(0); await expect(alternativeBody).toHaveCount(0);
      await expect(page.getByText("Amended capacity belief.", { exact: true })).toHaveCount(0);
    }
    mode = "missing-alternative"; await open.click();
    await expect(primaryBody).toBeVisible(); await expect(alternativeBody).toHaveCount(0);
    await expect(page.getByText(c.unavailable, { exact: true })).toBeVisible();
    await primaryBody.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("copied-alternative-unavailable.png"), fullPage: true });
    mode = "exact";
    await page.goto(`/analysis?view=investigations&investigation=${originalId}&revision=1`);
    await expectPins(originalId);
    expect(commands).toHaveLength(1); expect(unexpectedWrites).toHaveLength(0);
    expect(retained.thesis_refs).toEqual([{ thesis_id: primaryId, version_id: primaryVersion, role: "primary" }, { thesis_id: thesisId, version_id: thesisVersion, role: "alternative" }]);
  });
}
