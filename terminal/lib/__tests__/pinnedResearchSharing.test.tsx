// @vitest-environment jsdom
//
// Functional jsdom proof for the Settings > Sharing pinned-research block. Mounts the REAL
// PinnedResearchSharing component (no test double) against synthetic /api/research-handoffs
// answers shaped exactly as the real route emits them. No @testing-library/react in this
// repo — react-dom/client createRoot + act. Never claims live/browser proof.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import PinnedResearchSharing from "@/components/settings/PinnedResearchSharing";
import type { SectionProps } from "@/components/settings/types";
import type { AccountIdentity } from "@/lib/accountIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = "11111111-1111-4111-8111-111111111111";
const GRANTEE = "22222222-2222-4222-8222-222222222222";
const INV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANT = "dddddddd-dddd-4ddd-8ddd-000000000001";
const REVISION = 3;

const OPEN_EN = "Open pinned research sharing";
const READ_EN = "Read shared content";
const HIDE_EN = "Hide shared content";
const QUESTION = "Is copper supply tightening into Q1?";
const UNAVAILABLE_EN = "Research handoff sharing is not available right now. Nothing was changed.";
const GONE_EN = "This share has ended.";
const HIDDEN_EN =
  "Refreshing this handoff failed, so its content is hidden. The share may still be live — open it again to check.";
const REVOKED_EN = "Share revoked.";
const SHARED_EN = "Shared. The recipient sees the pinned revision only.";
const OPEN_ZH = "展开钉选研究共享";
const READ_ZH = "查看共享内容";
const UNAVAILABLE_ZH = "钉选研究共享暂时不可用。未更改任何内容。";

type SummaryWire = {
  grant_id: string;
  investigation_id: string;
  revision: number;
  title: string;
  shared_by: string;
  grantee_user_id: string;
  created_at: string;
};

function summary(grantId: string, sharedBy: string, grantee: string, title = "Copper question"): SummaryWire {
  return {
    grant_id: grantId,
    investigation_id: INV,
    revision: REVISION,
    title,
    shared_by: sharedBy,
    grantee_user_id: grantee,
    created_at: "2026-10-01T12:00:00.000Z",
  };
}

const OWN_ITEM = { id: INV, revision: REVISION, title: "Copper question" };

// `own` defaults to the owner fixture; recipient scenarios pass [] because the RPC only ever
// lists the CALLER's own active investigations there.
function listBody(
  sent: SummaryWire[],
  received: SummaryWire[],
  own: { id: string; revision: number; title: string }[] = [OWN_ITEM],
) {
  return { status: "listed", own, sent, received };
}

function foundBody(grantId: string) {
  return {
    status: "found",
    handoff: {
      schema: "mm.research_handoff.v1",
      grant_id: grantId,
      investigation_id: INV,
      revision: REVISION,
      shared_by: OWNER,
      committed_at: "2026-10-01T12:00:00.000Z",
      intent: { title: "Copper question", question: QUESTION },
      continuation: { next_question: "Check smelter margins" },
    },
  };
}

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function identityOf(userId: string): AccountIdentity {
  return { kind: "account", userId, email: "a@example.com" };
}

