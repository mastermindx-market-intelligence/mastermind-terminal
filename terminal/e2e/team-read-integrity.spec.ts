import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";

// Local response controls only: the ordinary invitation action causes a roster
// reload in the SAME mounted section. No real invitation or team is created.
for (const lang of ["en", "zh"] as const) {
  for (const reload of ["success", "failure"] as const) {
    test(`Team reload isolates late settings and preserves its one-time link (${lang}, ${reload})`, async ({ page, baseURL }, info) => {
      const key = await isolateWatchlistStore(page, info, baseURL);
      const caller = fixtureUserId(key);
      await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
      await page.route("**/data/manifest.json", (route) => route.fulfill({ json: {
        symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 175, chg: 1.2 } },
      } }));
      await page.route("**/api/quote**", (route) => route.fulfill({ json: { quotes: {} } }));

      let releaseOld!: () => void;
      let releaseReload!: () => void;
      const oldHeld = new Promise<void>((resolve) => { releaseOld = resolve; });
      const reloadHeld = new Promise<void>((resolve) => { releaseReload = resolve; });
      let reloading = false;
      let oldSettingsStarted = 0;
      let oldSettingsFinished = 0;
      let newSettingsReads = 0;
      let reloadReads = 0;
      const methods: string[] = [];
      const url = `${baseURL}/invite?token=local-team-read-fixture`;
      await page.route(/\/api\/teams(?:\/|\?|$)/, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        methods.push(`${request.method()} ${path}`);
        if (request.method() === "POST") {
          expect(path).toBe("/api/teams/invitations");
          expect(request.postDataJSON()).toEqual({
            action: "create", teamId: "read-team", email: "fixture@example.com", role: "member",
          });
          reloading = true;
          await route.fulfill({ json: { inviteUrl: url, invite: { email: "fixture@example.com" } } });
          return;
        }
        expect(request.method()).toBe("GET");
        if (path === "/api/teams") {
          if (reloading) {
            reloadReads += 1;
            await reloadHeld;
            if (reload === "failure") {
              await route.fulfill({ status: 403, json: { message: "Read refused", messageZh: "读取被拒绝" } });
              return;
            }
          }
          await route.fulfill({ json: { teams: [{ id: "read-team", name: "Read integrity fixture" }], truncated: false } });
        } else if (path.endsWith("/members")) {
          await route.fulfill({ json: { callerRole: "owner", members: [
            { userId: caller, role: "owner", displayName: "Fixture owner" },
            { userId: "fixture-admin", role: "admin", displayName: "Fixture teammate" },
          ] } });
        } else if (path.endsWith("/settings")) {
          const old = !reloading;
          if (old) { oldSettingsStarted += 1; await oldHeld; }
          else newSettingsReads += 1;
          await route.fulfill({ json: { settings: [
            { key: "default_chart_theme", value: old ? "red_up" : "green_up" },
            { key: "share_layouts_by_default", value: old },
          ] } });
          if (old) oldSettingsFinished += 1;
        } else {
          expect(path).toBe("/api/teams/invitations");
          await route.fulfill({ json: { invites: [] } });
        }
      });
      try {
        await page.goto("/terminal?symbol=NVDA");
        await page.locator(`button[aria-label="${lang === "en" ? "Settings" : "设置"}"]:visible`).first().click();
        await page.getByRole("tab", { name: lang === "en" ? "Team" : "团队", exact: true }).click();
        await expect(page.getByTestId("team-live")).toHaveAttribute("data-caller-role", "owner");
        // The canonical shell identity owns this row even while the optional
        // Supabase profile is unavailable in this existing local fixture.
        await expect(page.getByTestId("team-transfer-ownership")).toHaveCount(1);
        await expect.poll(() => oldSettingsStarted).toBeGreaterThan(0);
        await page.getByTestId("team-invite-email").fill("fixture@example.com");
        await page.getByTestId("team-invite-create").click();
        await expect.poll(() => reloadReads).toBeGreaterThan(0);
        // A pending refresh must not retain stale permission controls.
        await expect(page.getByTestId("team-change-role")).toHaveCount(0);
        await expect(page.getByTestId("team-settings")).toHaveCount(0);
        await expect(page.getByTestId("team-invite-url")).toHaveValue(url);
        releaseReload();
        if (reload === "success") {
          await expect.poll(() => newSettingsReads).toBeGreaterThan(0);
          await expect(page.getByTestId("team-settings-chart")).toHaveValue("green_up");
          await expect(page.getByTestId("team-settings-share").locator("input")).not.toBeChecked();
        } else {
          await expect(page.getByTestId("team-live")).toContainText(lang === "en" ? "Read refused" : "读取被拒绝");
          await expect(page.getByTestId("team-live")).toHaveAttribute("data-team-id", "");
          await expect(page.getByTestId("team-live")).toHaveAttribute("data-caller-role", "");
        }
        releaseOld();
        await expect.poll(() => oldSettingsFinished).toBe(oldSettingsStarted);
        // Wait through paint after the old response has actually returned.
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        if (reload === "success") {
          await expect(page.getByTestId("team-settings-chart")).toHaveValue("green_up");
          await expect(page.getByTestId("team-settings-share").locator("input")).not.toBeChecked();
        } else {
          await expect(page.getByTestId("team-settings")).toHaveCount(0);
          await expect(page.getByTestId("team-change-role")).toHaveCount(0);
          await expect(page.getByTestId("team-transfer-ownership")).toHaveCount(0);
        }
        await expect(page.getByTestId("team-invite-url")).toHaveValue(url);
        expect(methods.filter((method) => method.startsWith("POST"))).toEqual(["POST /api/teams/invitations"]);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (process.env.MO_TEAM_CAPTURE) {
          const output = join(process.cwd(), "docs/pr-crops/mo-b-f12-team-read-integrity");
          await mkdir(output, { recursive: true });
          await page.getByTestId("team-invite-url").scrollIntoViewIfNeeded();
          await page.locator(".acs-overlay.open").screenshot({ path: join(output, `${info.project.name}-${lang}-${reload}.png`) });
        }
      } finally {
        releaseOld();
        releaseReload();
      }
    });
  }
}
