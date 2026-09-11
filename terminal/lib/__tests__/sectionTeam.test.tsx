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
    expect(text()).toContain(LEX.acsTeamNoneCreate[idx]);
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
    expect(date).toBeTruthy();
    expect(text()).toContain(LEX.acsTeamInviteExpires[idx].replace("{date}", date as string));
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
    expect(text()).toContain(LEX.acsTeamNoneCreate[0]);
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

describe("B-F12-9: ownership transfer control", () => {
  it("the owner sees Transfer ownership when an administrator exists", async () => {
    await mount("en", ROSTER_FIXTURE);
    const button = container.querySelector('[data-testid="team-transfer-ownership"]');
    expect(button?.textContent).toBe(LEX.acsTeamTransferButton[0]);
  });

  it("a member or administrator does not see the transfer control, and the locked-owner sentence remains", async () => {
    const asAdmin: DevTeamFixture = { ...ROSTER_FIXTURE, callerRole: "admin", callerUserId: ROSTER_FIXTURE.members[1].userId };
    await mount("en", asAdmin);
    expect(container.querySelector('[data-testid="team-transfer-ownership"]')).toBeNull();
    expect(text()).toContain(LEX.acsOwnerLocked[0]);
  });

  it("the owner does not see the transfer control when nobody is an administrator", async () => {
    const noAdmin: DevTeamFixture = {
      ...ROSTER_FIXTURE,
      members: ROSTER_FIXTURE.members.map((m) => (m.role === "admin" ? { ...m, role: "member" } : m)),
    };
    await mount("en", noAdmin);
    expect(container.querySelector('[data-testid="team-transfer-ownership"]')).toBeNull();
  });

  it("the owner with no administrator reads the transfer-admin hint, not the locked-owner sentence", async () => {
    const noAdmin: DevTeamFixture = {
      ...ROSTER_FIXTURE,
      members: ROSTER_FIXTURE.members.map((m) => (m.role === "admin" ? { ...m, role: "member" } : m)),
    };
    await mount("en", noAdmin);
    const ownerRow = container.querySelector(`[data-user-id="${CALLER}"]`);
    expect(ownerRow).toBeTruthy();
    expect(ownerRow!.textContent).toContain(LEX.acsTeamTransferAdminNeed[0]);
    expect(ownerRow!.textContent).not.toContain(LEX.acsOwnerLocked[0]);
    expect(text()).toContain(LEX.acsTeamTransferAdminNeed[0]);
    expect(text()).not.toContain(LEX.acsOwnerLocked[0]);
  });

  it.each(["en", "zh"] as const)("%s: the two-step dialog shows the consequence sentence and never a machine word", async (lang) => {
    await mount(lang, ROSTER_FIXTURE);
    const idx = lang === "zh" ? 1 : 0;
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement).click();
    });
    expect(text()).toContain(LEX.acsTeamTransferTitle[idx]);
    expect(text()).toContain(LEX.acsTeamTransferAdminNeed[idx]);
    const adminChoice = Array.from(container.querySelectorAll("[data-testid=\"team-transfer-recipients\"] button")).find((b) =>
      (b.textContent || "").includes("Alex Chen"),
    ) as HTMLButtonElement;
    await act(async () => {
      adminChoice.click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-next"]') as HTMLButtonElement).click();
    });
    expect(text()).toContain(LEX.acsTeamTransferConsequence[idx]);
    expect(text()).toContain(LEX.acsTeamTransferConfirm[idx].replaceAll("{name}", "Alex Chen"));
    expect(text()).not.toContain("transfer_team_ownership");
    expect(text()).not.toContain("team_members");
  });

  it("opening the transfer dialog moves focus inside it and does not declare aria-modal", async () => {
    await mount("en", ROSTER_FIXTURE);
    const openButton = container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement;
    await act(async () => {
      openButton.click();
    });
    const dialog = container.querySelector('[data-testid="team-transfer-dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("team-transfer-dialog-title");
    expect(document.getElementById("team-transfer-dialog-title")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("two unnamed administrators are named by Name not set plus the eight-character account id in the list, confirm title, and success sentence", async () => {
    const UNNAMED_A = "d4e5f6a7-4444-4e6a-9c03-5b71ee0a4d22";
    const UNNAMED_B = "e5f6a7b8-5555-4e6a-9c03-5b71ee0a4d22";
    const unnamedAdmins: DevTeamFixture = {
      ...ROSTER_FIXTURE,
      members: [
        ROSTER_FIXTURE.members[0],
        { userId: UNNAMED_A, role: "admin", displayName: "", createdAt: null },
        { userId: UNNAMED_B, role: "admin", displayName: "", createdAt: null },
      ],
    };
    await mount("en", unnamedAdmins);
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement).click();
    });
    const choices = Array.from(container.querySelectorAll("[data-testid=\"team-transfer-recipients\"] button"));
    expect(choices).toHaveLength(2);
    expect(choices[0].textContent).toContain(LEX.acsTeamNoName[0]);
    expect(choices[0].textContent).toContain("d4e5f6a7");
    expect(choices[1].textContent).toContain(LEX.acsTeamNoName[0]);
    expect(choices[1].textContent).toContain("e5f6a7b8");
    expect(choices[0].querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      LEX.acsTeamAccount[0].replace("{short}", "d4e5f6a7"),
    );
    expect(choices[1].querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      LEX.acsTeamAccount[0].replace("{short}", "e5f6a7b8"),
    );
    await act(async () => {
      (choices[0] as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-next"]') as HTMLButtonElement).click();
    });
    const spokenA = `${LEX.acsTeamNoName[0]} d4e5f6a7`;
    expect(container.querySelector('[data-testid="team-transfer-confirm-title"]')?.textContent).toBe(
      LEX.acsTeamTransferConfirm[0].replaceAll("{name}", spokenA),
    );
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-confirm"]') as HTMLButtonElement).click();
    });
    expect(text()).toContain(LEX.acsTeamTransferSuccess[0].replaceAll("{name}", spokenA));
    expect(text()).not.toContain(LEX.acsTeamTransferSuccess[0].replaceAll("{name}", LEX.acsTeamNoName[0] + "."));
  });

  it("a 409 shows the conflict sentence and a Try again control", async () => {
    stubFetch({});
    (globalThis.fetch as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/teams") {
          return { ok: true, status: 200, json: async () => ({ teams: [{ id: "team-1", name: "Desk" }] }) } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/members")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: ROSTER_FIXTURE.members.map((m) => ({ ...m })),
              callerRole: "owner",
            }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/transfer-ownership")) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: "CONFLICT",
              message: TEAM_ROUTE_MESSAGES.conflict[0],
              messageZh: TEAM_ROUTE_MESSAGES.conflict[1],
            }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
      },
    );
    await mount("en");
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement).click();
    });
    const adminChoice = Array.from(container.querySelectorAll("[data-testid=\"team-transfer-recipients\"] button")).find((b) =>
      (b.textContent || "").includes("Alex Chen"),
    ) as HTMLButtonElement;
    await act(async () => {
      adminChoice.click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-next"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-confirm"]') as HTMLButtonElement).click();
    });
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.conflict[0]);
    expect(container.querySelector('[data-testid="team-transfer-retry"]')?.textContent).toBe(LEX.acsTeamTransferRetry[0]);
  });

  it("waits one second before posting again after Try again", async () => {
    let transferPosts = 0;
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teams") {
        return { ok: true, status: 200, json: async () => ({ teams: [{ id: "team-1", name: "Desk" }] }) } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/members")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: ROSTER_FIXTURE.members.map((m) => ({ ...m })),
            callerRole: "owner",
          }),
        } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/transfer-ownership")) {
        transferPosts += 1;
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: "CONFLICT",
            message: TEAM_ROUTE_MESSAGES.conflict[0],
            messageZh: TEAM_ROUTE_MESSAGES.conflict[1],
          }),
        } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/invites") || url.includes("/invites")) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", impl);
    await mount("en");
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement).click();
    });
    const adminChoice = Array.from(container.querySelectorAll("[data-testid=\"team-transfer-recipients\"] button")).find((b) =>
      (b.textContent || "").includes("Alex Chen"),
    ) as HTMLButtonElement;
    await act(async () => {
      adminChoice.click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-next"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-confirm"]') as HTMLButtonElement).click();
    });
    expect(transferPosts).toBe(1);
    vi.useFakeTimers();
    try {
      await act(async () => {
        (container.querySelector('[data-testid="team-transfer-retry"]') as HTMLButtonElement).click();
      });
      expect(transferPosts).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(transferPosts).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(transferPosts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after 409 then Try again, a 403 closes the dialog and shows only the 403 sentence", async () => {
    let transferPosts = 0;
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teams") {
        return { ok: true, status: 200, json: async () => ({ teams: [{ id: "team-1", name: "Desk" }] }) } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/members")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: ROSTER_FIXTURE.members.map((m) => ({ ...m })),
            callerRole: "owner",
          }),
        } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/transfer-ownership")) {
        transferPosts += 1;
        if (transferPosts === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: "CONFLICT",
              message: TEAM_ROUTE_MESSAGES.conflict[0],
              messageZh: TEAM_ROUTE_MESSAGES.conflict[1],
            }),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: "FORBIDDEN",
            message: TEAM_ROUTE_MESSAGES.transfer_requires_admin[0],
            messageZh: TEAM_ROUTE_MESSAGES.transfer_requires_admin[1],
          }),
        } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/invites") || url.includes("/invites")) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal("fetch", impl);
    await mount("en");
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-ownership"]') as HTMLButtonElement).click();
    });
    const adminChoice = Array.from(container.querySelectorAll("[data-testid=\"team-transfer-recipients\"] button")).find((b) =>
      (b.textContent || "").includes("Alex Chen"),
    ) as HTMLButtonElement;
    await act(async () => {
      adminChoice.click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-next"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="team-transfer-confirm"]') as HTMLButtonElement).click();
    });
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.conflict[0]);
    expect(container.querySelector('[data-testid="team-transfer-retry"]')).toBeTruthy();
    vi.useFakeTimers();
    try {
      await act(async () => {
        (container.querySelector('[data-testid="team-transfer-retry"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(transferPosts).toBe(2);
    expect(container.querySelector('[data-testid="team-transfer-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="team-transfer-retry"]')).toBeNull();
    expect(text()).toContain(TEAM_ROUTE_MESSAGES.transfer_requires_admin[0]);
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.conflict[0]);
  });
});

