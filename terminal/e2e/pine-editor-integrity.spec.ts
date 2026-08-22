import { expect, test, type Page, type TestInfo } from "./fixtures";

/**
 * D3 + D4 — the Pine editor must not lose user-authored content, and must say which script it is
 * editing.
 *
 * Three defects, all provable only by leaving a script and coming back:
 *
 *   D3b  save() POSTed the new source successfully but never updated the editor's stored baseline.
 *        Switching scripts rehydrated the buffers from the ORIGINAL server props, so a save that
 *        had genuinely landed looked lost — and a subsequent save from that stale buffer would
 *        overwrite the real one.
 *   D3a  selection was a bare `setIdx(i)` and the switch effect then replaced the buffers, so an
 *        unsaved edit vanished on a single click with no Save/Discard/Cancel decision.
 *   D4   `?id=` was read once at mount; after that the visible script and the URL could disagree,
 *        so reloading or sharing the URL landed on a different script than the one on screen.
 *
 * Runs against the real page, the real editor and the real save route; only `saved_scripts` is a
 * fixture (lib/scriptsFixtureDb.ts, TERMINAL_E2E_FIXTURE only).
 */

// #433's fixture seed (lib/scriptsFixtureDb.ts): two scripts owned by the signed-in user.
// Their SOURCES, not their names, are what the editor shows — that seed deliberately uses a
// generic `indicator('x')` body, so assert on the distinguishing plot() call rather than the title.
const A = "My Momentum";
const B = "My Reversion";
const A_SRC = /plot\(close\)/;      // "My Momentum" stored source
const B_SRC = /plot\(open\)/;       // "My Reversion" stored source

// Per-RUN nonce, for the same reason e2e/watchlistStore.ts carries one. `reuseExistingServer: !CI`
// means a second local run usually attaches to the FIRST run's dev server, and the fixture store is
// process-global — so without this, run N+1 inherits run N's saved scripts. That matters here more
// than most places: these specs SAVE, and the script list is ordered by `updated_at`, so an
// inherited save reorders the list and a spec that expects the seeded order fails on nothing. The
// module loads once per worker process, so the value is stable within a run and fresh across runs.
const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${Math.random().toString(36).slice(2, 8)}`;

/** Own store per test — the three viewport projects share one dev server. */
async function isolateScripts(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = `${testInfo.project.name}-${testInfo.title}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 90);
  await page.context().addCookies([{
    name: "mm_e2e_scripts",
    value: key,
    url: baseURL ?? "http://127.0.0.1:3108",
  }]);
  return key;
}

const editor = (page: Page) => page.locator(".editor textarea");
const sideRow = (page: Page, name: string) => page.locator(".script-row", { hasText: name });
const console_ = (page: Page) => page.locator(".console");

/** #433's scripts fixture is READ-ONLY on purpose, so a successful save is fulfilled at the
 *  transport. This is the honest level for D3b: the write always reached the database — what went
 *  stale was the editor's CLIENT baseline, which is exactly what these specs observe. */
async function stubSaveOk(page: Page) {
  await page.route("**/api/scripts/save", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "fixture-id" }),
  }));
}

async function openScripts(page: Page, testInfo: TestInfo, baseURL?: string, query = "") {
  await isolateScripts(page, testInfo, baseURL);
  await stubSaveOk(page);
  await page.goto(`/scripts${query}`);
  await expect(editor(page)).toBeVisible({ timeout: 60_000 });
}

/** Replace the whole buffer — the editor is a controlled textarea — and WAIT until the editor
 *  actually considers itself dirty.
 *
 *  Every dirty-switch test below types and then immediately clicks another script, expecting the
 *  decision dialog. `dirty` is derived during render, so a click that lands before React has
 *  committed the change sees a CLEAN buffer, switches silently, and the test fails as though the
 *  guard were missing — which is the exact defect under test. Observing the state here, once, makes
 *  every caller deterministic instead of each one racing. */
async function setSource(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect(console_(page)).toContainText("unsaved changes", { timeout: 10_000 });
}

test.describe("D3b — a successful save becomes the editor's baseline", () => {
  test("edit → save → switch away → switch back keeps the SAVED source", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    // Land on A and give it a distinctive edit.
    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(A_SRC);
    const EDITED = "//@version=6\nindicator(\"My Momentum\")\nplot(close * 2) // A-PRIME\n";
    await setSource(page, EDITED);
    await expect(console_(page)).toContainText("unsaved changes");

    // Save, and assert the editor stops calling itself dirty. Deliberately NOT asserting the
    // "Saved ✓" label: it lives for 2.2s and a loaded runner can miss the window entirely, which
    // made this spec flaky. Losing the dirty marker is the durable, load-independent evidence that
    // the baseline actually moved — which is the thing D3b fixed.
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect(console_(page)).not.toContainText("unsaved changes", { timeout: 15_000 });

    // Leave and come back. THIS is where the save used to disappear.
    await sideRow(page, B).click();
    await expect(editor(page)).toHaveValue(B_SRC);
    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(/A-PRIME/);
    // …and it is not merely displayed — the editor considers it stored, so a further switch is clean.
    await expect(console_(page)).not.toContainText("unsaved changes");
  });

  test("a second save sends the SAVED source, not the pre-save one", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    // The second half of the D3b defect, and the damaging half: with a stale baseline, editing
    // again after a round trip re-sent the ORIGINAL source and overwrote the save for real.
    const sent: string[] = [];
    await page.route("**/api/scripts/save", async (route) => {
      sent.push(JSON.parse(route.request().postData() || "{}").source ?? "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "fixture-id" }) });
    });

    await sideRow(page, A).click();
    await setSource(page, "//@version=6\nindicator(\"My Momentum\")\nplot(hlc3) // FIRST\n");
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);

    // Leave and return — the step that used to reinstate the pre-save source.
    await sideRow(page, B).click();
    await expect(editor(page)).toHaveValue(B_SRC);
    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(/FIRST/);

    await setSource(page, "//@version=6\nindicator(\"My Momentum\")\nplot(hlc3) // SECOND\n");
    await page.getByRole("button", { name: /Save/ }).first().click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(2);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("SECOND");
    expect(sent[1]).not.toContain("plot(close)");   // never the original stored source
  });
});

