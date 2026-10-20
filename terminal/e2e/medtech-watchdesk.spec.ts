import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import type { Event, Watch, Update } from "../lib/medtechClient";

// Synthetic source records and an in-memory BFF fixture. No production auth or
// database bypass is added: Playwright intercepts only the browser requests.
const GEN = "a".repeat(64), NEXT = "d".repeat(64), REV = "b".repeat(64), REV2 = "c".repeat(64);
const WATCH = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-20T08:00:00Z", BASE = "2026-10-01T10:00:00Z";
const source = {
  dataset: "510k", cadence: "monthly", dataset_updated_at: "2026-10-05", last_checked_at: NOW,
  status: "available", dataset_age_days: 15,
  coverage: { kind: "decision_date_range", start: "2026-01-01", end: "2026-10-20", records: 4, complete_for_query: true },
};
function event(id: string, name: string, pathway: string, status: string): Event {
  const pma = id.startsWith("fda-pma-"), native = id.replace(/^fda-(?:pma|510k)-/, "");
  const submission = native.replace(/-S\d+$/, ""), supplement = native.match(/-(S\d+)$/)?.[1] ?? null;
  return {
    event_id: id, submission_id: submission, parent_submission_id: supplement ? submission : null,
    pathway, pathway_label: pathway, device: { name, generic_name: "Qualification device", product_code: "QAA" },
    applicant: { name: "Evidence Fixture Medical" },
    decision: { code: status === "granted" ? "DENG" : status === "unmapped" ? "OK30" : "SESE", status,
      label: status, date: "2026-10-03", source_description: null },
    supplement: { number: supplement, reason: supplement ? "Manufacturing process" : null, type: supplement ? "30-Day Notice" : null },
    received_on: "2026-09-01",
    source: { dataset: pma ? "pma" : "510k", publisher: "FDA", record_id: native.replace("-S", "S"),
      url: pma ? "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=" + native.replace("-S", "S") :
        pathway === "de_novo" ? "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=" + native :
          "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=" + native,
      source_published_at: null },
    first_observed_at: NOW, last_observed_at: NOW, last_changed_at: NOW, revision_id: REV,
  };
}
const records = [
  event("fda-510k-K260001", "Precision catheter · qualification record", "510k", "cleared"),
  event("fda-510k-DEN260007", "Device identifier · qualification record", "de_novo", "granted"),
  event("fda-pma-P150012-S191", "Implantable pulse generator · qualification record", "pma_supplement", "unmapped"),
  event("fda-pma-N16837-S039", "Legacy submission · qualification record", "other_device_submission", "approved"),
];
function watch(subject = records[0].event_id, family = false): Watch {
  return { id: WATCH, subject_type: family ? "pma_application" : "event", subject_id: subject,
    triggers: family ? ["record_changed", "new_supplement"] : ["record_changed"],
    baseline_generation: GEN, baseline_revision: family ? null : REV, baseline_at: BASE,
    created_at: BASE, updated_at: BASE, version: 1 };
}
function update(revision = REV2, kind = "source_record_changed"): Update {
  return { event_id: records[0].event_id, revision_id: revision, observed_at: "2026-10-10T10:00:00Z",
    trigger: "record_changed", kind, decision_date: "2026-10-03", device_name: records[0].device.name,
    changes: [{ json_path: "/device/name", change_family: "device", op: "replace", before_state: "present",
      before_value: "Prior source name", after_state: "present", after_value: records[0].device.name }],
    source_url: records[0].source.url, reviewed: false };
}
class Fixture {
  generation = GEN;
  watches: Watch[] = [];
  reviews = new Set<string>();
  writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  saveStatus = 0;
  listStatus = 0;
  listHold?: Promise<void>;
  detailStatus = 0;
  historyStatus = 0;
  watchStatus = 0;
  conflict = false;
  authStatus = 0;
  continuationStale = false;
  changes: Update[] = [update(), update("e".repeat(64), "normalization_changed")];
  async handle(route: Route) {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/medtech", "");
    const method = request.method(), body = method === "GET" ? {} : request.postDataJSON();
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: { "Cache-Control": "private, no-store" } });
    const error = (status: number, code: string) => reply({ schema: "medtech.error/v1", code }, status);
    if (this.authStatus) return error(this.authStatus, this.authStatus === 401 ? "sign_in_required" : "subscription_required");
    if (method !== "GET") this.writes.push({ method, path, body });
    const requested = url.searchParams.get("snapshot_id");
    if (requested && requested !== this.generation) return error(409, "snapshot_changed");
    if (path === "/health") return reply({ schema: "medtech.health/v1", snapshot_id: this.generation,
      generated_at: NOW, state: "available", sources: [source] });
    if (path === "/events") {
      if (this.listHold) await this.listHold;
      if (this.listStatus) return error(this.listStatus, "source_unavailable");
      const offset = Number(url.searchParams.get("offset") || 0), q = (url.searchParams.get("q") || "").toLowerCase();
      if (offset && this.continuationStale) { this.generation = NEXT; this.continuationStale = false; return error(409, "snapshot_changed"); }
      const selected = records.filter(r => (!q || JSON.stringify(r).toLowerCase().includes(q)) &&
        (!url.searchParams.get("pathway") || r.pathway === url.searchParams.get("pathway")) &&
        (!url.searchParams.get("decision") || r.decision.status === url.searchParams.get("decision")));
      return reply({ schema: "medtech.events/v1", snapshot_id: this.generation, generated_at: NOW,
        items: selected.slice(offset, offset + 2), total: selected.length, next_offset: offset + 2 < selected.length ? offset + 2 : null, sources: [source] });
    }
    if (path.startsWith("/events/")) {
      const id = path.split("/")[2], row = records.find(r => r.event_id === id);
      if (!row) return error(404, "not_found");
      if (path.endsWith("/changes") && this.historyStatus) return error(this.historyStatus, "source_unavailable");
      if (!path.endsWith("/changes") && this.detailStatus) return error(this.detailStatus, "source_unavailable");
      if (path.endsWith("/changes")) return reply({ schema: "medtech.changes/v1", snapshot_id: this.generation, event_id: id,
        total: 1, next_offset: null, items: [{ revision_id: REV, observed_at: NOW, kind: "first_observed", changes: [],
          decision_date: row.decision.date, device_name: row.device.name }] });
      return reply({ schema: "medtech.event_detail/v1", snapshot_id: this.generation, event: row, history_count: 1 });
    }
    if (path === "/watches" && method === "GET") {
      if (this.watchStatus) return error(this.watchStatus, "watches_unavailable");
      return reply({ schema: "medtech.watches/v1", items: this.watches, limit: 50 });
    }
    if (path === "/watches" && method === "POST") {
      if (this.saveStatus) return error(this.saveStatus, this.saveStatus === 409 ? "watch_limit_reached" : "watches_unavailable");
      if (body.snapshot_id !== this.generation) return error(409, "snapshot_changed");
      const prior = this.watches.find(w => w.subject_id === body.subject_id && w.subject_type === body.subject_type);
      const saved = prior ?? { ...watch(String(body.subject_id), body.subject_type === "pma_application"), triggers: body.triggers as Watch["triggers"], baseline_generation: this.generation };
      if (!prior) this.watches.push(saved);
      return reply({ schema: "medtech.watch/v1", watch: saved, created: !prior });
    }
    if (path === "/watches/" + WATCH && method === "PATCH") {
      if (this.conflict) { this.conflict = false; this.watches[0] = { ...this.watches[0], version: 2 }; return error(409, "watch_changed"); }
      if (body.version !== this.watches[0]?.version) return error(409, "watch_changed");
      this.watches[0] = { ...this.watches[0], triggers: body.triggers as Watch["triggers"], version: this.watches[0].version + 1, updated_at: NOW };
      return reply({ schema: "medtech.watch/v1", watch: this.watches[0], created: false });
    }
    if (path === "/watches/" + WATCH && method === "DELETE") {
      if (body.version !== this.watches[0]?.version) return error(409, "watch_changed");
      this.watches = [];
      return reply({ schema: "medtech.watch_deleted/v1", id: WATCH });
    }
    if (path === "/watches/" + WATCH + "/updates") return reply({
      schema: "medtech.updates/v1", snapshot_id: this.generation, watch_id: WATCH,
      watch_version: this.watches[0]?.version ?? 1, baseline_at: BASE,
      total: this.changes.length, next_offset: null, items: this.changes.map(c => ({ ...c, reviewed: this.reviews.has(c.event_id + c.revision_id) })),
    });
    if (path === "/watches/" + WATCH + "/reviews" && method === "POST") {
      if (body.snapshot_id !== this.generation) return error(409, "snapshot_changed");
      this.reviews.add(String(body.event_id) + String(body.revision_id));
      return reply({ schema: "medtech.review/v1", watch_id: WATCH, event_id: body.event_id,
        revision_id: body.revision_id, reviewed: true, reviewed_at: NOW });
    }
    return error(404, "not_found");
  }
}
test.setTimeout(90_000);
async function setup(page: Page, fixture: Fixture, lang = "en", guest = false) {
  await page.context().addCookies([
    { name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" },
    ...(guest ? [{ name: "mm_e2e_guest", value: "1", domain: "127.0.0.1", path: "/" }] : []),
  ]);
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement?.setAttribute("data-lang", lang);
  }, { lang });
  await page.route("**/api/medtech/**", route => fixture.handle(route));
}
async function open(page: Page, suffix = "") {
  await page.goto("/discover?tab=medtech" + suffix);
  return page.getByTestId("medtech-watchdesk");
}
async function fit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const root = page.getByTestId("medtech-watchdesk");
  if (await root.count()) expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
    expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
}
async function shot(page: Page, info: TestInfo, name: string) {
  await fit(page);
  await page.screenshot({ path: info.outputPath(name + ".png"), fullPage: true });
  await info.attach(name, { path: info.outputPath(name + ".png"), contentType: "image/png" });
}
test("records, native De Novo detail, source sheet, filters and browser Back", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f); const root = await open(page);
  await expect(root.locator("[data-record]")).toHaveCount(2);
  await expect(root).toContainText("Monthly FDA reference data");
  await shot(page, info, "watchdesk-dark");
  await root.locator('[data-record="fda-510k-DEN260007"]').click();
  await expect(page.getByTestId("medtech-record")).toContainText("Granted");
  await expect(page.getByTestId("medtech-record")).toContainText("not a new FDA announcement");
  await shot(page, info, "record-dark");
  const sourceButton = page.getByRole("button", { name: "Source evidence", exact: true });
  await sourceButton.click();
  const dialog = page.getByRole("dialog", { name: "Source evidence", exact: true });
  await expect(dialog).toContainText("Not provided by this dataset");
  await expect(dialog.getByRole("link")).toHaveAttribute("href", /denovo\.cfm\?id=DEN260007$/);
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
  await shot(page, info, "source-dark");
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(sourceButton).toBeFocused();
  await page.goBack(); await expect(root.locator("[data-record]")).toHaveCount(2);
  await root.getByRole("combobox", { name: "Pathway", exact: true }).selectOption("pma_supplement");
  await expect(root.locator("[data-record]")).toHaveCount(1);
  await expect(root).toContainText("Decision recorded"); await expect(root).toContainText("OK30");
  await root.getByLabel("Search device, applicant or submission", { exact: true }).fill("not-in-source");
  await root.getByRole("button", { name: "Search", exact: true }).click();
  await expect(root).toContainText("No matching FDA records");
  await shot(page, info, "empty-search");
  await root.getByRole("button", { name: "Clear filters" }).click(); await expect(root.locator("[data-record]")).toHaveCount(2);
});
test("confirmed exact watch persists and review applies to only one revision", async ({ page }, info) => {
  const f = new Fixture();
  f.changes[0].changes.push({ json_path: "/device/unmapped_source_field", change_family: "device", op: "replace", before_state: "present", before_value: "Prior exact value", after_state: "present", after_value: "Current exact value" });
  await setup(page, f); const root = await open(page);
  const watchButton = root.getByRole("button", { name: "Watch K260001", exact: true });
  await expect(watchButton).toBeEnabled(); await watchButton.click();
  const dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  await expect(dialog).not.toContainText("New supplements");
  await shot(page, info, "watch-dialog");
  await dialog.getByRole("button", { name: "Save watch", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(root.getByRole("button", { name: "Watch settings K260001", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(f.writes[0].body).toEqual({ subject_type: "event", subject_id: records[0].event_id, triggers: ["record_changed"], snapshot_id: GEN });
  await page.reload();
  await root.getByRole("button", { name: /My watches/ }).click();
  await expect(root).toContainText("K260001"); await expect(root).toContainText("Watching since");
  await shot(page, info, "my-watches");
  await root.getByRole("button", { name: "Review changes", exact: true }).click();
  const changes = page.getByTestId("medtech-changes");
  await expect(changes.getByRole("button", { name: "Mark as reviewed", exact: true })).toHaveCount(2);
  await expect(changes).toContainText("/device/unmapped_source_field");
  await expect(changes).toContainText("Changes to the record");
  await expect(changes).toContainText("Interpretation corrected");
  await expect(changes).toContainText("It does not establish a new FDA action");
  await shot(page, info, "change-review");
  await changes.getByRole("button", { name: "Mark as reviewed", exact: true }).first().click();
  await expect(changes.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  await expect(changes.getByRole("button", { name: "Mark as reviewed", exact: true })).toHaveCount(1);
  expect(f.writes.at(-1)?.body).toEqual({ event_id: records[0].event_id, revision_id: REV2, snapshot_id: GEN });
  await changes.getByRole("button", { name: "Open record", exact: true }).first().click();
  await expect(page.getByTestId("medtech-record")).toBeVisible();
  await page.goBack(); await expect(changes.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  expect(f.watches[0].baseline_at).toBe(BASE);
  await fit(page);
});
test("review after a staged refresh reconciles after record navigation", async ({ page }, info) => {
  const f = new Fixture(); f.watches = [watch()]; await setup(page, f);
  const root = await open(page, "&mtView=watches&mtWatch=" + WATCH);
  const changes = page.getByTestId("medtech-changes");
  await expect(changes.getByRole("button", { name: "Mark as reviewed", exact: true })).toHaveCount(2);
  f.generation = NEXT;
  await changes.getByRole("button", { name: "Mark as reviewed", exact: true }).first().click();
  await expect(root).toContainText("New source data is available");
  await root.getByRole("button", { name: "Refresh view", exact: true }).first().click();
  await expect(changes.getByRole("button", { name: "Mark as reviewed", exact: true }).first()).toBeEnabled();
  await changes.getByRole("button", { name: "Mark as reviewed", exact: true }).first().click();
  await expect(changes.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  expect(f.writes.at(-1)?.body).toEqual({ event_id: records[0].event_id, revision_id: REV2, snapshot_id: NEXT });
  await changes.getByRole("button", { name: "Open record", exact: true }).first().click();
  await expect(page.getByTestId("medtech-record")).toBeVisible();
  const reconciled = page.waitForResponse(response => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/medtech/watches/" + WATCH + "/updates" && response.status() === 200);
  await page.goBack(); await reconciled;
  await expect(changes.getByRole("button", { name: "Reviewed", exact: true })).toHaveCount(1);
  await expect(changes.getByRole("button", { name: "Mark as reviewed", exact: true })).toHaveCount(1);
  expect(f.watches[0].baseline_at).toBe(BASE);
  await shot(page, info, "review-after-refresh-and-back");
});
test("PMA family settings preserve baseline and version conflicts require a fresh read", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f); const root = await open(page, "&mtPathway=pma_supplement");
  await root.getByRole("button", { name: "Watch P150012S191", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  await dialog.getByRole("radio", { name: /PMA application/ }).check();
  await expect(dialog.getByRole("checkbox", { name: /New supplements/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Save watch", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.watches[0].subject_id).toBe("fda-pma-P150012");
  await root.getByRole("button", { name: /My watches/ }).click();
  await root.getByRole("button", { name: "Manage", exact: true }).click();
  f.conflict = true;
  await dialog.getByRole("checkbox", { name: /New supplements/ }).uncheck();
  await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(dialog).toContainText("This watch changed in another session");
  await expect(dialog.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await shot(page, info, "watch-conflict");
  expect(f.writes.filter(w => w.method === "PATCH")).toHaveLength(1);
  await dialog.getByRole("button", { name: "Reload my watches" }).click();
  await root.getByRole("button", { name: "Manage", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  await dialog.getByRole("button", { name: "Remove watch", exact: true }).click();
  await expect(dialog).toContainText("Remove this watch and its review marks?");
  await dialog.getByRole("button", { name: "Remove watch", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(root).toContainText("Your watchdesk starts with a record");
  expect(f.writes.at(-1)?.body).toEqual({ version: 2 }); await fit(page);
});
test("unconfirmed save keeps settings visible without claiming a saved watch", async ({ page }, info) => {
  const f = new Fixture(); f.saveStatus = 503; await setup(page, f); const root = await open(page);
  await root.getByRole("button", { name: "Watch K260001", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  await dialog.getByRole("button", { name: "Save watch", exact: true }).click();
  await expect(dialog).toContainText("This change could not be confirmed");
  await expect(dialog.getByRole("checkbox", { name: "Changes to the record", exact: true })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save watch", exact: true })).toBeDisabled();
  await shot(page, info, "save-unavailable");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(root.getByRole("button", { name: "Watch K260001", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(f.writes).toHaveLength(1); expect(f.watches).toHaveLength(0);
});
test("generation conflict retains rows and refreshes coherently without a browser reload", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f); const root = await open(page);
  await expect(root.locator("[data-record]")).toHaveCount(2);
  f.continuationStale = true; await root.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(root).toContainText("New source data is available");
  await expect(root.locator("[data-record]")).toHaveCount(2);
  await expect(root.getByRole("button", { name: "Watch K260001", exact: true })).toBeDisabled();
  await shot(page, info, "generation-conflict");
  let release!: () => void;
  f.listHold = new Promise<void>(resolve => { release = resolve; });
  await root.getByRole("button", { name: "Refresh view", exact: true }).first().click();
  await expect(root).toContainText("Refreshing the current view");
  await expect(root.locator("[data-record]")).toHaveCount(2);
  await expect(root.getByRole("button", { name: "Watch K260001", exact: true })).toBeDisabled();
  f.listStatus = 503; release();
  await expect(root).toContainText("Previously loaded records are still shown");
  await expect(root.locator("[data-record]")).toHaveCount(2);
  await shot(page, info, "refresh-unavailable-retained");
  f.listStatus = 0; f.listHold = undefined;
  await root.getByRole("button", { name: "Try again", exact: true }).first().click();
  await expect(root.getByRole("button", { name: "Watch K260001", exact: true })).toBeEnabled();
  await root.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(root.locator("[data-record]")).toHaveCount(4);
  expect(f.writes).toHaveLength(0); await fit(page);
});
test("detail and history remain visible when a replacement detail fails", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f); const root = await open(page);
  await root.locator('[data-record="fda-510k-DEN260007"]').click();
  const detail = page.getByTestId("medtech-record");
  await expect(detail).toContainText("not a new FDA announcement");
  f.generation = NEXT;
  await detail.getByRole("button", { name: "Watch this record", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  await dialog.getByRole("button", { name: "Save watch", exact: true }).click();
  await expect(dialog).toContainText("New source data is available");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  f.detailStatus = 503;
  await root.getByRole("button", { name: "Refresh view", exact: true }).first().click();
  await expect(root).toContainText("Previously loaded records are still shown");
  await expect(detail).toContainText("Device identifier");
  await expect(detail).toContainText("not a new FDA announcement");
  await expect(detail.getByRole("button", { name: "Watch this record", exact: true })).toBeDisabled();
  await shot(page, info, "detail-refresh-retained");
  f.detailStatus = 0;
  await root.getByRole("button", { name: "Try again", exact: true }).first().click();
  await expect(detail.getByRole("button", { name: "Watch this record", exact: true })).toBeEnabled();
  await expect(detail).toContainText("not a new FDA announcement");
});
test("failed watch reconciliation retains the last saved rows and disables edits", async ({ page }, info) => {
  const f = new Fixture(); f.watches = [watch()]; await setup(page, f); const root = await open(page, "&mtView=watches");
  await root.getByRole("button", { name: "Manage", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Watch settings", exact: true });
  f.conflict = true;
  await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(dialog).toContainText("This watch changed in another session");
  f.watchStatus = 503;
  await dialog.getByRole("button", { name: "Reload my watches", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(root).toContainText("Your saved watches are not confirmed");
  await expect(root).toContainText("K260001");
  await expect(root.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
  await expect(root.getByRole("button", { name: "Manage", exact: true })).toBeDisabled();
  await expect(root).not.toContainText("Your watchdesk starts with a record");
  await shot(page, info, "saved-watches-retained");
  f.watchStatus = 0;
  await root.getByRole("button", { name: "Reload my watches", exact: true }).click();
  await expect(root.getByRole("button", { name: "Manage", exact: true })).toBeEnabled();
  expect(f.writes).toHaveLength(1);
});
test("source and watch failures are distinct from empty results", async ({ page }, info) => {
  const f = new Fixture(); f.listStatus = 503; f.watchStatus = 503; await setup(page, f); const root = await open(page);
  await expect(root).toContainText("Source records are temporarily unavailable");
  await expect(root).toContainText("Your saved watches are not confirmed");
  await expect(root).not.toContainText("No matching FDA records");
  await root.getByRole("button", { name: /My watches/ }).click();
  await expect(root).not.toContainText("Your watchdesk starts with a record");
  await shot(page, info, "source-and-account-unavailable");
  f.listStatus = 0; f.watchStatus = 0;
  await root.getByRole("button", { name: "Try again", exact: true }).first().click();
  await expect(root).toContainText("Your watchdesk starts with a record");
});
test("paid-access denial clears the source view", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f); const root = await open(page);
  await expect(root.locator("[data-record]")).toHaveCount(2);
  f.authStatus = 403; await root.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByTestId("medtech-access")).toContainText("A subscription is required");
  await expect(page.locator("[data-record]")).toHaveCount(0);
  await shot(page, info, "subscription-required");
});
test("signed-out shell does not load account data", async ({ page }, info) => {
  const f = new Fixture(); await setup(page, f, "en", true);
  let requests = 0; page.on("request", request => { if (request.url().includes("/api/medtech/")) requests++; });
  await open(page);
  await expect(page.getByTestId("medtech-access")).toContainText("Sign in to open your watchdesk");
  expect(requests).toBe(0); await shot(page, info, "sign-in-required");
});
for (const lang of ["en", "zh"]) {
  test("shared language in the supported dark shell " + lang, async ({ page }, info) => {
    const f = new Fixture(); await setup(page, f, lang); const root = await open(page);
    await expect(root.locator("[data-record]")).toHaveCount(2);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(root.getByRole("heading", { level: 1 })).toHaveText(lang === "zh" ? "监管观察台" : "Regulatory watchdesk");
    await expect(root).not.toContainText(lang === "zh" ? "My watches" : "我的关注");
    await shot(page, info, "watchdesk-" + lang + "-dark");
    await root.locator("[data-record]").first().click();
    await expect(page.getByTestId("medtech-record").getByRole("heading", { level: 1, name: records[0].device.name!, exact: true })).toBeVisible();
    await shot(page, info, "record-" + lang + "-dark");
    const button = page.getByRole("button", { name: lang === "zh" ? "关注此记录" : "Watch this record", exact: true });
    await button.click();
    await expect(page.getByRole("dialog")).toContainText(lang === "zh" ? "关注设置" : "Watch settings");
    await shot(page, info, "watch-" + lang + "-dark");
  });
}
