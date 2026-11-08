import { expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Test-owned HTTP transport only. Real Next SSR/RSC/AppShell/status and real
// child HTML/bridge execute; this helper renders no UI, issues no readiness,
// aliases no Link/router and appoints no auth owner. Both Intl consumers share
// this existing fixtures namespace instead of creating competing parents.
export const SHELL = "https://beta.mastermind-x.com";
export const LEGACY = "https://www.mastermind-x.com";
type NextNavigationObservation = {
  path: string; resourceType: string; navigation: boolean; rsc: boolean;
  routerStatePresent: boolean; status: number | null; contentType: string | null;
};
const mime: Record<string, string> = { ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

export async function installRealNextLegacyTransport({ page, context, baseURL, canonicalChildPath, html, assetsDirectory, assets }: {
  page: Page; context: BrowserContext; baseURL: string;
  canonicalChildPath: "/intl.html"; html: Buffer; assetsDirectory?: string; assets?: ReadonlyMap<string, Buffer>;
}) {
  expect(canonicalChildPath).toBe("/intl.html");
  expect((assetsDirectory === undefined) !== (assets === undefined), "One explicit source asset input").toBe(true);
  if (!process.env.CI && process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === undefined) {
    throw new Error("Use the incumbent fresh-owned server harness; never reuse an unrelated local Next server.");
  }
  const native = new URL(baseURL);
  expect(native.protocol).toBe("http:");
  expect(native.username + native.password + native.search + native.hash).toBe("");
  expect(native.pathname).toBe("/");
  expect(["localhost", "127.0.0.1"]).toContain(native.hostname);
  expect(native.port, "Never borrow the original unknown3100 operation").not.toBe("3100");
  const observations = { blockedTelemetryAttempts: [] as Array<{ origin: "shell" | "legacy"; method: "POST"; path: "/api/collect"; disposition: "blocked-before-transport" }>, mutations: [] as string[], baselines: [] as string[], pageErrors: [] as string[], nextRequests: [] as string[], nextNavigations: [] as NextNavigationObservation[], omittedNextNavigations: 0 };
  page.on("pageerror", error => observations.pageErrors.push(error.message));
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: SHELL },
    { name: "mm_e2e_guest", value: "1", url: SHELL },
  ]); // Existing development-only layout/Analysis preview, no signer or session.
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      if (request.method() === "POST" && [SHELL, LEGACY].includes(url.origin) && url.pathname === "/api/collect"
        && !url.search && !url.hash && !url.username && !url.password && request.url() === url.origin + "/api/collect") {
        observations.blockedTelemetryAttempts.push({ origin: url.origin === SHELL ? "shell" : "legacy", method: "POST", path: "/api/collect", disposition: "blocked-before-transport" });
        await route.abort("blockedbyclient"); return;
      }
      observations.mutations.push(`${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient"); return;
    }
    if (url.pathname.startsWith("/api/investigations/baseline")) {
      observations.baselines.push(url.pathname); await route.abort("blockedbyclient"); return;
    }
    if (url.origin === SHELL) {
      // Retain the incumbent browser read fixtures. The sibling status endpoint
      // below is real Next source; do not manufacture its gate response.
      const readFixtures: Record<string, unknown> = {
        "/api/investigations": { status: "listed", items: [] },
        "/api/layouts": { layouts: [], teams: [], teamRead: { ok: true } },
        "/api/alerts": { alerts: [] }, "/api/alerts/receipts": { outbox: [] },
        "/data/manifest.json": { as_of: null, symbols: {} },
      };
      if (Object.hasOwn(readFixtures, url.pathname)) { await route.fulfill({ json: readFixtures[url.pathname] }); return; }
      if (url.pathname.startsWith("/_next/") || ["/analysis", canonicalChildPath, "/api/shared-shell/status"].includes(url.pathname)) {
        // Real SSR/RSC/chunks from the existing fresh Next process. Forward only
        // ordinary Next navigation headers and two fixed fixture cookies, never
        // a credential/profile. Redirects stay observable rather than rewritten.
        const headers: Record<string, string> = { cookie: "mm_e2e_rs30=1; mm_e2e_guest=1" };
        const incoming = request.headers();
        for (const key of ["accept", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url"]) if (incoming[key]) headers[key] = incoming[key];
        observations.nextRequests.push(url.pathname);
        // Bounded route diagnostics only: no query, cookie, header value or body.
        const navigation: NextNavigationObservation | null = ["/analysis", canonicalChildPath].includes(url.pathname)
          ? { path: url.pathname, resourceType: request.resourceType(), navigation: request.isNavigationRequest(),
              rsc: incoming.rsc === "1", routerStatePresent: !!incoming["next-router-state-tree"], status: null, contentType: null }
          : null;
        if (navigation) {
          if (observations.nextNavigations.length < 16) observations.nextNavigations.push(navigation);
          else observations.omittedNextNavigations++;
        }
        const response = await context.request.fetch(new URL(url.pathname + url.search, native).href, { method: request.method(), headers, maxRedirects: 0 });
        if (navigation) {
          navigation.status = response.status();
          const contentType = (response.headers()["content-type"] ?? "").split(";", 1)[0].trim();
          navigation.contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType) ? contentType : "other";
        }
        await route.fulfill({ response }); return;
      }
    }
    if (url.origin === LEGACY) {
      if (url.pathname === canonicalChildPath) { await route.fulfill({ contentType: "text/html; charset=utf-8", body: html }); return; }
      if (assets !== undefined) {
        const body = assets.get(url.pathname);
        if (body && Object.hasOwn(mime, path.extname(url.pathname))) {
          await route.fulfill({ contentType: mime[path.extname(url.pathname)], body }); return;
        }
        await route.abort("blockedbyclient"); return; // no missing-map -> file/current fallback
      }
      const file = path.resolve(assetsDirectory!, "." + decodeURIComponent(url.pathname));
      const root = path.resolve(assetsDirectory!);
      if (file.startsWith(root + path.sep) && Object.hasOwn(mime, path.extname(file))) {
        try { await route.fulfill({ contentType: mime[path.extname(file)], body: readFileSync(file) }); return; } catch { /* missing stays unavailable */ }
      }
    }
    await route.abort("blockedbyclient"); // No live Macro/feed/account/provider escape.
  });
  return observations;
}
