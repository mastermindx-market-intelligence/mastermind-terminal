// @vitest-environment jsdom

/**
 * SharedBrief recipient consumer acceptance tests.
 *
 * Only the browser auth client, the shell i18n hook and the network are
 * mocked. The decoder (lib/briefDeliverySharing) and the reading scope
 * (lib/shared-shell/useReadingScope) run for real and unmocked, so every
 * assertion below goes through the actual decodeSharedBrief contract.
 */

import React, { act } from "react";
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import SharedBrief, {
  type SharedBriefProps,
} from "@/components/briefs/SharedBrief";

const DELIVERY = "40000000-0000-4000-8000-000000000001";
const DRIFTED = "40000000-0000-4000-8000-000000000002";
const USER_A = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

type Lang = "en" | "zh";
type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

const mockShell = { user: USER_A };
const mockLang = { value: "en" as Lang };
const mockAuth: { user: string; listener: AuthListener | null } = {
  user: USER_A,
  listener: null,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: mockAuth.user } }, error: null }),
      onAuthStateChange: (listener: AuthListener) => {
        mockAuth.listener = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useLang: () => ({ lang: mockLang.value }),
}));

vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: mockShell.user, email: "display@example.test" }) }));

// ---- network plans -----------------------------------------------------------

type Planned =
  | { status: number; body: unknown }
  | { pending: true; resolve?: (value: unknown) => void };

let queue: Planned[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function payload(deliveryId: string = DELIVERY): Record<string, unknown> {
  return {
    schema: "mastermind.shared_brief_delivery.v1",
    delivery: {
      delivery_id: deliveryId,
      slot_asof: "2026-11-04",
      artifact_asof: "2026-11-04T00:00:00.000000Z",
      content_sha256: SHA,
      body: {
        market_read: [
          {
            section: "Market",
            sentence_en: "An authored sentence.",
            sentence_zh: "原有句子。",
            asof: "2026-11-04",
          },
        ],
        monitors: [{ name: "Liquidity", state_en: "Stable.", state_zh: "平稳。" }],
        artifact: { name: "Weekly research brief", asof: "2026-11-04" },
      },
    },
    audience: {
      team_id: TEAM,
      name: "Research",
      membership_policy: "DYNAMIC_TEAM_MEMBERSHIP",
    },
  };
}

// ---- harness -----------------------------------------------------------------

type Mounted = { container: HTMLElement; root: Root };
let mounted: Mounted[] = [];

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

function mount(props: SharedBriefProps): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => {
    root.render(<SharedBrief {...props} />);
  });
  return { container, root };
}

function rerender(m: Mounted, props: SharedBriefProps) {
  act(() => {
    m.root.render(<SharedBrief {...props} />);
  });
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockAuth.user = USER_A;
  mockShell.user = USER_A;
  mockAuth.listener = null;
  mockLang.value = "en";
  queue = [];
  fetchMock = vi.fn((_url: unknown, _init: unknown) => {
    const plan = queue.length > 1 ? (queue.shift() as Planned) : queue[0];
    if (plan && "pending" in plan) {
      return new Promise((resolve) => {
        plan.resolve = resolve;
      });
    }
    const fixed = (plan ?? { status: 500, body: null }) as {
      status: number;
      body: unknown;
    };
    return Promise.resolve({
      status: fixed.status,
      ok: fixed.status >= 200 && fixed.status < 300,
      json: async () => fixed.body,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => {
      m.root.unmount();
    });
    m.container.remove();
  }
  vi.unstubAllGlobals();
});

const buttonByText = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  ) ?? null;

// ---- acceptance ---------------------------------------------------------------

