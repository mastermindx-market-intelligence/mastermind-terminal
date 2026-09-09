// @vitest-environment jsdom
//
// Rendered coverage for the Team settings section (packet B-F12-8), added for round-4 rulings
// R3 and R4(a)/(h)/(k). Every one of those findings was about what a real person SEES — a blank
// titled box, a button that can only error, a false sentence about why the roster is missing, a
// UUID fragment where a name belongs — and none of them was reachable from the route-level
// suites. Mounted the way lib/__tests__/ThesisWorkspaceLensRail.test.tsx does it: react-dom/client
// plus act(), no @testing-library (this repo has none), with fetch stubbed per URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionTeam from "@/components/settings/SectionTeam";
import { acsDate, type DevTeamFixture } from "@/components/settings/types";
import { LEX } from "@/lib/i18n";
import { INVITE_MESSAGES, TEAM_ROUTE_MESSAGES } from "@/lib/teams";
import { accountIdentity } from "@/lib/accountIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CALLER = "11111111-2222-4333-8444-555555555555";

function tFor(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const pair = LEX[key];
    if (!pair) return fallback ?? key;
    return pair[lang === "zh" ? 1 : 0];
  };
}

let container: HTMLDivElement;
let root: Root;

async function mount(lang: "en" | "zh", devTeam?: DevTeamFixture) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SectionTeam
        t={tFor(lang)}
        lang={lang}
        identity={accountIdentity(CALLER, "caller@example.com")}
        email="caller@example.com"
        user={{ id: CALLER, email: "caller@example.com" } as never}
        onClose={() => {}}
        onPatchMeta={() => {}}
        onRefreshUser={async () => {}}
        devTeam={devTeam}
      />,
    );
  });
  // The section defers its first read by one microtask before fetching.
  await act(async () => {
    await Promise.resolve();
  });
}

function text() {
  return container.textContent || "";
}

function buttonsIn(selector: string): string[] {
  return Array.from(container.querySelectorAll(`${selector} button`)).map((b) => (b.textContent || "").trim());
}

