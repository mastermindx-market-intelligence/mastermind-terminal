/**
 * Capture-isolation regression for the options-level-axis evidence packet.
 *
 * The packet proves option-level lines, native axis-label suppression and badge
 * collisions. It does NOT prove anything about the Brain account. The Terminal
 * shell mounts the production Brain widget, which asks the SAME-ORIGIN Brain
 * account companion `GET /api/brain/me` who the visitor is; the Terminal's own
 * `app/api/brain/[...path]` proxy forwards that to the Brain gateway and answers
 * 502 "Gateway unreachable" whenever the gateway is unreachable. The 502 is a
 * console error and an HTTP error in the capture, so a page whose option-level
 * proof is otherwise perfect still fails the evidence test's "no console/page/
 * HTTP errors" assertion — which is exactly how CI run 42343740607 went red on
 * `lib/__tests__/optionsLevelAxisEvidence.test.ts`.
 *
 * This suite is the two-arm differential:
 *
 *   PRE-REPAIR arm — the capture's companion route table as it stood before the
 *   repair. The account companion matches none of those patterns, so it reaches
 *   the upstream and the upstream's 502 is recorded. That is the CI failure,
 *   reproduced rather than asserted.
 *
 *   REPAIRED arm — the real exported installer. The account companion is
 *   answered inside the browser, the upstream is never asked, and the capture's
 *   three error lists stay empty.
 *
 * Both arms run in a real browser against a real upstream that answers 502, so
 * the arms differ by exactly the repair and nothing else. Deleting the
 * isolation fails the REPAIRED arm on the upstream hit count, the status and
 * the error lists at once.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { parseAccountUsage } from "../accountPlan";
import {
  BRAIN_GUEST_USAGE,
  BRAIN_ME_PATH,
  installBrainAccountIsolation,
  isBrainMeUrl,
} from "../../docs/pr-crops/options-level-axis-labels/captureRoutes.mjs";

const TERMINAL = join(__dirname, "../..");
const CAPTURE = join(TERMINAL, "docs/pr-crops/options-level-axis-labels/capture.mjs");

/**
 * The capture's companion route table as it stood BEFORE the repair, verbatim.
 *
 * None of these patterns can match the Brain account companion, which is exactly
 * why that request used to walk out to the upstream. The options-contract
 * payloads the capture also installs (the quote, ext-quote and flow routes) are
 * omitted here because no pattern among them can match `/api/brain/me` either;
 * this arm is about the COMPANION table.
 */
const PRE_REPAIR_COMPANION_ROUTES = [
  "**/data/coverage.json",
  "**/data/NVDA.intel.json",
  "**/data/NVDA.opts.json",
  "**/data/NVDA.fund.json",
  "**/api/brain/chart/state",
];

type Upstream = {
  url: string;
  /** Every path the upstream was asked for, in order. */
  hits: string[];
  close: () => Promise<void>;
};

/**
 * The upstream stands in for the Brain gateway. It answers the account
 * companion with the 502 the Terminal proxy produces when the gateway cannot be
 * reached, and it records every path it was asked for, so "the request never
 * reached the upstream" is an observation rather than an assertion about code.
 */
async function startUpstream(): Promise<Upstream> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    hits.push(pathname);
    if (pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><meta charset=\"utf-8\"><body><script>" +
        "window.__brainMe = fetch('/api/brain/me', {method: new URL(location.href).searchParams.get('method') || 'GET'})" +
        ".then(async (r) => ({ status: r.status, body: await r.text() }))" +
        ".catch((e) => ({ status: -1, body: String(e) }));" +
        "</script></body>",
      );
      return;
    }
    if (pathname === BRAIN_ME_PATH) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Gateway unreachable" }));
      return;
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Probe = {
  status: number;
  body: string;
  consoleErrors: string[];
  httpErrors: Array<{ status: number; url: string }>;
  /** The paths THIS probe caused the upstream to be asked for. */
  upstreamHits: string[];
};

async function probe(browser: Browser, upstream: Upstream, isolate: boolean, method = "GET"): Promise<Probe> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const httpErrors: Array<{ status: number; url: string }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
  });
  if (isolate) {
    await installBrainAccountIsolation(page, upstream.url);
  } else {
    for (const pattern of PRE_REPAIR_COMPANION_ROUTES) {
      await page.route(pattern, async (route) => route.fulfill({ json: {} }));
    }
  }
  // The upstream's log is shared by both arms; each arm observes only its own slice.
  const seenBefore = upstream.hits.length;
  await page.goto(`${upstream.url}/?method=${method}`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    () => (window as unknown as { __brainMe: Promise<{ status: number; body: string }> }).__brainMe,
  );
  const upstreamHits = upstream.hits.slice(seenBefore);
  await context.close();
  return { ...result, consoleErrors, httpErrors, upstreamHits };
}

