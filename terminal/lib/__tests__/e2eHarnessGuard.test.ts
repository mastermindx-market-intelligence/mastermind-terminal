import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ── THE ONE-LINE BYPASSES THAT PUT THE FLAKE BACK ─────────────────────────────────────────────
//
// e2e/fixtures.ts makes every navigation wait until React has actually wired the page up. Without
// it a spec's first click lands on server-rendered markup that satisfies every Playwright
// actionability check and has no handler behind it, and the event is DROPPED — the cause of the
// rotating CI failures diagnosed on 2026-08-21, measured at 1.6s of dead markup on /scripts and
// 8.5s on /terminal (e2e/hydration.ts carries the numbers). It also withholds `next dev`'s no-op
// build broadcasts, and e2e/warmup.setup.ts compiles the suite's surfaces up front.
//
// All of it is opt-in, and all of it fails OPEN — which is why it is pinned here rather than left
// to review. A spec written with `import { test } from "@playwright/test"` compiles, runs, and
// passes locally against a warm, fast machine; it has simply opted that one file back into the
// flake, and the next loaded CI run picks it as the victim. A route the specs reach but the warm-up
// misses is built mid-run instead of up front. Playwright has no global beforeEach to enforce the
// import from, so `npm test` enforces it — seconds after a spec is written, and long before the
// responsive job.

const E2E = path.resolve(__dirname, "..", "..", "e2e");
const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));
const source = (f: string) => readFileSync(path.join(E2E, f), "utf8");
// TWO warm-ups now, doing different jobs: #452's globalSetup compiles each route over HTTP before
// the suite starts, and the browser warm-up project additionally pays the client bundle and the
// Options tabs. A route only has to be in ONE of them — but their lists have already drifted once
// (/scripts is in only one), so coverage is asserted against the union rather than either file.
const warmup = readFileSync(path.join(E2E, "warmup.setup.ts"), "utf8")
  + readFileSync(path.join(E2E, "globalSetup.ts"), "utf8");
const config = readFileSync(path.resolve(__dirname, "..", "..", "playwright.config.ts"), "utf8");

// Top-level `import … from "…"` only. Inline `import("@playwright/test").Page` type positions are
// left alone deliberately: they name a type, they never produce a runtime fixture.
const importsFrom = (src: string, mod: string) =>
  new RegExp(String.raw`^import[^;]*?from "${mod}"`, "m").test(src);

describe("responsive e2e specs run against a pre-compiled dev server", () => {
  it("finds the specs (a rename must not turn this guard into a no-op)", () => {
    expect(specs.length).toBeGreaterThan(40);
  });

  it("takes `test` from e2e/fixtures.ts in every spec", () => {
    const missing = specs.filter((f) => !importsFrom(source(f), String.raw`\./fixtures`));
    expect(missing).toEqual([]);
  });

  it("leaves no spec importing the raw Playwright fixture", () => {
    const raw = specs.filter((f) => importsFrom(source(f), "@playwright/test"));
    expect(raw).toEqual([]);
  });

  it("warms every route the specs navigate to", () => {
    // The specs are the authority on what has to be warm. Anything they `goto` that the warm-up
    // does not visit is compiled mid-run — which is the defect this all exists to remove.
    const visited = new Set<string>();
    for (const file of specs) {
      // The whole path, not just its first segment: /embed/chart and /embed are different routes
      // and only one of them compiles the chart the specs assert on.
      for (const [, route] of source(file).matchAll(/goto\(\s*[`"](\/[a-z][a-z0-9/-]*)/g)) visited.add(route);
    }
    expect(visited.size).toBeGreaterThan(4);
    expect([...visited].filter((route) => !warmup.includes(`"${route}`))).toEqual([]);
  });

  it("gates every full navigation on the page being interactive", () => {
    // The gate is a patch over the page's own navigation methods, so it cannot be reasoned about
    // from the spec files: a spec looks identical whether or not it is protected. If a refactor
    // drops one of these, the specs that use it go back to racing hydration and nothing says so.
    const fixtures = readFileSync(path.join(E2E, "fixtures.ts"), "utf8");
    const gated = fixtures.slice(fixtures.indexOf("page: async"));
    for (const method of ["goto", "reload", "goBack", "goForward"]) {
      expect(gated, `navigation method ${method}`).toContain(`"${method}"`);
    }
    expect(gated).toContain("waitForInteractive(page)");
    expect(fixtures).toContain("addInitScript(CAPTURE_SSR_NODES)");
    // …and the predicate must stay the framework's own answer. A sleep, or waiting on the DOM,
    // is what this replaced: both are satisfied while the markup is still dead.
    const hydration = readFileSync(path.join(E2E, "hydration.ts"), "utf8");
    expect(hydration).toContain("__reactFiber$");
  });

  it("still routes the socket through the filter rather than around it", () => {
    // What the filter DOES is tested for real in e2eHmrFilter.test.ts. What cannot be tested there
    // is that it is still wired up — and that the socket still reaches the actual dev server, since
    // Turbopack delivers next/dynamic chunks over it and a blackholed socket leaves every lazily
    // mounted surface on its skeleton forever.
    const fixtures = readFileSync(path.join(E2E, "fixtures.ts"), "utf8");
    expect(fixtures).toContain(String.raw`routeWebSocket(/\/_next\/webpack-hmr/`);
    expect(fixtures).toContain("connectToServer()");
    expect(fixtures).toContain("createHmrFilter()");
  });

  it("keeps the warm-up ahead of every project that runs specs", () => {
    // A project without the dependency starts against a cold server, and its first tests are the
    // ones that pay for the compiles — in front of everyone else's open pages.
    const projects = [...config.matchAll(/name: "([a-z-]+)"/g)].map(([, name]) => name);
    const runsSpecs = projects.filter((name) => name !== "warmup");
    expect(runsSpecs.length).toBeGreaterThan(4);
    for (const name of runsSpecs) {
      const block = config.slice(config.indexOf(`name: "${name}"`));
      expect(block.slice(0, block.indexOf("}")), `project ${name}`).toContain("dependencies:");
    }
  });
});
