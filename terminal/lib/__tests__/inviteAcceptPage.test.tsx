// @vitest-environment jsdom
//
// Rendered coverage for the public invitation page (packet W9T_F12_17 / MO-PAID-081, seat pick:
// honest link-only). The link a team owner copies has to land somewhere a person can act on, and
// every state it can reach is a plain sentence in both languages — including the states that are
// the server's fault rather than the reader's. Mounted the way lib/__tests__/sectionTeam.test.tsx
// does it: react-dom/client plus act(), no new dependency, fetch stubbed per call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  authThrows: false,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    if (H.authThrows) throw new Error("no auth authority on this server");
    return { auth: { getUser: async () => ({ data: { user: H.user } }) } };
  },
}));

import InviteAccept from "@/app/invite/InviteAccept";
import InvitePage from "@/app/invite/page";
import { LEX, LangProvider, applyLang } from "@/lib/i18n";
import { INVITE_MESSAGES, INVITE_TTL_DAYS, newInviteToken } from "@/lib/teams";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = newInviteToken();

let container: HTMLDivElement;
let root: Root;

async function mount(token: string | null, lang: "en" | "zh") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    applyLang(lang);
    root.render(
      <LangProvider>
        <InviteAccept token={token} />
      </LangProvider>,
    );
  });
  // The session check and the language read both settle a microtask after the first paint.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function text() {
  return container.textContent || "";
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: (init?.method || "GET").toUpperCase(),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return impl(input, init);
  }));
  return calls;
}

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  H.user = { id: "u1" };
  H.authThrows = false;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/invite: the link a copied invitation opens", () => {
  it.each(["en", "zh"] as const)("%s: a malformed or absent token reads as an invalid link, with nothing to accept", async (lang) => {
    const idx = lang === "zh" ? 1 : 0;
    await mount(null, lang);
    expect(text()).toContain(INVITE_MESSAGES.invalid_token[idx]);
    expect(container.querySelector('[data-testid="invite-accept"]')).toBeNull();
    expect(container.querySelector('[data-testid="invite-signin-link"]')).toBeNull();
    expect(text()).toContain(LEX.invTitle[idx]);
    expect(text()).toContain(LEX.invLinkLife[idx].replace("{days}", String(INVITE_TTL_DAYS)));
  });

  it.each(["en", "zh"] as const)("%s: a signed-out visitor is told to sign in and to come back to this link", async (lang) => {
    const idx = lang === "zh" ? 1 : 0;
    H.user = null;
    await mount(TOKEN, lang);
    expect(text()).toContain(INVITE_MESSAGES.not_signed_in[idx]);
    expect(text()).toContain(LEX.invSignInReturn[idx]);
    const link = container.querySelector('[data-testid="invite-signin-link"]');
    expect(link?.textContent?.trim()).toBe(LEX.invSignIn[idx]);
    expect(link?.getAttribute("href")).toBe("/terminal?signin=1");
    expect(container.querySelector('[data-testid="invite-accept"]')).toBeNull();
    // Nobody is signed in, so nothing was posted on their behalf.
    expect(text()).not.toContain(TOKEN);
  });

  it.each(["en", "zh"] as const)("%s: a signed-in visitor gets exactly one control — accept", async (lang) => {
    const idx = lang === "zh" ? 1 : 0;
    await mount(TOKEN, lang);
    const accept = container.querySelector('[data-testid="invite-accept"]');
    expect(accept?.textContent?.trim()).toBe(LEX.invAccept[idx]);
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('[data-testid="invite-signin-link"]')).toBeNull();
    expect(text()).toContain(LEX.invIntro[idx]);
  });

  it("accepting posts the token and nothing else, then shows the server's own sentence", async () => {
    const calls = stubFetch(async () =>
      json(200, { ok: true, teamId: "t1", role: "member", message: "You have joined the team.", messageZh: "你已加入该团队。" }),
    );
    await mount(TOKEN, "en");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/teams/invitations");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body!)).toEqual({ action: "accept", token: TOKEN });
    expect(container.querySelector('[data-testid="invite-card"]')?.getAttribute("data-phase")).toBe("joined");
    expect(container.querySelector('[data-testid="invite-note"]')?.textContent).toBe("You have joined the team.");
    expect(container.querySelector('[data-testid="invite-open"]')?.getAttribute("href")).toBe("/terminal");
    expect(container.querySelector('[data-testid="invite-accept"]')).toBeNull();
  });

  it("the joined sentence follows the reader's language", async () => {
    stubFetch(async () =>
      json(200, { ok: true, teamId: "t1", role: "member", message: "You have joined the team.", messageZh: "你已加入该团队。" }),
    );
    await mount(TOKEN, "zh");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="invite-note"]')?.textContent).toBe("你已加入该团队。");
  });

  it.each([
    ["expired", 410],
    ["already_used", 409],
    ["email_mismatch", 403],
  ] as const)("%s: the reason the server gave is the sentence shown, not a generic failure", async (code, status) => {
    stubFetch(async () => json(status, { error: code.toUpperCase(), message: INVITE_MESSAGES[code][0], messageZh: INVITE_MESSAGES[code][1] }));
    await mount(TOKEN, "en");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="invite-note"]')?.textContent).toBe(INVITE_MESSAGES[code][0]);
    expect(text()).not.toContain(INVITE_MESSAGES.failed[0]);
    expect(text()).not.toContain(code.toUpperCase());
    expect(container.querySelector('[data-testid="invite-accept"]')).toBeNull();
  });

  it("a signed-out answer to the accept call returns the visitor to the sign-in state", async () => {
    stubFetch(async () =>
      json(401, { error: "NOT_SIGNED_IN", message: INVITE_MESSAGES.not_signed_in[0], messageZh: INVITE_MESSAGES.not_signed_in[1] }),
    );
    await mount(TOKEN, "en");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="invite-card"]')?.getAttribute("data-phase")).toBe("signed-out");
    expect(container.querySelector('[data-testid="invite-signin-link"]')).not.toBeNull();
  });

  it("an answer carrying no sentence falls back to the catalogued plain failure", async () => {
    stubFetch(async () => json(500, {}));
    await mount(TOKEN, "zh");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="invite-note"]')?.textContent).toBe(INVITE_MESSAGES.failed[1]);
  });

  it("a network failure on accept is a plain failure, never an invented success", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    await mount(TOKEN, "en");
    await act(async () => {
      (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="invite-note"]')?.textContent).toBe(INVITE_MESSAGES.failed[0]);
    expect(container.querySelector('[data-testid="invite-open"]')).toBeNull();
  });

  it("an unreachable auth authority says the server is not set up, never that the link is broken", async () => {
    H.authThrows = true;
    await mount(TOKEN, "en");
    expect(container.querySelector('[data-testid="invite-card"]')?.getAttribute("data-phase")).toBe("unavailable");
    expect(text()).toContain(INVITE_MESSAGES.unavailable[0]);
    expect(text()).not.toContain(INVITE_MESSAGES.invalid_token[0]);
    expect(container.querySelector('[data-testid="invite-accept"]')).toBeNull();
  });

  it("the token is never printed as prose in any state", async () => {
    stubFetch(async () => json(200, { ok: true, message: "You have joined the team.", messageZh: "你已加入该团队。" }));
    for (const lang of ["en", "zh"] as const) {
      await mount(TOKEN, lang);
      await act(async () => {
        (container.querySelector('[data-testid="invite-accept"]') as HTMLButtonElement).click();
      });
      expect(text()).not.toContain(TOKEN);
      expect(container.innerHTML).not.toContain(TOKEN);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
    await mount(TOKEN, "en");
  });
});

