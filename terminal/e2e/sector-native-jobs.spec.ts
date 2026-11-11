import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import captured from "../lib/__tests__/fixtures/sector_generation.captured.preview.v1.json";
import { sectorFixture } from "./fixtures/sector-company-v3";

// Native sector job journey (Brief / Explore / dossier) against the same actual
// Macro API bytes the gateway qualification uses. Population/authentication are
// controlled; this is not production acceptance.
const ownerWire = readFileSync("lib/__tests__/fixtures/sector_generation.captured.preview.v1.json", "utf8").trimEnd();
const ownerWireHash = createHash("sha256").update(ownerWire).digest("hex");
const nativePath = "/api/sector-generation?audience=preview";

type Wire = typeof captured;

async function prepare(page: Page, language = "en") {
  expect(ownerWireHash).toBe("3e275fc69d22e990f81261c8a803576a832be9332484c7a99b2dddd165a5d425");
  const state = { wire: structuredClone(captured) as Wire, denied: false, initial: true, gate: null as Promise<void> | null };
  await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), language);
  await page.route("**/api/sector-intelligence?**", async route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source === "sector") return route.fulfill({ json: {
      data: { as_of: captured.source_session, sectors: [{ id: "xlk", ticker: "XLK", name: "Legacy Technology", kind: "sector" }] },
      receipt: { source, status: "ready", path: "/sectordata/sector_central.json", asOf: captured.source_session,
        observedAt: captured.published_at, contentHash: "independent-legacy", stale: false },
    } });
    if (source !== "generation") return sectorFixture(route);
    if (state.gate) await state.gate;
    return route.fulfill({ status: state.denied ? 401 : 200, json: {
      data: state.denied ? null : state.wire,
      receipt: { source, status: state.denied ? "access" : "ready", path: nativePath,
        asOf: state.denied ? null : state.wire.source_session, observedAt: captured.published_at,
        contentHash: state.denied ? null : state.initial ? ownerWireHash
          : createHash("sha256").update(JSON.stringify(state.wire)).digest("hex"),
        stale: state.wire.qualification === "stale" },
    } });
  });
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

const subject = (page: Page) => page.getByTestId("sector-intelligence");
const brief = (page: Page) => page.getByTestId("sector-native-brief");
const exploreRows = (page: Page) => page.getByTestId("sector-native-explore").locator("[role='list'] [data-sector-choice]");
// `next dev` compiles the route on first demand; the suite-level warm-up only
// covers /terminal. Landing assertions tolerate the cold-route compile, the
// rest keep the default budget once the app is hydrated.
const COLD = { timeout: 30_000 } as const;

/** The shared Brief → Explore → select Financials → dossier leg used by every journey. */
async function openDossierFromExplore(page: Page, language: "en" | "zh") {
  await brief(page).getByTestId("sector-native-brief-explore").click();
  await expect(page.getByTestId("sector-native-job-explore")).toHaveAttribute("aria-selected", "true");
  // Source-ordinal law: rows follow the producer's measured rank (XLB first),
  // never the wire order; Technology sits sixth although it leads 21 sessions.
  const labels = exploreRows(page);
  await expect(labels).toHaveCount(11);
  expect(await labels.evaluateAll(buttons => buttons.map(button =>
    (button.textContent || "").match(/XLRE|XLB|XLC|XLE|XLF|XLI|XLK|XLP|XLU|XLV|XLY/)?.[0])))
    .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
  await expect(labels.first()).toContainText(language === "zh" ? "原材料" : "Materials");
  await expect(labels.nth(5)).toContainText(language === "zh" ? "科技" : "Technology");
  await page.locator('[data-sector-choice="xlf"]').first().click();
  await expect(page.getByTestId("sector-native-inspector")).toContainText("XLF");
  await page.getByTestId("sector-native-inspector-open").click();
  const dossier = page.getByTestId("sector-native-dossier");
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText(language === "zh" ? "金融" : "Financials");
  await expect(dossier).toContainText("XLF");
  return dossier;
}

