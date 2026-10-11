import { expect, test, type Page } from "@playwright/test";
import { e2eAccountOwner, LEGACY_MARKET_PREFS_KEY, MARKET_PREFS_KEY } from "./accountOwner";

/**
 * E1 acceptance, in a real browser: account preferences belong to the immutable auth id.
 *
 * Two things used to make this fail, and this spec drives both through the real UI:
 *
 *   1. the preference store's `loadedFor` was the EMAIL. Every fixture account signs in at the
 *      SAME address (`TERMINAL_E2E_EMAIL` is process-wide) with a DIFFERENT auth uuid, so an
 *      email-keyed store treats A and B as one owner and never reloads at all — B opens Settings
 *      and finds A's narrowed market universe already applied.
 *   2. the local copy lived in ONE unscoped `mm.marketPrefs` slot that a signed-in account wrote
 *      to and any later owner read straight back.
 *
 * The account leg of the store cannot reach Supabase under the fixture server (there is no auth
 * service on the fixture URL), which is exactly the condition that makes the LOCAL slot
 * load-bearing — and therefore the condition under which the unscoped slot leaked. A narrowed
 * market universe is the visible consequence: it removes symbols from search entirely.
 */

const ACCOUNT_A = "pref-acct-a";
const ACCOUNT_B = "pref-acct-b";
/** A market that is never the derived home (home comes from `market_focus`, which is unset here). */
const NARROWED = "Canada";

async function signInAs(page: Page, storeKey: string, baseURL?: string) {
  await page.context().clearCookies({ name: "mm_e2e_wl" });
  await page.context().addCookies([{ name: "mm_e2e_wl", value: storeKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
}

async function boot(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

/** Open Settings → Terminal, where the market universe is edited. */
async function openTerminalSettings(page: Page) {
  await page.locator('button[aria-label="Settings"]:visible').first().click();
  await expect(page.locator(".acs-card")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(page.getByRole("button", { name: NARROWED, exact: false })).toBeVisible();
}

const marketToggle = (page: Page) =>
  page.locator(".acs-body").getByRole("button", { name: NARROWED, exact: false }).first();

/** The whole owner envelope, so a leak into ANY slot is visible. */
const envelope = (page: Page) => page.evaluate((key) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, { enabled?: string[] }>; }
  catch { return {}; }
}, MARKET_PREFS_KEY);

test.describe("E1 — one browser, two accounts, one address", () => {
  test("account B inherits none of account A's market preferences", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${testInfo.project.name}-${testInfo.retry}`;
    const keyA = `${ACCOUNT_A}-${suffix}`;
    const keyB = `${ACCOUNT_B}-${suffix}`;
    const ownerA = e2eAccountOwner(keyA);
    const ownerB = e2eAccountOwner(keyB);
    // The premise of the whole spec: same address, different owner.
    expect(ownerA).not.toBe(ownerB);

    // ── A narrows its universe ────────────────────────────────────────────────
    await signInAs(page, keyA, baseURL);
    await boot(page);
    await openTerminalSettings(page);
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "true");
    await marketToggle(page).click();
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "false");

    // It landed in A's OWN slot, and the pre-boundary unscoped key was not resurrected.
    await expect.poll(async () => Object.keys(await envelope(page)), { timeout: 10_000 }).toContain(ownerA);
    expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_MARKET_PREFS_KEY)).toBeNull();

    // A reload restores A's own choice — the same-owner cache is what makes the leak possible,
    // so the spec proves it works before proving it does not cross owners.
    await page.keyboard.press("Escape");
    await boot(page);
    await openTerminalSettings(page);
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "false");

    // ── B signs in on the same browser, at the same address ───────────────────
    await page.keyboard.press("Escape");
    await signInAs(page, keyB, baseURL);
    await boot(page);
    await openTerminalSettings(page);
    // B has expressed no preference, so B sees the full universe. An email-keyed owner, or an
    // unscoped local slot, shows A's narrowed one here.
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "true");

    const slots = await envelope(page);
    expect(slots[ownerB]?.enabled ?? []).not.toEqual(slots[ownerA]?.enabled ?? ["sentinel"]);
    expect(slots[ownerA]?.enabled ?? []).not.toContain("ca");

    // ── …and back to A, whose universe is exactly as they left it ─────────────
    await page.keyboard.press("Escape");
    await signInAs(page, keyA, baseURL);
    await boot(page);
    await openTerminalSettings(page);
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "false");
  });
});

/**
 * E2 acceptance: the pane reports the AUTHORITY's answer, not its own optimism.
 *
 * The fixture server has no reachable Supabase, so every `updateUser` fails — which is exactly
 * the condition the old code could not express. `toggleFollow` flashed "Saved" the instant a
 * synchronous store call returned, and `updateUser({data}).catch(() => {})` swallowed both a
 * rejection and the Supabase shape that RESOLVES with `{ error }`. A user whose preference never
 * left the browser was told it had been saved to their account.
 */
test.describe("E2 — a write that did not land never reads as saved", () => {
  test("an unreachable account is reported honestly, with a retry", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await signInAs(page, `pref-deliver-${testInfo.project.name}-${testInfo.retry}`, baseURL);
    await boot(page);
    await openTerminalSettings(page);

    // Nothing has been touched, so the lane says nothing at all.
    await expect(page.locator(".acs-msg.show")).toHaveCount(0);

    await marketToggle(page).click();
    // The local half applied immediately…
    await expect(marketToggle(page)).toHaveAttribute("aria-pressed", "false");
    // …and the delivery half tells the truth about the account.
    const note = page.locator(".acs-msg.show");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText("Couldn't reach your account", { timeout: 15_000 });
    await expect(note.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(note).not.toContainText("Saved");
  });
});
