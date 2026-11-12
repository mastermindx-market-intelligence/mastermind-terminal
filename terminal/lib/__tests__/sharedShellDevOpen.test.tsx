import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverPage from "@/app/(shell)/discover/page";
import AnalysisPage from "@/app/(shell)/analysis/page";
import AlertsPage from "@/app/(shell)/alerts/page";
import ScriptsPage from "@/app/(shell)/scripts/page";
import PortfolioPage from "@/app/(shell)/portfolio/page";
import DislocationsPage from "@/app/(shell)/dislocations/page";
import SignupGate from "@/components/gates/SignupGate";
import DiscoverMount from "@/components/mounts/DiscoverWorkspaceMount";
import AnalysisMount from "@/components/mounts/AnalysisWorkspaceMount";
import PineEditorMount from "@/components/mounts/PineEditorMount";
import PortfolioViewMount from "@/components/mounts/PortfolioViewMount";
import DislocationsViewMount from "@/components/mounts/DislocationsViewMount";
import {
  SHARED_SHELL_DEV_EMAIL,
  SHARED_SHELL_DEV_SUBJECT,
  isSharedShellDevOpen,
} from "@/lib/shared-shell/devOpen";

// Dev-open (lib/shared-shell/devOpen.ts) is the beta-runtime flag pair that
// renders the member workspaces for signed-out development sessions. These
// tests pin the two properties that make it a development convenience rather
// than an auth bypass: with the pair set, no page performs ANY auth read
// before rendering; without the pair, the incumbent sign-up gates stand.

const edges = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  readShellClaims: vi.fn(),
  readPositions: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: edges.getUser, getClaims: edges.getClaims } }),
}));
vi.mock("@/lib/shared-shell/memberIdentity", () => ({
  readShellMember: vi.fn(),
  readShellClaims: edges.readShellClaims,
  MEMBER_READ_TIMEOUT_MS: 12_000,
}));
vi.mock("@/lib/theses", () => ({
  isUuid: (v: unknown) =>
    typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/portfolio", () => ({ readPositions: edges.readPositions }));
vi.mock("@/lib/watchlistsFixtureDb", () => ({
  createFixtureDb: vi.fn(),
  fixtureFaults: vi.fn(),
  fixtureUserId: vi.fn(),
  FIXTURE_FAULT_COOKIE: "fixture_fault",
  FIXTURE_STORE_COOKIE: "fixture_store",
}));
vi.mock("@/lib/entitlement", () => ({ isPaidTier: vi.fn(async () => false) }));
vi.mock("@/lib/pine", () => ({
  PROPRIETARY_SCRIPT: { id: "flagship", name: "Flagship", source: "", lang: "pine", params: {}, updated_at: "", locked: true },
}));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/gates/MemberVerificationUnavailable", () => ({ default: () => null }));
vi.mock("@/components/mounts/DiscoverWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/AnalysisWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/ThesisWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/InvestigationWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/workspaces/UnsupportedAnalysisRoute", () => ({ default: () => null }));
vi.mock("@/components/alerts/AlertsCockpitMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/AlertsViewMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/AlertBulkManagerMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/PineEditorMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/PortfolioViewMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/DislocationsViewMount", () => ({ default: () => null }));

describe("dev-open predicate requires the flag pair", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is false unless both MMX_SHARED_SHELL and MMX_SHARED_SHELL_DEV_OPEN are 1", () => {
    expect(isSharedShellDevOpen()).toBe(false);
    vi.stubEnv("MMX_SHARED_SHELL_DEV_OPEN", "1");
    expect(isSharedShellDevOpen()).toBe(false);
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    expect(isSharedShellDevOpen()).toBe(true);
  });
});

describe("non-native member pages dev-open", () => {
  beforeEach(() => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    vi.stubEnv("MMX_SHARED_SHELL_DEV_OPEN", "1");
    // Any auth read in a dev-open render is a bug: the whole point is that
    // the beta has no login dependency while the flag pair is set.
    edges.getUser.mockReset().mockImplementation(() => { throw Error("dev-open must not read auth"); });
    edges.getClaims.mockReset().mockImplementation(() => { throw Error("dev-open must not read auth"); });
    edges.readShellClaims.mockReset().mockImplementation(() => { throw Error("dev-open must not read claims"); });
    edges.readPositions.mockReset().mockResolvedValue({ ok: true, positions: [] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("discover renders the workspace with no auth read", async () => {
    expect((await DiscoverPage()).type).toBe(DiscoverMount);
  });
  it("analysis renders the company workspace under the dev subject", async () => {
    expect((await AnalysisPage({ searchParams: Promise.resolve({}) })).type).toBe(AnalysisMount);
  });
  it("alerts renders the cockpit surfaces under the dev email", async () => {
    const page = await AlertsPage();
    // The page returns its module-local AlertsSurfaces composition — the same
    // element shape as the member branch — with the dev identity's email.
    expect(page.type.name).toBe("AlertsSurfaces");
    expect(page.props.email).toBe(SHARED_SHELL_DEV_EMAIL);
  });
  it("scripts renders the flagship-only editor for the dev identity", async () => {
    const page = await ScriptsPage();
    expect(page.type).toBe(PineEditorMount);
    expect(page.props.scripts).toHaveLength(1);
    expect(page.props.isPro).toBe(false);
    expect(page.props.email).toBe(SHARED_SHELL_DEV_EMAIL);
  });
  it("portfolio reads only the dev subject's own book", async () => {
    const page = await PortfolioPage();
    expect(page.type).toBe(PortfolioViewMount);
    expect(page.props.userId).toBe(SHARED_SHELL_DEV_SUBJECT);
    expect(edges.readPositions).toHaveBeenCalledWith(expect.anything(), SHARED_SHELL_DEV_SUBJECT);
    expect(page.props.positions).toEqual([]);
    expect(page.props.unreadable).toBe(false);
  });
  it("dislocations renders the view with no auth read", async () => {
    expect((await DislocationsPage()).type).toBe(DislocationsViewMount);
  });
});

describe("dev-open stays shut without the flag pair", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("discover still gates guests when only the shell flag is set", async () => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    edges.getClaims.mockResolvedValue({ data: null, error: null });
    const page = await DiscoverPage();
    expect(page.type).toBe(SignupGate);
    expect(page.props).toEqual({ surface: "discover" });
  });
  it("analysis still gates guests when only the shell flag is set", async () => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    edges.readShellClaims.mockResolvedValue({ state: "guest" });
    const page = await AnalysisPage({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(SignupGate);
    expect(page.props).toEqual({ surface: "analysis" });
  });
  it("portfolio still gates guests when only the shell flag is set", async () => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    edges.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await PortfolioPage()).type).toBe(SignupGate);
  });
});
