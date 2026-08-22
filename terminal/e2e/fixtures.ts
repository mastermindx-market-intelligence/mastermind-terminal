import { test as base, type Page } from "@playwright/test";
import { createHmrFilter } from "./hmrFilter";
import {
  CAPTURE_SSR_NODES, HYDRATION_TIMEOUT_MS, SSR_NODES_HYDRATED, UNHYDRATED_REPORT,
} from "./hydration";

/**
 * Block until the page React just served is actually wired up. e2e/hydration.ts carries the
 * measurements and the reasoning; the short version is that every actionability check Playwright
 * offers is answered by the DOM, and a server-rendered page satisfies all of them ~1.6s before
 * React attaches a single handler — so the suite's first click after a navigation was landing on
 * dead markup and being discarded.
 */
async function waitForInteractive(page: Page) {
  try {
    await page.waitForFunction(SSR_NODES_HYDRATED, undefined, { timeout: HYDRATION_TIMEOUT_MS, polling: 100 });
  } catch (error) {
    // A navigation during the wait invalidates the context rather than proving anything about the
    // page; the next navigation installs its own capture and gates again.
    if (String(error).includes("Execution context was destroyed")) return;
    // Otherwise fail LOUDLY and name the surface. Continuing here would hand back exactly the silent
    // dropped-click flake this gate exists to remove, hidden behind an unrelated assertion later.
    const report = await page.evaluate(UNHYDRATED_REPORT).catch(() => null) as
      { captured: number; stragglers: string[] } | null;
    throw new Error(
      `The page never became interactive: of ${report?.captured ?? "?"} server-rendered controls, `
      + `these were still unwired after ${HYDRATION_TIMEOUT_MS}ms: ${JSON.stringify(report?.stragglers ?? [])}. `
      + `React never hydrated them — see e2e/hydration.ts.`,
    );
  }
}

/**
 * The suite's `test` — Playwright's, plus two things: every navigation waits for the page to be
 * interactive (above), and Fast Refresh cannot fire inside it (below).
 *
 * Not a spec file: Playwright's default testMatch only collects *.spec.ts, so this module is
 * imported, never run.
 *
 * NOT the cause of the rotating CI flake — that is the hydration race in e2e/hydration.ts, and this
 * filter was built on a hypothesis its own CI runs disproved (the pine-editor failure reproduced
 * unchanged with zero rebuilds recorded, and after the warm-up removed cold compiles 179 of 508
 * tests saw a rebuild while passing). What it removes is real but separate: a no-op re-render the
 * suite has no reason to tolerate.
 *
 * ── WHAT IT REMOVES ──────────────────────────────────────────────────────────────────────────
 *
 * `webServer` runs `next dev`, and its dev server broadcasts a `building`/`built` pair to EVERY
 * connected page on essentially every request it serves — including requests that changed nothing.
 * Measured on 2026-08-21 against a WARM server: twelve tests produced 158 such pairs in 51
 * seconds, all carrying the same compilation hash and no errors. They are no-ops, but the page
 * does not know that: `built` drives handleHotUpdate(), so each pair re-renders the tree and
 * refetches the RSC payload of whatever page happens to be open.
 *
 * In a fullyParallel run that means one worker's page traffic re-renders the page ANOTHER worker
 * is mid-gesture on: server props snap back to their initial values while client state survives.
 * No test failure has been traced to it — the pine-editor traces that first suggested it turned out
 * to fail identically with zero rebuilds — but a suite whose pages re-render on another worker's
 * HTTP traffic is measuring something the product never does, so it is removed rather than
 * tolerated. Measured: an idle page saw 24 such cycles while another context browsed, and ZERO
 * with this in place, on both a warm and a cold server.
 *
 * ── WHAT THIS DOES, AND WHY NOT SOMETHING BLUNTER ────────────────────────────────────────────
 *
 * e2e/hmrFilter.ts withholds a `building`/`built` pair ONLY when nothing passed between the two —
 * exactly the no-op case, since such a pair has nothing for the page to apply.
 *
 * The "only when nothing passed between them" part is not fastidiousness, it is the whole safety
 * argument, and it was learned twice. Blackholing the socket outright breaks the suite: the same
 * socket carries Turbopack's `turbopack-connected` / `turbopack-message` traffic, and without it
 * every next/dynamic surface — the Analysis workspace, the Options tabs — sits on its skeleton
 * forever. Withholding EVERY clean `built` breaks it more subtly, which is worse: a lazily-built
 * chunk arrives as `turbopack-message` and is applied when the following `built` lands, so
 * suppressing that `built` leaves the surface unmounted whenever the chunk was not already on
 * disk. That shipped for one CI run and turned the Pine editor's four specs into "the editor never
 * appeared" — green only because retries covered it.
 *
 * A `built` carrying errors or warnings is always forwarded, so a genuine compile failure reaches
 * the page and the overlay instead of turning into a mystery timeout.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    // Runs before any page script on every new document, so the capture lands on the markup the
    // SERVER sent — before hydration tags it, and before any effect adds DOM React never rendered.
    await context.addInitScript(CAPTURE_SSR_NODES);

    await context.routeWebSocket(/\/_next\/webpack-hmr/, (ws) => {
      const server = ws.connectToServer();
      const filter = createHmrFilter();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        for (const frame of filter(message)) ws.send(frame);
      });
    });
    await use(context);
  },

  // The filter above is matched against a frame shape Next owns, so an upgrade could rename these
  // and silently stop it working. The annotation at the end of this fixture is the tripwire for
  // that: it means the filter has stopped matching and should be re-read against the new Next.
  page: async ({ page }, use, testInfo) => {
    // E2E_CPU_THROTTLE=8 reproduces a loaded CI runner on a fast laptop, and is how the dropped-
    // click race above was found: the suite passed locally 4 runs in a row while failing CI, because
    // a warm 24-core machine closes the hydration window before a test can lose a click in it. At 8x
    // the pine-editor D3a spec failed 6/6 with the gate removed and 0/6 with it. Opt-in and unset in
    // CI — this is a diagnostic lever for reproducing timing bugs locally, not part of the gate.
    const throttle = Number(process.env.E2E_CPU_THROTTLE || 0);
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page).catch(() => null);
      await cdp?.send("Emulation.setCPUThrottlingRate", { rate: throttle }).catch(() => {});
    }

    // Every full navigation gates on interactivity. Patched here rather than offered as a helper
    // the specs call, for the same reason the `test` import is pinned by npm test: an opt-in gate
    // fails OPEN. A spec that forgot it would pass locally against a warm server and hand the
    // dropped-click flake back on the next loaded CI run, with a new victim. Client-side
    // navigations (a link, router.push) need no gate — that tree is built by React already running.
    for (const name of ["goto", "reload", "goBack", "goForward"] as const) {
      const original = page[name].bind(page) as (...args: unknown[]) => Promise<unknown>;
      (page as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        const response = await original(...args);
        await waitForInteractive(page);
        return response;
      };
    }

    let rebuilds = 0;
    page.on("console", (message) => {
      if (message.text().startsWith("[Fast Refresh] rebuilding")) rebuilds += 1;
    });
    await use(page);
    if (rebuilds > 0) {
      testInfo.annotations.push({
        type: "fast-refresh",
        description: `${rebuilds} rebuild(s) re-rendered this page mid-test — e2e/fixtures.ts is no longer withholding them`,
      });
    }
  },
});

// `expect`, `devices`, `Page`, `Locator`, `TestInfo` … re-exported unchanged. The explicit `test`
// above shadows the star-exported one, so a spec that imports from here cannot get the raw fixture
// by accident.
export * from "@playwright/test";