const INVITES_FAIL_EN = "We could not read this team's invitations just now.";
const INVITES_FAIL_ZH = "暂时无法读取这个团队的邀请。";
const JOIN_UNREAD_EN = "Join date not read";
const JOIN_UNREAD_ZH = "加入时间未读取";
const EXPIRY_UNREAD_EN = "Expiry date not read";
const EXPIRY_UNREAD_ZH = "到期时间未读取";

function heading(): string {
  return (container.querySelector(".acs-head h2")?.textContent || "").trim();
}

function actionButtons(userId: string): HTMLButtonElement[] {
  const row = container.querySelector(`[data-user-id="${userId}"]`);
  if (!row) return [];
  return Array.from(row.querySelectorAll('[data-testid="team-actions"] button')) as HTMLButtonElement[];
}

function liveDesk(overrides?: {
  teams?: unknown[];
  truncated?: boolean;
  members?: unknown[];
  callerRole?: string;
  invites?: { status: number; body?: unknown } | "throw";
}) {
  const teams = overrides?.teams ?? [{ id: "team-1", name: "Desk" }];
  const members = overrides?.members ?? [
    { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: "2026-02-14T09:12:00.000Z" },
    { userId: "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22", role: "admin", displayName: "Alex Chen", createdAt: null },
  ];
  const invites = overrides?.invites ?? { status: 200, body: { invites: [] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/teams/invitations")) {
        if (invites === "throw") throw new Error("invitations down");
        return {
          ok: invites.status >= 200 && invites.status < 300,
          status: invites.status,
          json: async () => invites.body ?? {},
        } as unknown as Response;
      }
      if (url.startsWith("/api/teams/team-1/members") || url.startsWith("/api/teams/team-2/members")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members,
            callerRole: overrides?.callerRole ?? "owner",
          }),
        } as unknown as Response;
      }
      if (url === "/api/teams") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ teams, truncated: overrides?.truncated === true }),
        } as unknown as Response;
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }),
  );
}