describe("SharedBrief recipient consumer", () => {
  it("renders the safe DTO in EN, then ZH, through the real decoder", async () => {
    queue = [{ status: 200, body: payload() }];
    const m = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();

    let text = m.container.textContent ?? "";
    expect(text).toContain("Weekly research brief");
    expect(text).toContain("An authored sentence.");
    expect(text).toContain("Content as of");
    expect(text).toContain("Access reflects this read. The brief’s dates are shown above.");
    expect(text).not.toContain("原有句子。");
    expect(text).toContain(
      "View only. Members of Research can read this brief. Access changes with team membership.",
    );
    expect(m.container.querySelector("h1")?.textContent).toBe(
      "Weekly research brief",
    );
    expect(m.container.firstElementChild?.getAttribute("lang")).toBe("en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined];
    expect(String(url)).toBe(`/api/briefs/shared/${DELIVERY}`);
    expect(init?.method).toBeUndefined();

    mockLang.value = "zh";
    rerender(m, { principalId: USER_A, deliveryId: DELIVERY });
    text = m.container.textContent ?? "";
    expect(text).toContain("原有句子。");
    expect(text).toContain("平稳。");
    expect(text).not.toContain("An authored sentence.");
    expect(text).toContain("仅可查看。Research 的当前成员可以阅读此简报，访问权限随团队成员变动而变化。");
    expect(m.container.firstElementChild?.getAttribute("lang")).toBe("zh");
    // Switching locale never refetches: still exactly one read.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a body that smuggles the owner target field",
      (() => {
        const leaky = payload();
        const delivery = leaky.delivery as Record<string, unknown>;
        delivery.body = {
          ...(delivery.body as Record<string, unknown>),
          target: { kind: "watchlist", name: "Private source" },
        };
        return leaky;
      })(),
    ],
    [
      "a wrong envelope schema",
      (() => {
        const wrong = payload();
        wrong.schema = "mastermind.brief_delivery_sharing.v1";
        return wrong;
      })(),
    ],
  ])("denies %s calmly, with no leak and no content", async (_label, body) => {
    queue = [{ status: 200, body }];
    const { container } = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();

    const text = container.textContent ?? "";
    expect(text).toContain("could not be read");
    expect(text).not.toContain("Private source");
    expect(text).not.toContain("Weekly research brief");
    expect(text).not.toContain("Research");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("masks all prior content when the explicit refresh is denied", async () => {
    queue = [
      { status: 200, body: payload() },
      { status: 403, body: null },
    ];
    const { container } = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();
    expect(container.textContent).toContain("Weekly research brief");

    const refresh = buttonByText(container, "Refresh");
    expect(refresh).not.toBeNull();
    await act(async () => {
      (refresh as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("Weekly research brief");
    expect(text).not.toContain("An authored sentence.");
    expect(text).not.toContain("Research");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1][1] as RequestInit | undefined;
    expect(init?.method).toBeUndefined();
  });

  it("ends the scope on identity departure and never applies a stale response", async () => {
    const plan: Planned = { pending: true };
    queue = [plan];
    const { container } = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();
    expect(mockAuth.listener).not.toBeNull();
    expect(container.textContent).toContain("Reading");

    // A -> B: the session identity departs, so the private lifecycle ends.
    await act(async () => {
      mockAuth.listener?.("SIGNED_OUT", null);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain("Reading");
    expect(container.textContent).not.toContain("Weekly research brief");

    // The stale read resolves late and must stay dead.
    await act(async () => {
      if (plan && "pending" in plan) {
        plan.resolve?.({
          status: 200,
          ok: true,
          json: async () => payload(),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain("Weekly research brief");

    // B -> A: the returning original identity cannot resurrect the frame.
    await act(async () => {
      mockAuth.listener?.("SIGNED_IN", { user: { id: USER_A } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain("Weekly research brief");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response whose delivery id drifts from the requested UUID", async () => {
    queue = [{ status: 200, body: payload(DRIFTED) }];
    const { container } = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();

    const text = container.textContent ?? "";
    expect(text).not.toContain("Weekly research brief");
    expect(text).toContain("could not be read");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("issues only readonly GET reads and never polls", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    queue = [{ status: 200, body: payload() }];
    const { container } = mount({ principalId: USER_A, deliveryId: DELIVERY });
    await settle();
    await settle();
    expect(container.textContent).toContain("Weekly research brief");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method === undefined || init?.method === "GET").toBe(true);
    }
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
  });
  it("withholds even a well-shaped private DTO on a failed HTTP response", async () => {
    queue = [{ status: 503, body: payload() }];
    const m = mount({ principalId: USER_A, deliveryId: DELIVERY }); await settle();
    expect(m.container.textContent).not.toContain("Weekly research brief");
    expect(m.container.textContent).toContain("could not be read");
  });

  it("offers an explicit read retry after a source error without any send", async () => {
    queue = [{ status: 503, body: null }];
    const m = mount({ principalId: USER_A, deliveryId: DELIVERY }); await settle();
    queue = [{ status: 200, body: payload() }];
    await act(async () => { buttonByText(m.container, "Retry read")!.click(); }); await settle();
    expect(m.container.textContent).toContain("Weekly research brief");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call => !(call[1] as RequestInit)?.method)).toBe(true);
  });

  it("masks the loaded delivery on the same render when selection changes", async () => {
    queue = [{ status: 200, body: payload() }];
    const m = mount({ principalId: USER_A, deliveryId: DELIVERY }); await settle();
    expect(m.container.textContent).toContain("Weekly research brief");
    const next: Planned = { pending: true }; queue = [next];
    rerender(m, { principalId: USER_A, deliveryId: DRIFTED });
    expect(m.container.textContent).not.toContain("Weekly research brief");
    await settle();
    expect(String(fetchMock.mock.calls[1][0])).toBe(`/api/briefs/shared/${DRIFTED}`);
  });

  it("shell identity rotation masks loaded content before browser identity catches up", async () => {
    queue = [{ status: 200, body: payload() }];
    const m = mount({ principalId: USER_A, deliveryId: DELIVERY }); await settle();
    mockShell.user = "10000000-0000-4000-8000-000000000002";
    rerender(m, { principalId: USER_A, deliveryId: DELIVERY });
    expect(m.container.textContent).not.toContain("Weekly research brief");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