/** A fetch stub that answers by URL. Any URL with no entry is a hard failure, never a silent 200. */
function stubFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || "GET", body: typeof init?.body === "string" ? init.body : null });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unstubbed fetch: ${url}`);
    const { status, body } = routes[key];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

const ROSTER_FIXTURE: DevTeamFixture = {
  team: { id: "team-1", name: "Desk" },
  callerRole: "owner",
  callerUserId: CALLER,
  members: [
    { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: "2026-02-14T09:12:00.000Z" },
    { userId: "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22", role: "admin", displayName: "Alex Chen", createdAt: null },
    { userId: "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22", role: "member", displayName: "", createdAt: null },
  ],
  invites: [],
};

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("R4(a): the change-role control never offers the role a row already holds", () => {
  it("an administrator row is offered only 'Make a member'; a member row only 'Make an administrator'", async () => {
    await mount("en", ROSTER_FIXTURE);
    const controls = Array.from(container.querySelectorAll('[data-testid="team-change-role"]'));
    // The owner row carries no controls, so the two changeable rows are admin then member.
    expect(controls.length).toBe(2);
    const labels = controls.map((el) => Array.from(el.querySelectorAll("button")).map((b) => (b.textContent || "").trim()));
    expect(labels[0]).toEqual([LEX.acsMakeMember[0]]);
    expect(labels[1]).toEqual([LEX.acsMakeAdmin[0]]);
    // The whole section offers each option exactly once — never on the row that already holds it.
    expect(buttonsIn('[data-testid="team-change-role"]').filter((l) => l === LEX.acsMakeAdmin[0]).length).toBe(1);
    expect(buttonsIn('[data-testid="team-change-role"]').filter((l) => l === LEX.acsMakeMember[0]).length).toBe(1);
  });
});

describe("R8: unnamed teammates get a shared fallback plus a distinct account discriminator", () => {
  const UNNAMED_A = "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22";
  const UNNAMED_B = "c3d4e5f6-3333-4e6a-9c03-5b71ee0a4d22";
  const unnamedFixture: DevTeamFixture = {
    ...ROSTER_FIXTURE,
    members: [
      ROSTER_FIXTURE.members[0],
      { userId: UNNAMED_A, role: "member", displayName: "", createdAt: null },
      { userId: UNNAMED_B, role: "member", displayName: "", createdAt: null },
    ],
  };

  it.each(["en", "zh"] as const)("%s: two unnamed members render distinct rows with Name not set and the first 8 id characters", async (lang) => {
    await mount(lang, unnamedFixture);
    const idx = lang === "zh" ? 1 : 0;
    expect(text()).toContain(LEX.acsTeamNoName[idx]);
    expect(text()).not.toContain("A teammate");
    expect(text()).not.toContain("未命名成员");
    const rowA = container.querySelector(`[data-user-id="${UNNAMED_A}"]`);
    const rowB = container.querySelector(`[data-user-id="${UNNAMED_B}"]`);
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();
    expect(rowA).not.toBe(rowB);
    expect(rowA!.textContent).toContain("b2c3d4e5");
    expect(rowB!.textContent).toContain("c3d4e5f6");
    expect(rowA!.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      LEX.acsTeamAccount[idx].replace("{short}", "b2c3d4e5"),
    );
    expect(rowB!.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      LEX.acsTeamAccount[idx].replace("{short}", "c3d4e5f6"),
    );
  });
});

describe("R3: the zero-team default state says so and offers a way out", () => {
  it.each(["en", "zh"] as const)("%s: a signed-in account on no team gets the sentence and a create control", async (lang) => {
    stubFetch({ "/api/teams": { status: 200, body: { teams: [] } } });
    await mount(lang);
    const idx = lang === "zh" ? 1 : 0;
    expect(text()).toContain(LEX.acsTeamNone[idx]);
    expect(container.querySelector('[data-testid="team-create"]')?.textContent).toBe(LEX.acsTeamCreate[idx]);
    expect(container.querySelector("#acs-team-name")).toBeTruthy();
    expect(container.querySelector('[data-testid="team-name-label"]')?.textContent).toBe(LEX.acsTeamName[idx]);
    // Round-6 ruling R9(4): the zero-team state does not render acsTeamSub.
    expect(text()).not.toContain(LEX.acsTeamSub[idx]);
    // The heading is no longer painted over nothing.
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.unavailable[idx]);
  });

  it("the create control posts the typed name to the existing teams route and reloads the roster", async () => {
    let created = false;
    const calls = stubFetch({
      "/api/teams/team-9/members": {
        status: 200,
        body: { members: [{ userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null }], callerRole: "owner" },
      },
      "/api/teams/invitations": { status: 200, body: { invites: [] } },
      "/api/teams": { status: 201, body: {} },
    });
    // /api/teams answers with no team first and with the new team after the POST.
    (globalThis.fetch as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method || "GET", body: typeof init?.body === "string" ? init.body : null });
        if (url === "/api/teams" && (init?.method || "GET") === "POST") {
          created = true;
          return { ok: true, status: 201, json: async () => ({ team: { id: "team-9", name: "Desk" } }) } as unknown as Response;
        }
        if (url === "/api/teams") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ teams: created ? [{ id: "team-9", name: "Desk" }] : [] }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-9/members")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [{ userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null }],
              callerRole: "owner",
            }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
      },
    );

    await mount("en");
    const input = container.querySelector("#acs-team-name") as HTMLInputElement;
    const button = container.querySelector('[data-testid="team-create"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true); // nothing typed yet
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Desk");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((container.querySelector('[data-testid="team-create"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      (container.querySelector('[data-testid="team-create"]') as HTMLButtonElement).click();
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/teams");
    expect(JSON.parse(post!.body!)).toEqual({ action: "create", name: "Desk" });
    // Success reloads the roster: the zero-team block is gone and the person is on the list.
    expect(container.querySelector('[data-testid="team-none"]')).toBeNull();
    expect(text()).toContain("Chris Wong");
    expect(text()).toContain(LEX.acsTeamCreated[0]);
  });
});

describe("R4(h): a failed roster read says what actually happened", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a signed-out answer shows the sign-in sentence, never the not-set-up sentence", async () => {
    stubFetch({ "/api/teams": { status: 401, body: { error: "UNAUTHENTICATED", ...pair("not_signed_in") } } });
    await mount("en");
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.not_signed_in[0]);
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
  });

  it("a server-side read failure shows the read sentence, never the not-set-up sentence", async () => {
    stubFetch({ "/api/teams": { status: 500, body: { error: "READ_FAILED", ...pair("read_failed") } } });
    await mount("zh");
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.read_failed[1]);
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.unavailable[1]);
  });

  it("a refusal and a rate limit both avoid the not-set-up sentence even with no sentence in the body", async () => {
    for (const status of [403, 429]) {
      stubFetch({ "/api/teams": { status, body: {} } });
      await mount("en");
      expect(text(), `status ${status}`).toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
      expect(text(), `status ${status}`).not.toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
    // afterEach unmounts the last mount; re-create one so it has something to unmount.
    stubFetch({ "/api/teams": { status: 200, body: { teams: [] } } });
    await mount("en");
  });

  it("an absent team schema still shows the not-set-up sentence", async () => {
    stubFetch({ "/api/teams": { status: 503, body: { error: "READ_UNAVAILABLE", ...pair("unavailable") } } });
    await mount("en");
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
    // …and the zero-team block is NOT what an unreadable roster shows.
    expect(container.querySelector('[data-testid="team-none"]')).toBeNull();
  });

  it("a network failure is a read failure, not an absent team schema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    await mount("en");
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
  });
});

describe("R3: the no-email-delivery sentence never appears in the Team section", () => {
  it.each(["en", "zh"] as const)("%s: zero-team, roster, and invitations states omit the copy-the-link sentence", async (lang) => {
    const idx = lang === "zh" ? 1 : 0;
    const delivery = INVITE_MESSAGES.no_email_delivery[idx];
    stubFetch({ "/api/teams": { status: 200, body: { teams: [] } } });
    await mount(lang);
    expect(text()).not.toContain(delivery);
    await act(async () => {
      root.unmount();
    });
    container.remove();

    const withInvites: DevTeamFixture = {
      ...ROSTER_FIXTURE,
      invites: [{ id: "inv-1", email: "pending@example.com", role: "member", expiresAt: "2026-09-23T00:00:00.000Z" }],
    };
    await mount(lang, withInvites);
    expect(text()).not.toContain(delivery);
    expect(container.querySelector('[data-testid="team-delivery"]')).toBeNull();
  });
});

describe("R4: pending invitations are a titled group, never roster badges", () => {
  const withInvites: DevTeamFixture = {
    ...ROSTER_FIXTURE,
    invites: [{ id: "inv-1", email: "pending@example.com", role: "member", expiresAt: "2026-09-23T00:00:00.000Z" }],
  };

  it.each(["en", "zh"] as const)("%s: the invitation sits in its own group with the invite badge and expiry sentence", async (lang) => {
    await mount(lang, withInvites);
    const idx = lang === "zh" ? 1 : 0;
    expect(text()).toContain(LEX.acsTeamInvites[idx]);
    expect(text()).toContain("pending@example.com");
    const inviteBadge = container.querySelector('[data-testid="team-invite-badge"]');
    expect(inviteBadge?.textContent).toBe(LEX.acsTeamInviteBadge[idx]);
    expect(container.querySelectorAll('[data-testid="team-invite-badge"]').length).toBe(1);
    const rosterBadges = Array.from(container.querySelectorAll('[data-testid="team-role-badge"]')).map(
      (el) => (el.textContent || "").trim(),
    );
    expect(rosterBadges).not.toContain(LEX.acsTeamInviteBadge[idx]);
    expect(rosterBadges).toEqual([LEX.acsRoleOwner[idx], LEX.acsRoleAdmin[idx], LEX.acsRoleMember[idx]]);
    const date = acsDate("2026-09-23T00:00:00.000Z", lang);
    expect(text()).toContain(LEX.acsTeamInviteExpires[idx].replace("{date}", date));
  });
});

describe("R6: a successful self-leave reloads into the zero-team state", () => {
  it("clears teamId and callerRole, removes the roster, and shows the left notice", async () => {
    let left = false;
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        calls.push({ url, method });
        if (url.startsWith("/api/teams/team-1/members") && method === "DELETE") {
          left = true;
          return { ok: true, status: 200, json: async () => ({ ok: true, userId: CALLER }) } as unknown as Response;
        }
        if (url === "/api/teams") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ teams: left ? [] : [{ id: "team-1", name: "Desk" }] }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/members")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [
                { userId: CALLER, role: "member", displayName: "Chris Wong", createdAt: null },
                { userId: "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22", role: "owner", displayName: "Alex Chen", createdAt: null },
              ],
              callerRole: "member",
            }),
          } as unknown as Response;
        }
        throw new Error(`unstubbed fetch: ${url}`);
      }),
    );

    await mount("en");
    expect(container.querySelector('[data-testid="team-none"]')).toBeNull();
    expect(text()).toContain("Chris Wong");
    const live = () => container.querySelector('[data-testid="team-live"]');
    expect(live()?.getAttribute("data-team-id")).toBe("team-1");
    expect(live()?.getAttribute("data-caller-role")).toBe("member");
    const leave = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0]) as HTMLButtonElement | undefined;
    expect(leave).toBeTruthy();
    await act(async () => {
      leave!.click();
    });
    const confirm = Array.from(container.querySelectorAll(".acs-form button.btn-danger")).find(
      (b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0],
    ) as HTMLButtonElement | undefined;
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm!.click();
    });
    expect(container.querySelector('[data-testid="team-none"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="team-role-badge"]')).toBeNull();
    expect(container.querySelector("[data-user-id]")).toBeNull();
    expect(live()?.getAttribute("data-team-id")).toBe("");
    expect(live()?.getAttribute("data-caller-role")).toBe("");
    expect(text()).toContain(LEX.acsTeamLeft[0]);
    expect(text()).toContain(LEX.acsTeamNone[0]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});

describe("R7: a truncated roster names the cap", () => {
  it.each(["en", "zh"] as const)("%s: the roster group ends with the truncated sentence using the shown count", async (lang) => {
    await mount(lang, { ...ROSTER_FIXTURE, truncated: true });
    const idx = lang === "zh" ? 1 : 0;
    const expected = LEX.acsTeamTruncated[idx].replace("{n}", String(ROSTER_FIXTURE.members.length));
    expect(container.querySelector('[data-testid="team-truncated"]')?.textContent).toBe(expected);
  });
});

describe("R9(3): an unrecognised role falls to the unknown badge and withholds controls", () => {
  it.each(["en", "zh"] as const)("%s: a viewer-shaped role paints Role not recognised and offers no buttons", async (lang) => {
    const fixture: DevTeamFixture = {
      ...ROSTER_FIXTURE,
      members: [
        ROSTER_FIXTURE.members[0],
        { userId: "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22", role: "viewer", displayName: "Alex Chen", createdAt: null },
      ],
    };
    await mount(lang, fixture);
    const idx = lang === "zh" ? 1 : 0;
    const row = container.querySelector('[data-user-id="a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22"]');
    expect(row).toBeTruthy();
    expect(row!.querySelector('[data-testid="team-role-badge"]')?.textContent).toBe(LEX.acsRoleUnknown[idx]);
    expect(row!.querySelectorAll("button").length).toBe(0);
  });

  it("a live roster maps an unrecognised role to the unknown badge, matching callerRole's null fall-through", async () => {
    stubFetch({
      "/api/teams/team-1/members": {
        status: 200,
        body: {
          members: [
            { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null },
            { userId: "aaaa1111-2222-4333-8444-555555555555", role: "viewer", displayName: "Alex Chen", createdAt: null },
          ],
          callerRole: "owner",
        },
      },
      "/api/teams/invitations": { status: 200, body: { invites: [] } },
      "/api/teams": { status: 200, body: { teams: [{ id: "team-1", name: "Desk" }] } },
    });
    await mount("en");
    const row = container.querySelector('[data-user-id="aaaa1111-2222-4333-8444-555555555555"]');
    expect(row).toBeTruthy();
    expect(row!.querySelector('[data-testid="team-role-badge"]')?.textContent).toBe(LEX.acsRoleUnknown[0]);
    expect(row!.querySelectorAll("button").length).toBe(0);
  });
});

function pair(code: keyof typeof TEAM_ROUTE_MESSAGES) {
  const [message, messageZh] = TEAM_ROUTE_MESSAGES[code];
  return { message, messageZh };
}