describe("heal h3: a failed invitations read paints the invitations group, never an empty list", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([403, 429, 500, 503] as const)("status %s shows the invitations-fail sentence in the invites group", async (status) => {
    liveDesk({ invites: { status, body: {} } });
    await mount("en");
    expect(text()).toContain(LEX.acsTeamInvites[0]);
    expect(text()).toContain(INVITES_FAIL_EN);
    expect(container.querySelector('[data-testid="team-invites-fail"]')?.textContent).toBe(INVITES_FAIL_EN);
    expect(text()).toContain("Chris Wong");
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.read_failed[0]);
    expect(container.querySelector('[data-testid="team-invite-badge"]')).toBeNull();
  });

  it("a thrown invitations fetch shows the same sentence, in Chinese, and keeps the roster", async () => {
    liveDesk({ invites: "throw" });
    await mount("zh");
    expect(text()).toContain(LEX.acsTeamInvites[1]);
    expect(text()).toContain(INVITES_FAIL_ZH);
    expect(text()).toContain("Chris Wong");
    expect(text()).not.toContain(TEAM_ROUTE_MESSAGES.read_failed[1]);
  });

  it("a second loadLive does not keep the previous team's invitation rows", async () => {
    let left = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (url.startsWith("/api/teams/team-1/members") && method === "DELETE") {
          left = true;
          return { ok: true, status: 200, json: async () => ({ ok: true, userId: CALLER }) } as unknown as Response;
        }
        if (url === "/api/teams") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ teams: left ? [{ id: "team-2", name: "Other" }] : [{ id: "team-1", name: "Desk" }] }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/members")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [
                { userId: "owner-1", role: "owner", displayName: "Owner", createdAt: null },
                { userId: CALLER, role: "admin", displayName: "Chris Wong", createdAt: null },
              ],
              callerRole: "admin",
            }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-2/members")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [
                { userId: "owner-2", role: "owner", displayName: "Pat", createdAt: null },
                { userId: CALLER, role: "admin", displayName: "Chris Wong", createdAt: null },
              ],
              callerRole: "admin",
            }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/invitations")) {
          if (left) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              invites: [{ id: "inv-old", email: "old@example.com", role: "member", expiresAt: null }],
            }),
          } as unknown as Response;
        }
        throw new Error(`unstubbed ${method} ${url}`);
      }),
    );
    await mount("en");
    expect(text()).toContain("old@example.com");
    const leave = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0],
    ) as HTMLButtonElement;
    await act(async () => {
      leave.click();
    });
    const confirm = Array.from(container.querySelectorAll(".acs-form button.btn-danger")).find(
      (b) => (b.textContent || "").trim() === LEX.acsTeamLeave[0],
    ) as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    expect(text()).not.toContain("old@example.com");
    expect(text()).toContain(INVITES_FAIL_EN);
    expect(heading()).toBe("Other");
  });
});