const WIRE_T: Record<string, [string, string]> = {
  shrSharedWithAccount: ["Shared with the account ending {n}.", "已共享给账户尾号{n}。"],
  shrReadOnlyBadge: ["Read only", "仅可查看"],
};

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = WIRE_T[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

type Props = Pick<SectionProps, "t" | "lang" | "identity">;

function baseProps(lang: "en" | "zh", userId = OWNER): Props {
  return { t: makeT(lang), lang, identity: identityOf(userId) };
}

describe("PinnedResearchSharing (jsdom, real component)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    fetchSpy = vi.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  async function mountFresh(props: Props) {
    await act(async () => {
      root?.unmount();
      root = createRoot(container);
      root.render(React.createElement(PinnedResearchSharing, props));
    });
  }

  async function rerender(props: Props) {
    await act(async () => {
      root?.render(React.createElement(PinnedResearchSharing, props));
    });
  }

  function button(label: string): HTMLButtonElement | null {
    return (
      (Array.from(container.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label") === label,
      ) as HTMLButtonElement | undefined) ?? null
    );
  }

  function needButton(label: string): HTMLButtonElement {
    const el = button(label);
    if (!el) throw new Error(`button ${label} not found`);
    return el;
  }

  function click(label: string) {
    return act(async () => {
      needButton(label).click();
    });
  }

  function calls(method: string, query = ""): number {
    return fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/api/research-handoffs") &&
        String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() === method &&
        String(input).includes(query),
    ).length;
  }

  function headerOf(init: RequestInit | undefined, name: string): string {
    return new Headers(init?.headers as HeadersInit | undefined).get(name) ?? "";
  }

  async function openPane() {
    await click(OPEN_EN);
    await vi.waitFor(() => expect(container.querySelector("#rsr-pick-inv")).toBeTruthy());
  }

  async function fillForm(account: string) {
    await act(async () => {
      const select = container.querySelector("#rsr-pick-inv") as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, INV);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const input = container.querySelector("#rsr-account") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, account);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function msgText(): string | null {
    return container.querySelector(".acs-msg")?.textContent ?? null;
  }

  it("starts collapsed and fetches nothing until the owner opens it", async () => {
    fetchSpy.mockImplementation(async () => jsonRes(200, listBody([], [])));
    await mountFresh(baseProps("en"));
    expect(needButton(OPEN_EN)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    await openPane();
    expect(calls("GET", "")).toBe(1);
    expect(container.textContent).toContain("Copper question");
  });

  it("the owner shares intentionally, sees the sent row, and can revoke it", async () => {
    let grantMade = false;
    let revoked = false;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        expect(JSON.parse(String(init?.body))).toEqual({
          investigation_id: INV,
          revision: REVISION,
          grantee_user_id: GRANTEE,
        });
        expect(headerOf(init, "x-mm-handoff-owner")).toBe(OWNER);
        expect(headerOf(init, "content-type")).toContain("application/json");
        grantMade = true;
        return jsonRes(201, { status: "created", handoff: summary(GRANT, OWNER, GRANTEE) });
      }
      if (method === "DELETE") {
        expect(JSON.parse(String(init?.body))).toEqual({ grant_id: GRANT });
        expect(headerOf(init, "x-mm-handoff-owner")).toBe(OWNER);
        revoked = true;
        return jsonRes(200, { status: "revoked" });
      }
      return jsonRes(200, listBody(grantMade && !revoked ? [summary(GRANT, OWNER, GRANTEE)] : [], []));
    });
    await mountFresh(baseProps("en"));
    await openPane();
    await fillForm(GRANTEE);
    await click("Share read-only");
    await vi.waitFor(() => expect(msgText()).toBe(SHARED_EN));
    expect(container.textContent).toContain("Copper question");
    expect(needButton("Revoke — Copper question")).toBeTruthy();
    expect(container.textContent).toContain("Pinned to revision 3.");
    expect(container.textContent).toContain("2222");

    await click("Revoke — Copper question");
    await vi.waitFor(() => expect(msgText()).toBe(REVOKED_EN));
    await vi.waitFor(() => expect(button("Revoke — Copper question")).toBeNull());
  });

  it("a recipient can open and read the shared content, and a confirmed 404 clears it", async () => {
    let gone = false;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("grant_id=")) {
        return gone ? jsonRes(404, { status: "not_found" }) : jsonRes(200, foundBody(GRANT));
      }
      return jsonRes(200, listBody([], gone ? [] : [summary(GRANT, OWNER, GRANTEE)], []));
    });
    await mountFresh(baseProps("en", GRANTEE));
    await openPane();
    await click(READ_EN);
    await vi.waitFor(() => expect(container.textContent).toContain(QUESTION));
    expect(container.textContent).toContain("Check smelter margins");
    expect(container.textContent).toContain("Reference attachments and review notes are not included.");
    expect(container.textContent).toContain("Pinned to revision 3.");
    expect(container.textContent).toContain("Read only");
    // No whole-manifest leakage, ever.
    expect(container.textContent).not.toContain("layout");
    expect(container.textContent).not.toContain("evidence");

    // The source was removed: the CONFIRMED 404 ends the share in the UI and clears content.
    gone = true;
    await click(HIDE_EN);
    await click(READ_EN);
    await vi.waitFor(() => expect(msgText()).toBe(GONE_EN));
    expect(container.textContent).not.toContain(QUESTION);
    expect(button(READ_EN)).toBeNull();
  });

  it("a failed read never asserts revocation: it hides the stale content and says so", async () => {
    let fail = false;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("grant_id=") && fail) return jsonRes(503, { status: "unavailable" });
      if (url.includes("grant_id=")) return jsonRes(200, foundBody(GRANT));
      return jsonRes(200, listBody([], [summary(GRANT, OWNER, GRANTEE)], []));
    });
    await mountFresh(baseProps("en", GRANTEE));
    await openPane();
    await click(READ_EN);
    await vi.waitFor(() => expect(container.textContent).toContain(QUESTION));
    fail = true;
    await click(HIDE_EN);
    await click(READ_EN);
    await vi.waitFor(() => expect(msgText()).toBe(HIDDEN_EN));
    // The private content is OUT of the view, but the row is NOT declared revoked.
    expect(container.textContent).not.toContain(QUESTION);
    expect(needButton(READ_EN)).toBeTruthy();
  });

  it("an unavailable list is an honest failure, never the empty sentences", async () => {
    fetchSpy.mockImplementation(async () => jsonRes(503, { status: "unavailable" }));
    await mountFresh(baseProps("en"));
    await click(OPEN_EN);
    await vi.waitFor(() => expect(msgText()).toBe(UNAVAILABLE_EN));
    expect(container.textContent).not.toContain("You have not shared an investigation yet.");
    expect(container.textContent).not.toContain("No investigation has been shared with you yet.");
    // The pane offers the explicit reopen instead of pretending.
    expect(needButton(OPEN_EN)).toBeTruthy();
    expect(container.querySelector("#rsr-pick-inv")).toBeNull();
  });

  it("renders the ZH pane with 你-addressed copy, CJK punctuation and the same honesty", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("grant_id=")) return jsonRes(200, foundBody(GRANT));
      return jsonRes(200, listBody([], [summary(GRANT, OWNER, GRANTEE)], []));
    });
    await mountFresh(baseProps("zh", GRANTEE));
    expect(container.textContent).toContain("钉选研究交接");
    await click(OPEN_ZH);
    expect(container.textContent).toContain("不包含参考附件与复盘记录，也不会跟进更新的修订版本");
    await vi.waitFor(() => expect(needButton(READ_ZH)).toBeTruthy());
    await click(READ_ZH);
    await vi.waitFor(() => expect(container.textContent).toContain(QUESTION));
    expect(container.textContent).toContain("下一个提问");
    expect(container.textContent).not.toContain("您");

    // A fresh ZH mount against an unavailable source shows the ZH failure sentence.
    fetchSpy.mockImplementation(async () => jsonRes(503, { status: "unavailable" }));
    await mountFresh(baseProps("zh", GRANTEE));
    await click(OPEN_ZH);
    await vi.waitFor(() => expect(msgText()).toBe(UNAVAILABLE_ZH));
    expect(container.textContent).not.toContain("还没有研究共享给你。");
  });

  it("an identity change invalidates in-flight generations: a late answer never paints", async () => {
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    fetchSpy.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        await new Promise((resolve) => {
          gate.release = resolve;
        });
        return jsonRes(201, { status: "created", handoff: summary(GRANT, OWNER, GRANTEE) });
      }
      return jsonRes(200, listBody([], []));
    });
    await mountFresh(baseProps("en", OWNER));
    await openPane();
    await fillForm(GRANTEE);
    await act(async () => {
      needButton("Share read-only").click();
    });
    // The owner's session switches accounts while the share is in flight.
    await rerender(baseProps("en", GRANTEE));
    await act(async () => {
      gate.release?.(undefined);
      gate.release = null;
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Pinned research handoffs"));
    // The pane reset to collapsed for the NEW owner: no stale row, no success claim, and the
    // share's follow-up reload must never fire.
    expect(msgText()).toBeNull();
    expect(container.querySelector("#rsr-account")).toBeNull();
    expect(container.textContent).not.toContain("Copper question");
    expect(container.textContent).not.toContain(SHARED_EN);
    await act(async () => {});
    expect(calls("GET", "")).toBe(1);
    expect(calls("POST")).toBe(1);
  });
});
