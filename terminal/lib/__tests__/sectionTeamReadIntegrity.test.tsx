// @vitest-environment jsdom
//
// B-F12 Team account/read integrity, mounted the way lib/__tests__/sectionTeam.test.tsx mounts
// it (react-dom/client plus act(), no @testing-library) against the real section source.
//
// The Team section is mounted once per settings section (SettingsPanel keys its pane by
// `section`) and SettingsProvider keeps the panel mounted between opens, so the section's state
// and its in-flight reads used to survive a resolved ACCOUNT CHANGE: SectionTeam never read the
// identity it was handed, `loadLive` re-ran only on `devTeam`, and a read that landed after the
// owner changed painted the previous account's roster, role, invitations and workspace settings
// for whoever came next. These tests swap the `identity` prop under a live root and require the
// old owner's data to disappear — on success, on failure, on an unparseable body, and on
// sign-out — while the same account changing its address must disturb nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionTeam from "@/components/settings/SectionTeam";
import type { DevTeamFixture } from "@/components/settings/types";
import { LEX } from "@/lib/i18n";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";
import { accountIdentity, GUEST_IDENTITY, type AccountIdentity } from "@/lib/accountIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A_ID = "aaaaaaaa-1111-4222-8333-4c1f2a777701";
const B_ID = "bbbbbbbb-2222-4333-8444-4c1f2a777702";
const ALEX = "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22";
const BLAKE = "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22";

const identityA = accountIdentity(A_ID, "ada@example.com");
const identityB = accountIdentity(B_ID, "belle@example.com");

const A_TEAM = { id: "team-a", name: "Desk Ada" };
const B_TEAM = { id: "team-b", name: "Desk Belle" };
const A_MEMBERS = [
  { userId: A_ID, role: "owner", displayName: "Ada", createdAt: null },
  { userId: ALEX, role: "admin", displayName: "Alex Chen", createdAt: null },
];
const B_MEMBERS = [
  { userId: B_ID, role: "owner", displayName: "Belle", createdAt: null },
  { userId: BLAKE, role: "member", displayName: "Blake", createdAt: null },
];

const FIXTURE_A: DevTeamFixture = { team: A_TEAM, callerRole: "owner", callerUserId: A_ID, members: A_MEMBERS, invites: [] };
const FIXTURE_B: DevTeamFixture = { team: B_TEAM, callerRole: "owner", callerUserId: B_ID, members: B_MEMBERS, invites: [] };

function tFor(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const pair = LEX[key];
    if (!pair) return fallback ?? key;
    return pair[lang === "zh" ? 1 : 0];
  };
}