test.describe("D3a — a dirty buffer is never discarded without a decision", () => {
  test("Keep editing cancels the switch and preserves the edit", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    await sideRow(page, A).click();
    await setSource(page, "//@version=6\nindicator(\"My Momentum\")\nplot(low) // UNSAVED\n");
    await sideRow(page, B).click();

    // A decision is REQUIRED — the old code just swapped the buffer.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(A);

    await dialog.getByRole("button", { name: /Keep editing/ }).click();
    await expect(dialog).toBeHidden();
    await expect(editor(page)).toHaveValue(/UNSAVED/);          // edit intact
    await expect(page.locator(".script-row.on")).toContainText(A); // still on A
  });

  test("a FAILED save keeps the edit and stays on the script", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    await sideRow(page, A).click();
    await setSource(page, "//@version=6\nindicator(\"My Momentum\")\nplot(low) // FRAGILE\n");

    // Break the save at the transport, the way a real outage would.
    await page.route("**/api/scripts/save", (route) => route.fulfill({ status: 500, body: "{}" }));

    await sideRow(page, B).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Save and switch/ }).click();

    // Staying put IS the safe outcome: nothing switched, nothing was lost, and it says so.
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Couldn't save/);
    await dialog.getByRole("button", { name: /Keep editing/ }).click();
    await expect(editor(page)).toHaveValue(/FRAGILE/);
    await expect(page.locator(".script-row.on")).toContainText(A);
  });

  test("Discard changes deliberately restores the stored source and switches", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    await sideRow(page, A).click();
    await setSource(page, "//@version=6\nindicator(\"My Momentum\")\nplot(low) // THROWAWAY\n");
    await sideRow(page, B).click();

    await page.getByRole("dialog").getByRole("button", { name: /Discard changes/ }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(editor(page)).toHaveValue(B_SRC);        // switched

    // Returning to A shows the STORED source — the discard was real, and only the edit was dropped.
    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(A_SRC);
    await expect(editor(page)).not.toHaveValue(/THROWAWAY/);
  });

  test("switching with a CLEAN buffer asks nothing", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    await sideRow(page, A).click();
    await sideRow(page, B).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(editor(page)).toHaveValue(B_SRC);
  });
});

test.describe("D4 — the visible script and the ?id= deep link agree", () => {
  test("a deep link opens that script, and choosing another updates the URL", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL);

    // The URL names the visible script on ARRIVAL, before any switch. Do NOT assume which script
    // that is: the page prepends the locked flagship, and the saved rows are ordered by updated_at,
    // so "whatever is first" is exactly the unstable thing this fix exists to stop people sharing.
    //
    // POLL, never read once: mirroring is an effect, so it necessarily lands a tick AFTER the
    // editor paints. Reading the URL immediately raced it and CI got `null` — a harness bug that
    // reads exactly like "the product never mirrored".
    await expect.poll(() => new URL(page.url()).searchParams.get("id")).toBeTruthy();

    // Select each script EXPLICITLY and capture the id the URL then carries.
    await sideRow(page, B).click();
    await expect(editor(page)).toHaveValue(B_SRC);
    await expect.poll(() => new URL(page.url()).searchParams.get("id")).toBeTruthy();
    const bId = new URL(page.url()).searchParams.get("id");

    // Selecting the OTHER script must move the URL with it — this is what used to drift.
    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(A_SRC);
    await expect.poll(() => new URL(page.url()).searchParams.get("id")).not.toBe(bId);
    const aId = new URL(page.url()).searchParams.get("id");
    expect(aId).toBeTruthy();

    // Reload lands on the SAME script the URL names, not on the first one.
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 60_000 });
    await expect(editor(page)).toHaveValue(A_SRC);
    expect(new URL(page.url()).searchParams.get("id")).toBe(aId);

    // A fresh session opening the copied URL sees what the sharer saw.
    await page.goto(`/scripts?id=${encodeURIComponent(bId!)}`);
    await expect(editor(page)).toHaveValue(B_SRC);
  });

  test("URL mirroring preserves unrelated query params", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL, "?keep=yes");

    await sideRow(page, A).click();
    await expect(editor(page)).toHaveValue(A_SRC);
    await expect.poll(() => new URL(page.url()).searchParams.get("id")).toBeTruthy();
    const url = new URL(page.url());
    expect(url.searchParams.get("keep")).toBe("yes");
  });

  test("an unknown ?id= falls back predictably instead of blanking the editor", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Editor state is viewport-independent.");
    await openScripts(page, testInfo, baseURL, "?id=does-not-exist");
    // A real script, not an empty editor and not a crash. Which one is deliberately not asserted:
    // the fallback is "the first entry", and the page prepends the locked flagship.
    await expect(editor(page)).toHaveValue(/@version=6/);
    // …and the dangling id is REPAIRED rather than left naming nothing, so the URL never lies about
    // which script is on screen.
    await expect.poll(() => new URL(page.url()).searchParams.get("id")).not.toBe("does-not-exist");
  });
});
