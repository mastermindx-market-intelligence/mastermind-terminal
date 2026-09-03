/**
 * adminPageStatusContract.test.ts — /admin's STATUS CODE is the answer, not merely its intent.
 *
 * PR #442 (F-1) made 404 / 503 / 200 mean three distinct things for /api/admin/searches, and
 * adminSearchesAuthority.test.ts pins that wire contract. The PAGE beside it asked for the same
 * discipline in source — `redirect("/login")` for anonymous, `notFound()` for denied — and did not
 * deliver it. Measured on production 2026-08-21 (master @ c66c1154), anonymous, straight against
 * the origin so no CDN could be blamed:
 *
 *     GET /admin  ->  200      (no admin markup; a workspace skeleton and a soft redirect)
 *     GET /login  ->  307
 *
 * The gate was innocent: the RSC payload carried `digest: "NEXT_REDIRECT;replace;/login;307;"`, so
 * isAdminRequest() had answered "anonymous" and the page had asked for the 307. The boundary ate
 * it. `app/(shell)/loading.tsx` wrapped every route in the group, including /admin, so React
 * flushed the shell — status line and all — the moment the layout resolved, while the page was
 * still awaiting the gate. After a flush a redirect/notFound can only be delivered as a soft
 * client-side navigation inside the payload. Monitoring, caches and crawlers were told the owner
 * console was OK, and a visitor with no session at all got a 200.
 *
 * So this file pins BOTH halves, because either alone is a false green:
 *   1. the branch — each verdict raises the control-flow signal carrying the intended status;
 *   2. the delivery — nothing above /admin can flush the response before that signal is raised.
 * (2) is the one that actually broke. A test of (1) alone passed the whole time production
 * answered 200.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AdminVerdict } from "@/lib/adminGate";

const H = vi.hoisted(() => ({
  verdict: { status: "anonymous", email: null } as AdminVerdict,
}));

vi.mock("@/lib/adminGate", () => ({
  isAdminRequest: vi.fn(async () => H.verdict),
}));

// The console body is a client component with its own suite; this file is about what the page
// answers, so stub it and read the props the page hands it.
vi.mock("@/components/AdminView", () => ({
  default: function AdminView() {
    return null;
  },
}));

import AdminPage from "@/app/(shell)/admin/page";

/**
 * What a request to /admin actually receives. `redirect()` and `notFound()` communicate by
 * throwing an error whose `digest` carries the status Next will put on the wire, so reading the
 * digest reads the status — no server needed.
 */
type Answer = { status: number; location?: string; props?: Record<string, unknown> };

async function answer(): Promise<Answer> {
  try {
    const el = (await AdminPage()) as { props: Record<string, unknown> };
    return { status: 200, props: el.props };
  } catch (err) {
    const [code, ...rest] = String((err as { digest?: unknown })?.digest ?? "").split(";");
    // "NEXT_REDIRECT;replace;/login;307;"
    if (code === "NEXT_REDIRECT") return { status: Number(rest[2]), location: rest[1] };
    // "NEXT_HTTP_ERROR_FALLBACK;404"
    if (code === "NEXT_HTTP_ERROR_FALLBACK") return { status: Number(rest[0]) };
    throw err;
  }
}

beforeEach(() => {
  H.verdict = { status: "anonymous", email: null };
  vi.clearAllMocks();
});

describe("GET /admin — every verdict carries its own status", () => {
  it("307s a visitor with no session to /login", async () => {
    expect(await answer()).toMatchObject({ status: 307, location: "/login" });
  });

  it("404s a signed-in non-owner — the route stays unadvertised", async () => {
    H.verdict = { status: "denied", email: "someone@example.com" };
    expect(await answer()).toMatchObject({ status: 404 });
  });

  it("200s the owner, with the console mounted", async () => {
    H.verdict = { status: "admin", email: "owner@example.com" };
    const res = await answer();
    expect(res.status).toBe(200);
    expect(res.props).toMatchObject({ email: "owner@example.com", authorityUnavailable: false });
  });

  it("200s — NOT 404, NOT /login — when the authority could not be reached", async () => {
    // Fail-closed still holds (the API answers 503 and the client renders the outage); what must
    // never happen is telling the owner their console does not exist, or bouncing them to
    // re-authenticate against the same broken auth server. See lib/adminGate.ts.
    H.verdict = { status: "unavailable", email: "owner@example.com" };
    const res = await answer();
    expect(res.status).toBe(200);
    expect(res.props).toMatchObject({ authorityUnavailable: true });
  });
});

describe("nothing above /admin may flush the response before the gate answers", () => {
  const APP = path.resolve(__dirname, "../../app");
  const SHELL = path.join(APP, "(shell)");
  // Every segment from the app root down to the page. A `loading.tsx` at ANY of them wraps this
  // route in Suspense, and the status code stops being negotiable.
  const ANCESTRY = [APP, SHELL, path.join(SHELL, "admin")];

  it("declares no loading.tsx on the /admin segment chain", () => {
    const offenders = ANCESTRY.filter((dir) => existsSync(path.join(dir, "loading.tsx")));
    expect(
      offenders.map((d) => path.relative(APP, d) || "app"),
      "a loading.tsx here re-introduces the 200-instead-of-307 bug — declare the fallback per " +
        "workspace (components/WorkspaceLoading.tsx) instead",
    ).toEqual([]);
  });

  it("keeps the ancestor layouts free of a hand-rolled Suspense boundary around children", () => {
    // Same failure, spelled differently: a <Suspense> around {children} in either layout flushes
    // the shell for exactly the same reason loading.tsx does.
    for (const dir of [APP, SHELL]) {
      const layout = path.join(dir, "layout.tsx");
      expect(readFileSync(layout, "utf8"), `${layout} must not suspend /admin`).not.toMatch(
        /Suspense/,
      );
    }
  });

  it("still streams a skeleton for every OTHER workspace in the group", () => {
    // The fix is "move the boundary down", not "delete the skeleton". If these stop existing, the
    // five data workspaces silently lose their fallback and this test is why we'd notice.
    const routes = readdirSync(SHELL, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "admin")
      .map((e) => e.name)
      .sort();
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter((r) => !existsSync(path.join(SHELL, r, "loading.tsx")));
    expect(missing).toEqual([]);
  });
});