// ── fetch stub: routed by current owner phase, with parkable (pending) calls ──
type Spec = { status: number; body?: unknown; rejectJson?: boolean };
type Gate = { promise: Promise<Spec>; release: (spec: Spec) => void };
function makeGate(): Gate {
  let release!: (spec: Spec) => void;
  const promise = new Promise<Spec>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type Phase = "A" | "B" | "guest";
let phase: Phase = "A";
let leftTeam = false;
let aRoster: { members: unknown[]; callerRole: string } = { members: A_MEMBERS, callerRole: "owner" };
let teamsOverride: Spec | Gate | undefined;
let membersOverride: Spec | Gate | undefined;
let settingsOverride: Spec | Gate | undefined;
let calls: { url: string; method: string }[] = [];

function serve(url: string, method: string): Spec | Gate | undefined {
  if (url === "/api/teams" && method === "GET") {
    if (teamsOverride) return teamsOverride;
    if (phase === "guest") return { status: 401, body: {} };
    if (leftTeam) return { status: 200, body: { teams: [], truncated: false } };
    return { status: 200, body: { teams: [phase === "A" ? A_TEAM : B_TEAM], truncated: false } };
  }
  if (url.startsWith("/api/teams/invitations")) {
    if (method === "POST") {
      return { status: 201, body: { inviteUrl: "https://app.example.com/invite?token=t", invite: { email: "x@example.com" } } };
    }
    return { status: 200, body: { invites: [] } };
  }
  if (url.startsWith("/api/teams/team-a/")) {
    if (url.startsWith("/api/teams/team-a/members")) {
      if (method === "DELETE") {
        leftTeam = true;
        return { status: 200, body: { ok: true, userId: A_ID } };
      }
      return membersOverride ?? { status: 200, body: { members: aRoster.members, callerRole: aRoster.callerRole, truncated: false } };
    }
    if (url.endsWith("/settings")) {
      return settingsOverride ?? {
        status: 200,
        body: { settings: [{ key: "default_chart_theme", value: "green_up" }, { key: "share_layouts_by_default", value: false }] },
      };
    }
    return undefined;
  }
  if (url.startsWith("/api/teams/team-b/")) {
    if (url.endsWith("/members")) {
      return { status: 200, body: { members: B_MEMBERS, callerRole: "owner", truncated: false } };
    }
    if (url.endsWith("/settings")) {
      return { status: 200, body: { settings: [{ key: "default_chart_theme", value: "red_up" }, { key: "share_layouts_by_default", value: true }] } };
    }
    return undefined;
  }
  return undefined;
}

function installFetch() {
  calls = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url, method });
    const answer = serve(url, method);
    if (!answer) throw new Error(`unstubbed fetch: ${method} ${url}`);
    const spec = answer instanceof Promise ? await answer : answer;
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => {
        if (spec.rejectJson) throw new Error("response body is not JSON");
        return spec.body ?? {};
      },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function callsOf(url: string, method = "GET") {
  return calls.filter((c) => c.url === url && c.method === method);
}

// ── mount harness ─────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;

function sectionProps(opts: { identity: AccountIdentity; email: string; userId: string; devTeam?: DevTeamFixture }) {
  const props: ComponentProps<typeof SectionTeam> = {
    t: tFor("en"),
    lang: "en",
    identity: opts.identity,
    email: opts.email,
    user: { id: opts.userId, email: opts.email } as never,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
  if (opts.devTeam !== undefined) props.devTeam = opts.devTeam;
  return props;
}

function propsFor(which: Phase, devTeam?: DevTeamFixture) {
  phase = which; // the stub serves whichever owner the section is now rendered for
  if (which === "A") return sectionProps({ identity: identityA, email: "ada@example.com", userId: A_ID, devTeam });
  if (which === "B") return sectionProps({ identity: identityB, email: "belle@example.com", userId: B_ID, devTeam });
  return sectionProps({ identity: GUEST_IDENTITY, email: "", userId: "", devTeam });
}

async function renderWith(props: ComponentProps<typeof SectionTeam>) {
  await act(async () => {
    root.render(<SectionTeam {...props} />);
  });
}

async function mountLive(which: Phase = "A", devTeam?: DevTeamFixture) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderWith(propsFor(which, devTeam));
  // The section defers its first read by one microtask before fetching.
  await act(async () => {
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function flushUntil(pred: () => boolean, label: string) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 2500) throw new Error(`timed out waiting for ${label}`);
    await flush();
  }
}

function text() {
  return container.textContent || "";
}

function liveEl() {
  return container.querySelector('[data-testid="team-live"]');
}

function heading() {
  return (container.querySelector(".acs-head h2")?.textContent || "").trim();
}