describe("heal h3: the heading names the team; extra teams and a truncated list are said", () => {
  it("two named teams: the heading is the first name and the count sentence names it", async () => {
    liveDesk({
      teams: [
        { id: "team-1", name: "Desk" },
        { id: "team-2", name: "Research" },
      ],
    });
    await mount("en");
    expect(heading()).toBe("Desk");
    expect(container.querySelector('[data-testid="team-many"]')?.textContent).toBe(
      "You are on 2 teams. This panel shows Desk.",
    );
  });

  it("Chinese names the count with 你 and the first team's name", async () => {
    liveDesk({
      teams: [
        { id: "team-1", name: "Desk" },
        { id: "team-2", name: "Research" },
      ],
    });
    await mount("zh");
    expect(heading()).toBe("Desk");
    expect(container.querySelector('[data-testid="team-many"]')?.textContent).toBe(
      "你在 2 个团队中。这里显示的是 Desk。",
    );
  });

  it("a truncated team list names that not every team could be listed (EN)", async () => {
    liveDesk({
      teams: [{ id: "team-1", name: "Desk" }],
      truncated: true,
    });
    await mount("en");
    expect(container.querySelector('[data-testid="team-list-truncated"]')?.textContent).toBe(
      "Not every team you belong to could be listed.",
    );
  });

  it("a truncated team list names that not every team could be listed (ZH)", async () => {
    liveDesk({
      teams: [{ id: "team-1", name: "Desk" }],
      truncated: true,
    });
    await mount("zh");
    expect(container.querySelector('[data-testid="team-list-truncated"]')?.textContent).toBe(
      "你所属的团队未能全部列出。",
    );
  });

  it("an unnamed team keeps the Team heading and does not render the count sentence even with two teams", async () => {
    liveDesk({
      teams: [
        { id: "team-1", name: "" },
        { id: "team-2", name: "Research" },
      ],
    });
    await mount("en");
    expect(heading()).toBe(LEX.acsTeam[0]);
    expect(container.querySelector('[data-testid="team-many"]')).toBeNull();
  });
});