test("Brief orients, Explore ranks by source ordinal, and the dossier returns to the selection", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await prepare(page);
  // Explicit job param wins on any path: the legacy Discover surface opens Brief.
  await page.goto("/discover?tab=sectors&sectorJob=brief");
  await expect(brief(page)).toBeVisible(COLD);
  await expect(page.getByTestId("sector-native-job-brief")).toHaveAttribute("aria-selected", "true");
  // Frozen source values: Materials leads the 63-session order, not Technology
  // (the 21-session lead) — the two inputs never masquerade as each other.
  await expect(brief(page)).toContainText("Materials leads.");
  await expect(brief(page)).toContainText("Materials and Communication Services lead the 63-session comparison.");
  await expect(subject(page).getByTestId("sector-native-brief-leaders")).toContainText("+0.10%");
  await expect(brief(page)).toContainText("1 of 11");
  await expect(subject(page)).toContainText("November 3, 2026 · Close");
  // The honest-data strips: breadth is not supplied, compare is not mounted.
  await expect(subject(page).getByTestId("sector-native-brief-status")).toContainText("Constituent membership is not supplied by this source.");
  await noOverflow(page);
  await info.attach("native-jobs-brief-en-dark", { body: await page.screenshot(), contentType: "image/png" });

  const dossier = await openDossierFromExplore(page, "en");
  // Exact-session returns, frozen XLF source values, distinct across windows.
  const exact = dossier.getByTestId("sector-native-dossier-exact");
  await expect(exact).toContainText("+0.04%");
  await expect(exact).toContainText("+0.18%");
  await expect(exact).toContainText("+0.56%");
  await expect(dossier.getByTestId("sector-native-dossier-leadership")).toContainText("No. 4");
  await expect(dossier.getByTestId("sector-native-dossier-participation")).toContainText("not supplied");
  await noOverflow(page);
  await info.attach("native-jobs-dossier-en-dark", { body: await page.screenshot(), contentType: "image/png" });

  // Back restores the Explore origin with the Financials selection and focus.
  await dossier.getByTestId("sector-native-dossier-back").click();
  await expect(page.getByTestId("sector-native-explore")).toBeVisible();
  await expect(page.locator('[data-sector-choice="xlf"]').first()).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("sectorJob")).toBe("explore");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-sector-choice"))).toBe("xlf");

  // Reload on the dossier restores the dossier, not a fallback surface.
  await page.getByTestId("sector-native-inspector-open").click();
  await expect(page.getByTestId("sector-native-dossier")).toBeVisible();
  await page.reload();
  const restored = page.getByTestId("sector-native-dossier");
  await expect(restored).toBeVisible();
  await expect(restored).toContainText("Financials");
  await expect(restored).toContainText("+0.18%");
  await noOverflow(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await restored.scrollIntoViewIfNeeded();
  await info.attach("native-jobs-dossier-320", { body: await page.screenshot(), contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("a native access refusal shows the real cause and no static sector values", async ({ page }) => {
  test.slow(); // three full navigations against the on-demand dev server
  const state = await prepare(page);
  state.denied = true;
  await page.goto("/discover?tab=sectors&sectorJob=brief");
  const unavailable = page.getByTestId("sector-native-unavailable");
  await expect(unavailable).toBeVisible(COLD);
  await expect(unavailable).toContainText("Leadership evidence requires access");
  await expect(unavailable).toContainText("Sign in");
  // No static fallback: neither Brief values nor ranked rows may render.
  await expect(brief(page)).toHaveCount(0);
  await expect(page.getByTestId("sector-native-explore")).toHaveCount(0);
  expect(await subject(page).locator("[data-sector-choice]").count()).toBe(0);
  // The same refusal withdraws a directly-opened dossier with the real cause.
  await page.goto("/discover?tab=sectors&sectorJob=explore&sectorWorkspace=detail&sector=xlf");
  const dossier = page.getByTestId("sector-native-dossier");
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText("Leadership evidence requires access");
  await expect(dossier).not.toContainText("Financials");
  expect(await dossier.locator("[data-sign]").count()).toBe(0);
  // Back from a refused dossier returns to the refused Explore with the real cause.
  await dossier.getByTestId("sector-native-dossier-back").click();
  await expect(page.getByTestId("sector-native-explore")).toHaveCount(0);
  await expect(page.getByTestId("sector-native-unavailable")).toBeVisible();
  // Recovery through the job shell's own Refresh control, never a reload workaround.
  state.denied = false;
  await subject(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("sector-native-explore")).toBeVisible();
  await page.locator('[data-sector-choice="xlf"]').first().click();
  await page.getByTestId("sector-native-inspector-open").click();
  const recovered = page.getByTestId("sector-native-dossier");
  await expect(recovered).toContainText("Financials");
  await expect(recovered.getByTestId("sector-native-dossier-exact")).toContainText("+0.18%");
  // A later refusal withdraws the already-admitted dossier on its own Refresh.
  state.denied = true;
  await recovered.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(recovered).toContainText("Leadership evidence requires access");
  await expect(recovered.getByTestId("sector-native-dossier-exact")).toHaveCount(0);
  await noOverflow(page);
});

for (const language of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`native jobs stay bilingual and themed: ${language} ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await prepare(page, language);
    await page.goto(`/discover?tab=sectors&sectorJob=brief&sectorTheme=${theme}`);
    await expect(brief(page)).toBeVisible(COLD);
    await expect(brief(page)).toContainText(language === "zh" ? "原材料领先。" : "Materials leads.");
    await expect(subject(page)).toContainText(language === "zh" ? "2026年11月3日 · 收盘" : "November 3, 2026 · Close");
    const dossier = await openDossierFromExplore(page, language);
    if (language === "zh") await expect(dossier).toContainText("两个已测量区间均落后SPY。");
    await expect(subject(page)).toHaveAttribute("data-sector-theme", theme);
    await noOverflow(page);
    await info.attach(`native-jobs-${language}-${theme}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await info.attach(`native-jobs-${language}-${theme}-320`, { body: await page.screenshot(), contentType: "image/png" });
    expect(errors).toEqual([]);
  });
}

// The canonical member entry. Runs only under the Shared Shell beta opt-in — the
// same family as e2e/intl-history-date-intent.spec.ts. The dev server for this
// run must be launched with MMX_SHARED_SHELL=1, NEXT_PUBLIC_SUPABASE_URL and
// BILLING_GATEWAY_BASE pointed at the loopback auth fixture port (see the PR
// body for the exact command); membership comes from the fixture session,
// exactly like e2e/tools/qualify_shared_shell_intelligence.cjs. The production
// CSP allows only *.supabase.co, so this context opts out of CSP exactly like
// that qualifier's documented context-only bypassCSP; production headers are
// unchanged and not under test here.
test.describe("canonical /sectors member entry (Shared Shell beta opt-in)", () => {
  test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell beta opt-in required");
  test.use({ bypassCSP: true });
  let fixture: ReturnType<typeof spawn> | null = null;

  test.beforeAll(async () => {
    const port = Number(process.env.SECTOR_NATIVE_AUTH_PORT || 54331);
    const probe = async () => { try { const res = await fetch(`http://127.0.0.1:${port}/auth/v1/user`, { method: "OPTIONS" }); return res.ok; } catch { return false; } };
    if (!await probe()) {
      fixture = spawn(process.execPath, ["e2e/tools/sector_native_auth_fixture.mjs", String(port)], { stdio: ["pipe", "ignore", "inherit"] });
      for (let attempt = 0; attempt < 50 && !await probe(); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
  test.afterAll(() => fixture?.kill());

  test("clean /sectors opens Brief for a signed-in member", async ({ page, baseURL }, info) => {
    expect(baseURL).toBeTruthy();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await prepare(page);
    const now = Math.floor(Date.now() / 1000);
    const owner = "00000000-0000-4000-8000-0000000000e1";
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = enc({ alg: "HS256", typ: "JWT" });
    const body = enc({ sub: owner, email: "research-fixture@example.test", aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 });
    const token = `${head}.${body}.shared-shell-fixture`;
    const session = { access_token: token, refresh_token: "fixture-only-refresh-never-used", expires_in: 3600, expires_at: now + 3600, token_type: "bearer",
      user: { id: owner, aud: "authenticated", role: "authenticated", email: "research-fixture@example.test" } };
    await page.context().addCookies([{ name: "sb-127-auth-token", value: "base64-" + enc(session), url: baseURL!, httpOnly: false, sameSite: "Lax" }]);
    await page.goto("/sectors");
    // The member shell mounts the tool workspace; Brief is the canonical entry.
    await expect(page.locator("[data-intelligence-tool='sectors']")).toBeVisible(COLD);
    await expect(brief(page)).toBeVisible(COLD);
    await expect(page.getByTestId("sector-native-job-brief")).toHaveAttribute("aria-selected", "true", COLD);
    await expect(brief(page)).toContainText("Materials leads.");
    await expect(subject(page)).toHaveAttribute("data-sector-workspace", "discover");
    const params = new URL(page.url()).searchParams;
    expect(params.has("sectorWorkspace")).toBe(false);
    await noOverflow(page);
    await info.attach("native-jobs-sectors-canonical", { body: await page.screenshot(), contentType: "image/png" });
    expect(errors).toEqual([]);
  });
});