beforeEach(() => {
  phase = "A";
  leftTeam = false;
  aRoster = { members: A_MEMBERS, callerRole: "owner" };
  teamsOverride = undefined;
  membersOverride = undefined;
  settingsOverride = undefined;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an account change replaces the whole section (settled reads)", () => {
  it("a live swap re-reads and paints only the new owner's team", async () => {
    installFetch();
    await mountLive("A");
    await flushUntil(() => text().includes("Ada"), "Ada's roster");
    expect(heading()).toBe("Desk Ada");
    expect(liveEl()?.getAttribute("data-team-id")).toBe("team-a");
    expect(callsOf("/api/teams")).toHaveLength(1);

    await renderWith(propsFor("B"));
    // The old owner's rows are gone the moment the owner changes, before any new read lands.
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    expect(text()).not.toContain("Ada");
    expect(text()).not.toContain("Alex Chen");
    await flushUntil(() => text().includes("Belle"), "Belle's roster");
    expect(heading()).toBe("Desk Belle");
    expect(liveEl()?.getAttribute("data-team-id")).toBe("team-b");
    expect(liveEl()?.getAttribute("data-caller-role")).toBe("owner");
    expect(callsOf("/api/teams")).toHaveLength(2);
  });

  it("a fixture mounted for one owner is replaced, not kept, when the owner changes", async () => {
    installFetch();
    await mountLive("A", FIXTURE_A);
    expect(text()).toContain("Ada");
    expect(heading()).toBe("Desk Ada");
    expect(calls).toHaveLength(0); // the fixture path never touches the network

    await renderWith(propsFor("B", FIXTURE_B));
    expect(text()).toContain("Belle");
    expect(text()).not.toContain("Ada");
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    expect(heading()).toBe("Desk Belle");
    expect(calls).toHaveLength(0);
  });
});

describe("a read still in flight when the account changes is ignored", () => {
  it("a roster read that lands after the swap paints nothing", async () => {
    installFetch();
    const gate = makeGate();
    membersOverride = gate;
    await mountLive("A");
    // A's team list was answered; its member read is parked, so nothing is painted yet.
    expect(container.querySelector('[data-testid="team-none"]')).toBeNull();
    expect(text()).not.toContain("Ada");

    await renderWith(propsFor("B"));
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    await flushUntil(() => text().includes("Belle"), "Belle's roster");
    expect(liveEl()?.getAttribute("data-team-id")).toBe("team-b");

    gate.release({ status: 200, body: { members: A_MEMBERS, callerRole: "owner", truncated: false } });
    await flush();
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    expect(text()).not.toContain("Alex Chen");
    expect(text()).toContain("Belle");
    expect(text()).toContain("Blake");
  });

  it("a roster read that fails after the swap does not paint the old owner's failure", async () => {
    installFetch();
    const gate = makeGate();
    membersOverride = gate;
    await mountLive("A");
    await renderWith(propsFor("B"));
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    await flushUntil(() => text().includes("Belle"), "Belle's roster");

    gate.release({ status: 401, body: {} });
    await flush();
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.not_signed_in[0]);
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
    expect(text()).toContain("Belle");
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
  });

  it("a late response with an unparseable body is ignored, not turned into a read failure", async () => {
    installFetch();
    const gate = makeGate();
    teamsOverride = gate;
    await mountLive("A");
    teamsOverride = undefined; // only the OLD owner's parked read stays parked
    await renderWith(propsFor("B"));
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    await flushUntil(() => text().includes("Belle"), "Belle's roster");

    gate.release({ status: 200, rejectJson: true });
    await flush();
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
    expect(text()).toContain("Belle");
    expect(liveEl()?.getAttribute("data-team-id")).toBe("team-b");
  });
});

describe("signing out", () => {
  it("clears the account's roster and shows the sign-in sentence", async () => {
    installFetch();
    await mountLive("A");
    await flushUntil(() => text().includes("Ada"), "Ada's roster");

    await renderWith(propsFor("guest"));
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    await flushUntil(() => text().includes(TEAM_ROUTE_MESSAGES.not_signed_in[0]), "the sign-in sentence");
    expect(container.querySelector(`[data-user-id="${A_ID}"]`)).toBeNull();
    expect(text()).not.toContain("Ada");
    // A signed-out answer is a failure state, not the create-a-team state.
    expect(container.querySelector('[data-testid="team-none"]')).toBeNull();
  });
});