describe("/invite page module: it decides what the client half is allowed to see", () => {
  it("hands a well-formed token through and reduces anything else to null", async () => {
    const good = await InvitePage({ searchParams: Promise.resolve({ token: TOKEN }) });
    expect((good.props as { token: string | null }).token).toBe(TOKEN);

    for (const bad of ["", "not-a-token", "g".repeat(64), TOKEN.slice(0, 63), `${TOKEN}&role=owner`]) {
      const rendered = await InvitePage({ searchParams: Promise.resolve({ token: bad }) });
      expect((rendered.props as { token: string | null }).token, bad).toBeNull();
    }

    const repeated = await InvitePage({ searchParams: Promise.resolve({ token: [TOKEN, "x".repeat(64)] }) });
    expect((repeated.props as { token: string | null }).token).toBe(TOKEN);

    const absent = await InvitePage({ searchParams: Promise.resolve({}) });
    expect((absent.props as { token: string | null }).token).toBeNull();
  });

  it("a link carrying a one-time token is never indexed or followed", async () => {
    const { metadata } = await import("@/app/invite/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("W9T_F12_17 copy law: every new /invite string is a plain sentence in EN and ZH", () => {
  const KEYS = [
    "invTitle", "invIntro", "invChecking", "invAccept", "invAccepting",
    "invSignIn", "invSignInReturn", "invOpenTerminal", "invLinkLife",
    "acsTeamInviteTitle", "acsTeamInviteEmail", "acsTeamInviteEmailHint", "acsTeamInviteRole",
    "acsTeamInviteCreate", "acsTeamInviteCreating", "acsTeamInviteCreated", "acsTeamInviteFor",
    "acsTeamInviteCopy", "acsTeamInviteCopied", "acsTeamInviteCopyFail", "acsTeamInviteSend",
    "acsTeamInviteAnother", "acsTeamInviteNeedEmail",
  ];
  const SENTENCES = new Set([
    "invIntro", "invChecking", "invAccepting", "invSignInReturn", "invLinkLife",
    "acsTeamInviteEmailHint", "acsTeamInviteCreated", "acsTeamInviteCreating",
    "acsTeamInviteCopyFail", "acsTeamInviteSend",
  ]);
  const BANNED = [
    "falsifier", "refuted", "证伪", "validated", "no_email_delivery", "team_invites",
    "accept_team_invite", "RLS", "inviteUrl", "token=", "MO-PAID", "W9T",
  ];

  it("each key is a distinct EN/ZH pair, the Chinese twin is real Chinese, and no machine text leaks", () => {
    for (const key of KEYS) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      const [en, zh] = pair;
      expect(en.length, key).toBeGreaterThan(0);
      expect(zh.length, key).toBeGreaterThan(0);
      expect(en, key).not.toBe(zh);
      expect(en, key).toMatch(/^[A-Z]/);
      expect(zh, key).toMatch(/[一-鿿]/);
      // A ZH twin that is really English in Chinese clothes fails here: no Latin word runs, apart
      // from the product name, which house copy keeps in English in both locales (lib/teams.ts
      // user_not_supported / user_not_found do the same).
      const zhProse = zh
        .replace(/Mastermind(?: Terminal)?/g, "")
        .replace(/\{[a-zA-Z]+\}/g, "");
      expect(zhProse, key).not.toMatch(/[A-Za-z]{3,}/);
      if (SENTENCES.has(key)) {
        // An in-progress line ends on an ellipsis; everything else ends on a full stop.
        expect(en, key).toMatch(/[.!?\u2026]$/);
        expect(zh, key).toMatch(/[。！？\u2026]$/);
      }
      for (const banned of BANNED) {
        expect(en, `${key}:${banned}`).not.toContain(banned);
        expect(zh, `${key}:${banned}`).not.toContain(banned);
      }
      expect(en, key).not.toMatch(/\b\d{3}\b/);
    }
  });

  it("the {days} placeholder is the real invitation lifetime, in both languages", () => {
    expect(LEX.invLinkLife[0].replace("{days}", String(INVITE_TTL_DAYS))).toContain(`${INVITE_TTL_DAYS} days`);
    expect(LEX.invLinkLife[1].replace("{days}", String(INVITE_TTL_DAYS))).toContain(`${INVITE_TTL_DAYS} 天`);
    expect(LEX.acsTeamInviteSend[0].replace("{days}", String(INVITE_TTL_DAYS))).toContain(`${INVITE_TTL_DAYS} days`);
    expect(LEX.acsTeamInviteSend[1].replace("{days}", String(INVITE_TTL_DAYS))).toContain(`${INVITE_TTL_DAYS} 天`);
  });
});