describe("heal h3: a failed role change restores only that row", () => {
  it("A's PATCH pending, B's PATCH succeeds, A's fails — B keeps the server's role", async () => {
    const A = "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22";
    const B = "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22";
    let releaseA: ((value: Response) => void) | undefined;
    let releaseB: ((value: Response) => void) | undefined;
    const aGate = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    const bGate = new Promise<Response>((resolve) => {
      releaseB = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (url === "/api/teams") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ teams: [{ id: "team-1", name: "Desk" }] }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/members") && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [
                { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null },
                { userId: A, role: "admin", displayName: "Alex Chen", createdAt: null },
                { userId: B, role: "member", displayName: "Blair Ng", createdAt: null },
              ],
              callerRole: "owner",
            }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/invitations")) {
          return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
        }
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body || "{}")) as { userId?: string };
          if (body.userId === A) return aGate;
          if (body.userId === B) return bGate;
        }
        throw new Error(`unstubbed ${method} ${url}`);
      }),
    );
    await mount("en");
    const alexRow = container.querySelector(`[data-user-id="${A}"]`)!;
    const blairRow = container.querySelector(`[data-user-id="${B}"]`)!;
    const makeMember = actionButtons(A).find((b) => (b.textContent || "").trim() === LEX.acsMakeMember[0]);
    const makeAdmin = actionButtons(B).find((b) => (b.textContent || "").trim() === LEX.acsMakeAdmin[0]);
    expect(makeMember).toBeTruthy();
    expect(makeAdmin).toBeTruthy();
    await act(async () => {
      makeMember!.click();
    });
    expect(actionButtons(A).some((b) => b.disabled)).toBe(true);
    expect(actionButtons(B).find((b) => (b.textContent || "").trim() === LEX.acsMakeAdmin[0])?.disabled).toBe(false);
    await act(async () => {
      actionButtons(B)
        .find((b) => (b.textContent || "").trim() === LEX.acsMakeAdmin[0])!
        .click();
    });
    expect(actionButtons(A).some((b) => b.disabled)).toBe(true);
    expect(actionButtons(B).some((b) => b.disabled)).toBe(true);
    await act(async () => {
      releaseB!({
        ok: true,
        status: 200,
        json: async () => ({ member: { userId: B, role: "admin" } }),
      } as unknown as Response);
    });
    expect(blairRow.querySelector('[data-testid="team-role-badge"]')?.textContent).toBe(LEX.acsRoleAdmin[0]);
    expect(actionButtons(A).some((b) => b.disabled)).toBe(true);
    await act(async () => {
      releaseA!({
        ok: false,
        status: 500,
        json: async () => ({
          message: TEAM_ROUTE_MESSAGES.role_change_failed[0],
          messageZh: TEAM_ROUTE_MESSAGES.role_change_failed[1],
        }),
      } as unknown as Response);
    });
    expect(alexRow.querySelector('[data-testid="team-role-badge"]')?.textContent).toBe(LEX.acsRoleAdmin[0]);
    expect(blairRow.querySelector('[data-testid="team-role-badge"]')?.textContent).toBe(LEX.acsRoleAdmin[0]);
    expect(text()).toContain(`Alex Chen: ${TEAM_ROUTE_MESSAGES.role_change_failed[0]}`);
  });

  it("an unnamed row's failure names the row as Name not set, with the Chinese fullwidth colon", async () => {
    const unnamed = "b2c3d4e5-2222-4e6a-9c03-5b71ee0a4d22";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (url === "/api/teams") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ teams: [{ id: "team-1", name: "Desk" }] }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/team-1/members") && method !== "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              members: [
                { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null },
                { userId: unnamed, role: "member", displayName: "", createdAt: null },
              ],
              callerRole: "owner",
            }),
          } as unknown as Response;
        }
        if (url.startsWith("/api/teams/invitations")) {
          return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response;
        }
        if (method === "PATCH") {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              message: TEAM_ROUTE_MESSAGES.role_change_failed[0],
              messageZh: TEAM_ROUTE_MESSAGES.role_change_failed[1],
            }),
          } as unknown as Response;
        }
        throw new Error(`unstubbed ${method} ${url}`);
      }),
    );
    await mount("zh");
    const makeAdmin = actionButtons(unnamed).find((b) => (b.textContent || "").trim() === LEX.acsMakeAdmin[1]);
    expect(makeAdmin).toBeTruthy();
    await act(async () => {
      makeAdmin!.click();
    });
    expect(text()).toContain(`${LEX.acsTeamNoName[1]}：${TEAM_ROUTE_MESSAGES.role_change_failed[1]}`);
  });
});