describe("the same account is not disturbed", () => {
  it("an address change on the SAME account neither re-reads nor clears the roster", async () => {
    installFetch();
    await mountLive("A");
    await flushUntil(() => text().includes("Ada"), "Ada's roster");
    const readsBefore = callsOf("/api/teams").length;

    // Same uuid, new address: the canonical owner key is unchanged, so nothing re-reads.
    await renderWith(sectionProps({ identity: accountIdentity(A_ID, "ada-new@example.com"), email: "ada-new@example.com", userId: A_ID }));
    await flush();
    expect(callsOf("/api/teams")).toHaveLength(readsBefore);
    expect(text()).toContain("Ada");
    expect(text()).toContain("Alex Chen");
  });

  it("a same-owner reload through Leave repaints from the current read (zero-team)", async () => {
    installFetch();
    aRoster = {
      members: [
        { userId: A_ID, role: "member", displayName: "Ada", createdAt: null },
        { userId: ALEX, role: "owner", displayName: "Alex Chen", createdAt: null },
      ],
      callerRole: "member",
    };
    await mountLive("A");
    await flushUntil(() => text().includes("Ada"), "Ada's roster");
    const leave = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0],
    ) as HTMLButtonElement;
    expect(leave).toBeTruthy();
    await act(async () => {
      leave.click();
    });
    const confirm = Array.from(container.querySelectorAll(".acs-form button.btn-danger")).find(
      (b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0],
    ) as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="team-none"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="team-role-badge"]')).toBeNull();
    expect(liveEl()?.getAttribute("data-team-id")).toBe("");
    expect(text()).toContain(LEX.acsTeamLeft[0]);
  });
});

describe("workspace settings are bound to the current owner and the current read", () => {
  it("a failed settings read for the old owner is replaced by the new owner's values", async () => {
    installFetch();
    settingsOverride = { status: 500, body: {} };
    await mountLive("A");
    await flushUntil(() => container.querySelector('[data-testid="team-settings-fail"]') !== null, "A's settings failure sentence");

    await renderWith(propsFor("B"));
    expect(container.querySelector('[data-testid="team-settings-fail"]')).toBeNull();
    await flushUntil(() => container.querySelector('[data-testid="team-settings-chart"]') !== null, "Belle's settings controls");
    expect(container.querySelector('[data-testid="team-settings-fail"]')).toBeNull();
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
    const select = container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement;
    expect(select.value).toBe("red_up");
  });

  it("a settings read that fails after the swap does not remove the new owner's controls", async () => {
    installFetch();
    const gate = makeGate();
    settingsOverride = gate;
    await mountLive("A");
    settingsOverride = undefined; // the new owner's own read is answered normally
    await renderWith(propsFor("B"));
    expect(container.querySelector('[data-testid="team-settings-fail"]')).toBeNull();
    await flushUntil(() => container.querySelector('[data-testid="team-settings-chart"]') !== null, "Belle's settings controls");

    gate.release({ status: 500, body: {} });
    await flush();
    expect(container.querySelector('[data-testid="team-settings-fail"]')).toBeNull();
    const select = container.querySelector('[data-testid="team-settings-chart"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("red_up");
    const share = container.querySelector('[data-testid="team-settings-share"] input') as HTMLInputElement;
    expect(share.checked).toBe(true);
  });
});

describe("normal controls after a settled swap", () => {
  it("the new owner's panel offers the ordinary controls", async () => {
    installFetch();
    await mountLive("A");
    await flushUntil(() => text().includes("Ada"), "Ada's roster");
    await renderWith(propsFor("B"));
    await flushUntil(() => container.querySelector('[data-testid="team-settings-chart"]') !== null, "Belle's panel");

    // Belle is the owner: the invitation form and the dated no-mail line are offered.
    expect(container.querySelector('[data-testid="team-invite-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="team-delivery"]')).not.toBeNull();
    // The roster is Belle's: owner badge then member badge, with the owner's controls on Blake.
    const badges = Array.from(container.querySelectorAll('[data-testid="team-role-badge"]')).map((el) =>
      (el.textContent || "").trim(),
    );
    expect(badges).toEqual([LEX.acsRoleOwner[0], LEX.acsRoleMember[0]]);
    const blakeRow = container.querySelector(`[data-user-id="${BLAKE}"]`);
    expect(blakeRow).not.toBeNull();
    const rowButtons = Array.from(blakeRow!.querySelectorAll('[data-testid="team-actions"] button')).map((b) =>
      (b.textContent || "").trim(),
    );
    expect(rowButtons).toContain(LEX.acsMakeAdmin[0]);
    expect(rowButtons).toContain(LEX.acsTeamRemove[0]);
  });
});
