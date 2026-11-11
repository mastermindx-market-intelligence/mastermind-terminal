/**
 * Shared Shell generated membership regression (published company/earnings refresh).
 *
 * The pinned generated catalog (sharedShellRoutes.generated.json) predates the
 * newly published /stocks/earnings/*.html pages. The canonical generator must
 * admit those pages, and nothing else, so the positive cases below fail
 * against the stale pinned catalog and pass once the regenerated projection
 * lands. The real route helpers, the real generated projection and the real
 * legacy catch-all server page are imported; only next/navigation#notFound is
 * mocked (as a throwing spy) and MMX_SHARED_SHELL is stubbed per test. No
 * network, browser, auth or database is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundSpy } = vi.hoisted(() => ({
  notFoundSpy: vi.fn(() => {
    throw new Error("Shared Shell route not admitted: notFound() called");
  }),
}));

// The server page calls notFound() for any path outside the generated
// membership; the spy keeps that rejection observable without a router.
vi.mock("next/navigation", () => ({ notFound: notFoundSpy }));

import {
  isLegacyShellPath,
  resolveSharedShellLink,
  sharedShellCatalog,
} from "../sharedShellRoutes";
import LegacyShellPage, { generateMetadata } from "../../app/(shell)/[...legacyPath]/page";

const SHARED_SHELL_FLAG = "MMX_SHARED_SHELL";

/** Published family members, including the November protected inventory refresh. */
const NEW_PUBLISHED_PAGES = [
  "/stocks/earnings/ge-2026q3-call-record.html",
  "/stocks/earnings/page-61.html",
  "/stocks/earnings/aal-2026q3-call-record.html",
  "/stocks/earnings/abbv-2026q3-call-record.html",
  "/stocks/HTFL.html",
  "/stocks/MIAX.html",
] as const;

/** Look-alikes that must stay outside the strict-finite generated membership. */
const NON_MEMBERS = [
  "/expectation_surface.html",
  "/stocks/earnings/not-published-call-record.html",
  "/committee.html",
  "/crossasset.html",
  "/api/private",
  "/gmi.html",
  "/macro/fragments/credit.html",
  // Product Trust F-6 withdrew this fixture-only card in Macro #10237/#10268.
  "/consumer_cyclical_plnt.html",
] as const;

/** Generated titles end in a "<label> <dot> Mastermind" suffix; only the suffix is stable. */
const TITLE_SUFFIX = "· Mastermind";

type PageProps = Parameters<typeof LegacyShellPage>[0];

function pageProps(path: string): PageProps {
  return { params: Promise.resolve({ legacyPath: path.slice(1).split("/") }) };
}

beforeEach(() => {
  vi.stubEnv(SHARED_SHELL_FLAG, "1");
});

afterEach(() => {
  // Clear call state only: resetting all mocks would strip the throwing
  // notFound implementation, and env stubs must not leak between tests.
  notFoundSpy.mockClear();
  vi.unstubAllEnvs();
});

describe("Shared Shell generated membership refresh", () => {
  describe("published company and earnings pages", () => {
    it.each([...NEW_PUBLISHED_PAGES])("admits %s exactly, without a native collision", (path) => {
      expect(isLegacyShellPath(path)).toBe(true);
      expect(sharedShellCatalog.legacyPaths).toContain(path);
      expect(sharedShellCatalog.nativePaths).not.toContain(path);
    });

    it("resolves admitted earnings links as legacy, keeping ordinary query bytes and dropping bridge transport", () => {
      const admitted = NEW_PUBLISHED_PAGES[0];
      const target = resolveSharedShellLink(
        admitted + "?ticker=GE&q=earnings&q=call&mmx_shell_hint=x&mmx_shell=1&mmx_generation=g2026q3#transcript",
        admitted,
      );
      // Repeated ordinary keys and unknown ordinary keys survive in order;
      // only the exact bridge transport keys are removed; the hash is kept.
      expect(target).toEqual({
        kind: "legacy",
        href: admitted + "?ticker=GE&q=earnings&q=call&mmx_shell_hint=x#transcript",
      });

      // A plain admitted link round-trips without growing transport bytes.
      expect(resolveSharedShellLink(admitted, admitted)).toEqual({
        kind: "legacy",
        href: admitted,
      });
    });

    it("serves the actual server page and noindex metadata for the new pages", async () => {
      for (const path of NEW_PUBLISHED_PAGES) {
        const rendered = await LegacyShellPage(pageProps(path));
        expect(rendered).toBeNull();

        const meta = await generateMetadata(pageProps(path));
        expect(meta.robots.index).toBe(false);
        expect(meta.robots.follow).toBe(false);
        expect(meta.title.endsWith(TITLE_SUFFIX)).toBe(true);
        expect(meta.title.slice(0, meta.title.length - TITLE_SUFFIX.length).trim().length)
          .toBeGreaterThan(0);

        expect(notFoundSpy).not.toHaveBeenCalled();
      }
    });
  });

  it("retains the ordinary PLNT company and earnings paths after the synthetic card withdrawal", () => {
    for (const path of ["/stocks/PLNT.html", "/stocks/earnings/plnt-2026q2-call-record.html"]) {
      expect(isLegacyShellPath(path)).toBe(true);
      expect(resolveSharedShellLink(path, path)).toEqual({ kind: "legacy", href: path });
    }
  });

  describe("routes outside the generated membership", () => {
    it.each([...NON_MEMBERS])("rejects %s for membership, resolution and the actual page", async (path) => {
      expect(isLegacyShellPath(path)).toBe(false);
      expect(resolveSharedShellLink(path, path).kind).toBe("blocked");

      await expect(LegacyShellPage(pageProps(path))).rejects.toThrow();
      await expect(generateMetadata(pageProps(path))).rejects.toThrow();
      expect(notFoundSpy).toHaveBeenCalled();
    });
  });

  it("rejects an admitted page when the Shared Shell flag is off", async () => {
    const admitted = NEW_PUBLISHED_PAGES[0];
    expect(isLegacyShellPath(admitted)).toBe(true);

    vi.stubEnv(SHARED_SHELL_FLAG, "0");
    await expect(LegacyShellPage(pageProps(admitted))).rejects.toThrow();
    await expect(generateMetadata(pageProps(admitted))).rejects.toThrow();
    expect(notFoundSpy).toHaveBeenCalled();
  });
});
