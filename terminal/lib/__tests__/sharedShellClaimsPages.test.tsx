// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalysisPage from "@/app/(shell)/analysis/page";
import ShellLayout from "@/app/(shell)/layout";
import AppShell from "@/components/chrome/AppShell";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import AnalysisMount from "@/components/mounts/AnalysisWorkspaceMount";
import ThesisMount from "@/components/mounts/ThesisWorkspaceMount";

const edges = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn(), refresh: vi.fn(), lang: "en" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: edges.getClaims, getUser: edges.getUser } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: edges.refresh }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: edges.lang }) }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));
vi.mock("@/components/gates/SignupGate", () => ({ default: () => null }));
vi.mock("@/components/mounts/AnalysisWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/ThesisWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/mounts/InvestigationWorkspaceMount", () => ({ default: () => null }));
vi.mock("@/components/workspaces/UnsupportedAnalysisRoute", () => ({ default: () => null }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const subject = "11111111-1111-4111-8111-111111111111";
const claims = { sub: subject, email: "member@example.com" };
const analysis = (query: Record<string, string> = {}) => AnalysisPage({ searchParams: Promise.resolve(query) });
const shell = () => ShellLayout({ children: <div data-private-child="">Private child</div> });
beforeEach(() => {
  vi.stubEnv("ANALYSIS_LOCAL_PREVIEW", "0");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
  edges.getClaims.mockReset(); edges.getUser.mockReset(); edges.refresh.mockReset(); edges.lang = "en";
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container?.remove(); container = undefined; vi.unstubAllEnvs(); });

describe("AUTH-03 Analysis and shared chrome", () => {
  it.each([null, claims])("keeps a non-session verification error outside guest chrome and private mounts (claims=%s)", async staleClaims => {
    edges.getClaims.mockResolvedValue({ data: { claims: staleClaims }, error: { name: "AuthRetryableFetchError", status: 503 } });
    expect((await analysis()).type).toBe(MemberVerificationUnavailable);
    expect((await shell()).type).toBe(MemberVerificationUnavailable);
    expect(edges.getUser).not.toHaveBeenCalled();
  });
  it("keeps failed chrome verification outside AppShell and guest stores", async () => {
    edges.getClaims.mockResolvedValue({ data: { claims: null }, error: { name: "AuthRetryableFetchError", status: 503 } });
    expect((await shell()).type).toBe(MemberVerificationUnavailable);
  });
  it.each([401, 403])("does not infer a missing session from an unrelated HTTP%s verification error", async status => {
    edges.getClaims.mockResolvedValue({ data: { claims: null }, error: { name: "AuthUnknownError", status } });
    expect((await analysis()).type).toBe(MemberVerificationUnavailable);
    expect((await shell()).type).toBe(MemberVerificationUnavailable);
  });
  it("handles a thrown verification failure as unavailable", async () => {
    edges.getClaims.mockRejectedValue(new Error("verification offline"));
    expect((await analysis()).type).toBe(MemberVerificationUnavailable);
    expect((await shell()).type).toBe(MemberVerificationUnavailable);
  });
  it.each([null, { name: "AuthSessionMissingError" }])("preserves true anonymous behavior (error=%s)", async error => {
    edges.getClaims.mockResolvedValue({ data: { claims: null }, error });
    expect((await analysis()).type).toBe(SignupGate);
    const layout = await shell();
    expect(layout.type).toBe(AppShell);
    expect(layout.props.email).toBe(""); expect(layout.props.userId).toBe("");
  });
  it("preserves verified chrome identity, company route and thesis owner", async () => {
    edges.getClaims.mockResolvedValue({ data: { claims }, error: null });
    const layout = await shell();
    expect(layout.type).toBe(AppShell);
    expect(layout.props.email).toBe(claims.email); expect(layout.props.userId).toBe(subject);
    const company = await analysis({ symbol: "AAPL" });
    expect(company.type).toBe(AnalysisMount); expect(company.props.initialSymbol).toBe("AAPL");
    const thesis = await analysis({ view: "theses", symbol: "AAPL" });
    expect(thesis.type).toBe(ThesisMount); expect(thesis.props.ownerKey).toBe(subject);
    expect(edges.getUser).not.toHaveBeenCalled();
  });
  it("recovers from unavailable to a freshly verified account on the next server render", async () => {
    edges.getClaims.mockResolvedValueOnce({ data: null, error: { name: "AuthRetryableFetchError", status: 503 } })
      .mockResolvedValueOnce({ data: { claims }, error: null });
    expect((await shell()).type).toBe(MemberVerificationUnavailable);
    const recovered = await shell();
    expect(recovered.type).toBe(AppShell); expect(recovered.props.userId).toBe(subject);
  });
});

describe("incumbent unavailable recovery", () => {
  it.each([
    ["en", "Account service unavailable", "Retry account verification", "Your private workspace has not been loaded."],
    ["zh", "账户服务暂不可用", "重试账户验证", "尚未加载私人工作区。"],
  ])("keeps useful %s unavailable copy and retry", (lang, heading, retry, status) => {
    edges.lang = lang; container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root!.render(<MemberVerificationUnavailable />));
    expect(container.querySelector("h1")?.textContent).toBe(heading);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(status);
    const button = container.querySelector("button")!; expect(button.textContent).toBe(retry);
    act(() => button.click());
    expect(edges.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(/sign in|sign up|登录|注册/i);
  });
});