describe("heal h3: a join date or expiry that was not read is printed, never hidden", () => {
  it.each(["en", "zh"] as const)("%s: a missing join date and a missing expiry render the not-read pairs", async (lang) => {
    const idx = lang === "zh" ? 1 : 0;
    await mount(lang, {
      ...ROSTER_FIXTURE,
      members: [
        { userId: CALLER, role: "owner", displayName: "Chris Wong", createdAt: null },
        { userId: "a1b2c3d4-1111-4e6a-9c03-5b71ee0a4d22", role: "admin", displayName: "Alex Chen", createdAt: "not-a-date" },
      ],
      invites: [{ id: "inv-1", email: "pending@example.com", role: "member", expiresAt: null }],
    });
    expect(text()).toContain(idx === 1 ? JOIN_UNREAD_ZH : JOIN_UNREAD_EN);
    expect(text()).not.toContain("Invalid Date");
    expect(text()).toContain(idx === 1 ? EXPIRY_UNREAD_ZH : EXPIRY_UNREAD_EN);
  });

  it("acsDate returns null for every unreadable input and never Invalid Date", () => {
    expect(acsDate(null, "en")).toBeNull();
    expect(acsDate(undefined, "en")).toBeNull();
    expect(acsDate("", "zh")).toBeNull();
    expect(acsDate("not-a-date", "en")).toBeNull();
    expect(acsDate("not-a-date", "zh")).toBeNull();
    const thrown = {
      toString() {
        throw new Error("cannot stringify");
      },
    };
    expect(acsDate(thrown as unknown as string, "en")).toBeNull();
    expect(acsDate("2026-02-14T09:12:00.000Z", "en")).toMatch(/2026/);
  });
});

describe("heal h3: standing-law 你 — no 您 in acsTeam*/acsRole* keys", () => {
  it("no ZH string among LEX keys whose name starts with acsTeam or acsRole contains 您", () => {
    const keys = Object.keys(LEX).filter((key) => key.startsWith("acsTeam") || key.startsWith("acsRole"));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      expect(pair[1], key).not.toContain("您");
    }
    expect(LEX.acsTeamCreated[1]).toBe("你的团队已创建。");
    expect(TEAM_ROUTE_MESSAGES.no_self_role[1]).toBe("你无法更改自己的角色。请联系团队所有者。");
    expect(TEAM_ROUTE_MESSAGES.same_owner[1]).toBe("你已经是所有者。");
  });
});