function chromiumExecutable(): string | null {
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const BROWSER = chromiumExecutable();

describe("Options-level capture isolation", () => {
  describe("the account companion's identity", () => {
    it("matches the Brain account companion's path exactly, and nothing else", () => {
      const origin = "http://127.0.0.1:3536";
      expect(isBrainMeUrl(`${origin}${BRAIN_ME_PATH}`, origin)).toBe(true);
      expect(isBrainMeUrl(`https://www.mastermind-x.com${BRAIN_ME_PATH}`, origin)).toBe(false);
      expect(isBrainMeUrl(`http://127.0.0.1:3537${BRAIN_ME_PATH}`, origin)).toBe(false);
      // Query parameters do not widen this same-origin, exact-path fixture.
      expect(isBrainMeUrl(`${origin}${BRAIN_ME_PATH}?x=1`, origin)).toBe(true);
      // The neighbours the capture already isolates, and the rest of the plane.
      expect(isBrainMeUrl("http://127.0.0.1:3536/api/brain/chart/state", origin)).toBe(false);
      expect(isBrainMeUrl("http://127.0.0.1:3536/api/brain/threads", origin)).toBe(false);
      expect(isBrainMeUrl("http://127.0.0.1:3536/api/me", origin)).toBe(false);
      expect(isBrainMeUrl("http://127.0.0.1:3536/data/NVDA.opts.json", origin)).toBe(false);
      expect(isBrainMeUrl("not a url", origin)).toBe(false);
    });

    it("answers with a guest lane that claims no account, entitlement or quota", () => {
      const usage = parseAccountUsage(BRAIN_GUEST_USAGE);
      // The Terminal's own reader narrows the payload to exactly a tier and its lanes.
      expect(Object.keys(usage).sort()).toEqual(["quotas", "tier"]);
      expect(usage.tier).toBe("guest");
      expect(Object.keys(usage.quotas ?? {}).sort()).toEqual(["fast", "pro"]);
      for (const lane of Object.values(usage.quotas ?? {})) {
        expect(lane.remaining).toBe(0);
        expect(lane.limit).toBe(0);
      }
      // Nothing that could read as a signed-in or paid account.
      for (const forbidden of ["email", "user", "status", "features", "chat_budget", "plan"]) {
        expect(BRAIN_GUEST_USAGE).not.toHaveProperty(forbidden);
      }
    });
  });

  it("wires the capture's own route table to the isolation", () => {
    const source = readFileSync(CAPTURE, "utf8");
    expect(source).toMatch(/import\s*\{[^}]*installBrainAccountIsolation[^}]*\}\s*from\s*"\.\/captureRoutes\.mjs"/);
    expect(source).toMatch(/await installBrainAccountIsolation\(page, baseURL\)/);
  });

  describe.skipIf(!BROWSER)("in a real browser against a real 502 upstream", () => {
    let browser: Browser;
    let upstream: Upstream;

    beforeAll(async () => {
      browser = await chromium.launch({ headless: true });
      upstream = await startUpstream();
    }, 60_000);

    afterAll(async () => {
      await browser?.close();
      await upstream?.close();
    });

    it("fails on the pre-repair table: the account companion reaches the 502 upstream", async () => {
      const result = await probe(browser, upstream, false);
      // The companion went out to the network and the upstream answered 502.
      expect(result.upstreamHits.filter((path) => path === BRAIN_ME_PATH)).toHaveLength(1);
      expect(result.status).toBe(502);
      // The two observations the capture records, and the two the evidence test asserts empty.
      expect(result.httpErrors).toEqual([{ status: 502, url: `${upstream.url}${BRAIN_ME_PATH}` }]);
      expect(result.consoleErrors.length).toBeGreaterThan(0);
      expect(result.consoleErrors.join("\n")).toMatch(/502/);
    }, 60_000);

    it("leaves writes to the real upstream and preserves their errors", async () => {
      const result = await probe(browser, upstream, true, "POST");
      expect(result.upstreamHits.filter((path) => path === BRAIN_ME_PATH)).toHaveLength(1);
      expect(result.status).toBe(502);
      expect(result.httpErrors).toEqual([{ status: 502, url: `${upstream.url}${BRAIN_ME_PATH}` }]);
      expect(result.consoleErrors.join("\n")).toMatch(/502/);
    }, 60_000);

    it("keeps the account companion inside the browser on the repaired table", async () => {
      const result = await probe(browser, upstream, true);
      // The page itself was fetched normally: the isolation is narrow.
      expect(result.upstreamHits).toContain("/");
      // And the account companion never left the browser.
      expect(result.upstreamHits.filter((path) => path === BRAIN_ME_PATH)).toHaveLength(0);
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toEqual(BRAIN_GUEST_USAGE);
      // The capture's three error lists stay empty, which is what the evidence test asserts.
      expect(result.consoleErrors).toEqual([]);
      expect(result.httpErrors).toEqual([]);
    }, 60_000);
  });
});
