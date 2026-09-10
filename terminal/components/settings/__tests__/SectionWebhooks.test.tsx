// @vitest-environment jsdom
//
// Section coverage for B-F12-7 Webhooks. Mounts the real SectionWebhooks
// through react-dom/client (no @testing-library). Fetch is stubbed; this file
// does not shell out to git.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionWebhooks from "@/components/settings/SectionWebhooks";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";
import { webhookCopy, webhookDeliveryStatusLabel, webhookEnabledLabel } from "@/lib/webhookLabels";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function accountProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "account", userId: "user-1", email: "a@example.com" },
    email: "a@example.com",
    user: {
      id: "user-1",
      email: "a@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: "2026-09-01T00:00:00.000Z",
      provider: "email",
      meta: {},
    },
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

type FetchCall = { url: string; method: string };
let fetchCalls: FetchCall[];
let teamsImpl: () => Promise<Response>;
let teamsPostImpl: () => Promise<Response>;
let webhooksImpl: (url: string, method: string) => Promise<Response>;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TEAM = { id: "team-1", name: "Desk", role: "owner" as const };
const ENDPOINT = {
  id: "ep-1",
  teamId: "team-1",
  url: "https://hooks.example.com/mastermind",
  enabled: true,
  eventFilter: ["webhook.test"],
};

const WRITE_FAILED_EN = "We could not save that webhook endpoint.";
const WRITE_FAILED_ZH = "我们无法保存该 Webhook 端点。";
const ENDPOINTS_LOAD_FAILED_EN = "We could not read this team's webhook endpoints just now. Please try again.";
const ENDPOINTS_LOAD_FAILED_ZH = "暂时无法读取这个团队的 Webhook 端点，请重试。";
const DELIVERIES_LOAD_FAILED_EN = "We could not read the delivery log for this endpoint just now.";
const NOT_SIGNED_IN_EN = "You are not signed in.";
const NOT_SIGNED_IN_ZH = "你尚未登录。";
const UNAVAILABLE_EN = "Webhook endpoints are not set up on this server yet.";

function installFetch() {
  fetchCalls = [];
  teamsImpl = async () => jsonRes(200, { teams: [TEAM], truncated: false });
  teamsPostImpl = async () => jsonRes(201, { team: TEAM });
  webhooksImpl = async (url) => {
    if (url.includes("/deliveries")) {
      return jsonRes(200, {
        deliveries: [
          {
            id: "d1",
            eventType: "webhook.test",
            status: "not_sent_disabled",
            lastError: "endpoint_disabled",
            createdAt: "2026-09-09T11:00:00.000Z",
          },
        ],
      });
    }
    return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method || "GET").toUpperCase();
      fetchCalls.push({ url, method });
      if (url.includes("/api/teams")) {
        if (method === "POST") return teamsPostImpl();
        return teamsImpl();
      }
      if (url.includes("/api/webhooks")) return webhooksImpl(url, method);
      return jsonRes(404, {});
    }),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(props: SectionProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SectionWebhooks {...props} />);
  });
  await flush();
  await flush();
  await flush();
  return container!;
}

beforeEach(() => {
  installFetch();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a team-load failure is not the empty-team help", () => {
  it("EN 503 with no body renders the load-failed sentence, not emptyTeamHelp", async () => {
    teamsImpl = async () => new Response("", { status: 503 });
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain("We could not load your team right now. Try again.");
    expect(text).not.toContain(webhookCopy("emptyTeamHelp", "en"));
    expect(el.querySelector("#wh-team-name")).toBeNull();
  });

  it("ZH 503 with no body renders the load-failed sentence, not emptyTeamHelp", async () => {
    teamsImpl = async () => new Response("", { status: 503 });
    const el = await mount(accountProps("zh"));
    const text = el.textContent || "";
    expect(text).toContain("暂时无法读取你的团队信息，请重试。");
    expect(text).not.toContain(webhookCopy("emptyTeamHelp", "zh"));
    expect(el.querySelector("#wh-team-name")).toBeNull();
  });

  it("a thrown fetch renders the same load-failed sentence", async () => {
    teamsImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain("We could not load your team right now. Try again.");
    expect(text).not.toContain(webhookCopy("emptyTeamHelp", "en"));
  });

  it("a real 200 with no team still shows emptyTeamHelp and the name field", async () => {
    teamsImpl = async () => jsonRes(200, { teams: [], truncated: false });
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(webhookCopy("emptyTeamHelp", "en"));
    expect(text).not.toContain("We could not load your team right now. Try again.");
    expect(el.querySelector("#wh-team-name")).not.toBeNull();
  });
});

describe("the delivery status sits in the section's own wrapping element", () => {
  it("renders the status through .acs-webhook-status, never .acs-row-val", async () => {
    const el = await mount(accountProps("en"));
    const status = el.querySelector(".acs-webhook-status");
    expect(status, "status span missing").not.toBeNull();
    expect(status!.textContent).toBe(webhookDeliveryStatusLabel("not_sent_disabled", "en"));
    const rowVals = Array.from(el.querySelectorAll(".acs-row-val")).map((n) => n.textContent || "");
    expect(rowVals.join("")).not.toContain("Not sent");
  });
});

describe("an endpoints-load failure is not the no-endpoints sentence", () => {
  it("EN 503 with a JSON body renders the route sentence, not noEndpoints", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(503, {
        error: "READ_UNAVAILABLE",
        message: UNAVAILABLE_EN,
        messageZh: "此服务器尚未启用 Webhook 端点。",
      });
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(UNAVAILABLE_EN);
    expect(text).not.toContain(webhookCopy("noEndpoints", "en"));
    expect(text.includes(UNAVAILABLE_EN)).toBe(true);
  });

  it("EN 502 with an HTML body renders endpointsLoadFailed, never empty, not noEndpoints", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      });
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(ENDPOINTS_LOAD_FAILED_EN);
    expect(text).not.toContain(webhookCopy("noEndpoints", "en"));
    expect(text.includes("undefined")).toBe(false);
  });

  it("a thrown fetch renders endpointsLoadFailed, not noEndpoints", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      throw new TypeError("Failed to fetch");
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(ENDPOINTS_LOAD_FAILED_EN);
    expect(text).not.toContain(webhookCopy("noEndpoints", "en"));
  });

  it("ZH 502 with an HTML body renders the frozen ZH endpointsLoadFailed sentence", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      });
    };
    const el = await mount(accountProps("zh"));
    const text = el.textContent || "";
    expect(text).toContain(ENDPOINTS_LOAD_FAILED_ZH);
    expect(text).not.toContain(webhookCopy("noEndpoints", "zh"));
  });
});

describe("a deliveries-load failure is not No deliveries yet", () => {
  it("401 renders deliveriesLoadFailed, not noDeliveries", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(401, { message: "You are not signed in.", messageZh: "你尚未登录。" });
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(DELIVERIES_LOAD_FAILED_EN);
    expect(text).not.toContain(webhookCopy("noDeliveries", "en"));
  });

  it("503 renders deliveriesLoadFailed, not noDeliveries", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(503, { message: UNAVAILABLE_EN });
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(DELIVERIES_LOAD_FAILED_EN);
    expect(text).not.toContain(webhookCopy("noDeliveries", "en"));
  });

  it("a thrown fetch renders deliveriesLoadFailed, not noDeliveries", async () => {
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) throw new TypeError("Failed to fetch");
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(DELIVERIES_LOAD_FAILED_EN);
    expect(text).not.toContain(webhookCopy("noDeliveries", "en"));
  });
});

describe("a 401 from /api/teams is signed-out, not empty-team", () => {
  it("renders the route's not-signed-in sentence and no team help or create form", async () => {
    teamsImpl = async () =>
      jsonRes(401, {
        error: "UNAUTHENTICATED",
        message: NOT_SIGNED_IN_EN,
        messageZh: NOT_SIGNED_IN_ZH,
      });
    const el = await mount(accountProps("en"));
    const text = el.textContent || "";
    expect(text).toContain(NOT_SIGNED_IN_EN);
    expect(text).not.toContain(webhookCopy("emptyTeam", "en"));
    expect(text).not.toContain(webhookCopy("emptyTeamHelp", "en"));
    expect(el.querySelector("#wh-team-name")).toBeNull();
  });

  it("ZH 401 renders 你尚未登录 and no create-team form", async () => {
    teamsImpl = async () =>
      jsonRes(401, {
        error: "UNAUTHENTICATED",
        message: NOT_SIGNED_IN_EN,
        messageZh: NOT_SIGNED_IN_ZH,
      });
    const el = await mount(accountProps("zh"));
    const text = el.textContent || "";
    expect(text).toContain(NOT_SIGNED_IN_ZH);
    expect(text).not.toContain("您尚未登录。");
    expect(text).not.toContain(webhookCopy("emptyTeamHelp", "zh"));
    expect(el.querySelector("#wh-team-name")).toBeNull();
  });
});

describe("mutation handlers tell the truth", () => {
  it("createTeam with a bodyless non-2xx uses write_failed, never an empty string", async () => {
    teamsImpl = async () => jsonRes(200, { teams: [], truncated: false });
    teamsPostImpl = async () => new Response("", { status: 503 });
    const el = await mount(accountProps("en"));
    const input = el.querySelector("#wh-team-name") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "Desk");
    });
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === webhookCopy("createTeam", "en"));
    expect(btn).toBeTruthy();
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
    await flush();
    await flush();
    const text = el.textContent || "";
    expect(text).toContain(WRITE_FAILED_EN);
    expect((el.querySelector(".acs-msg.err")?.textContent || "").trim()).not.toBe("");
  });

  it("createTeam catch on a rejected fetch uses write_failed", async () => {
    teamsImpl = async () => jsonRes(200, { teams: [], truncated: false });
    teamsPostImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const el = await mount(accountProps("en"));
    const input = el.querySelector("#wh-team-name") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "Desk");
    });
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === webhookCopy("createTeam", "en"));
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
    await flush();
    await flush();
    expect(el.textContent || "").toContain(WRITE_FAILED_EN);
  });

  it("addEndpoint catch on a rejected fetch uses write_failed", async () => {
    webhooksImpl = async (url, method) => {
      if (method === "POST") throw new TypeError("Failed to fetch");
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(200, { endpoints: [], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const input = el.querySelector("#wh-url") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "https://hooks.example.com/mastermind");
    });
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === webhookCopy("add", "en"));
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
    await flush();
    await flush();
    expect(el.textContent || "").toContain(WRITE_FAILED_EN);
  });

  it("sendTest catch on a rejected fetch uses write_failed", async () => {
    webhooksImpl = async (url, method) => {
      if (url.includes("/test")) throw new TypeError("Failed to fetch");
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === webhookCopy("sendTest", "en"));
    expect(btn).toBeTruthy();
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
    await flush();
    await flush();
    expect(el.textContent || "").toContain(WRITE_FAILED_EN);
  });

  it("toggleEnabled on 503 unavailable reverts and shows the route sentence", async () => {
    webhooksImpl = async (url, method) => {
      if (method === "PATCH") {
        return jsonRes(503, {
          error: "UNAVAILABLE",
          message: UNAVAILABLE_EN,
          messageZh: "此服务器尚未启用 Webhook 端点。",
        });
      }
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const toggle = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === webhookEnabledLabel(true, "en"),
    ) as HTMLButtonElement | undefined;
    expect(toggle).toBeTruthy();
    expect(toggle!.textContent).toBe(webhookEnabledLabel(true, "en"));
    await act(async () => {
      toggle!.click();
    });
    await flush();
    await flush();
    const after = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === webhookEnabledLabel(true, "en"),
    );
    expect(after).toBeTruthy();
    expect(after!.getAttribute("aria-pressed")).toBe("true");
    expect(el.textContent || "").toContain(UNAVAILABLE_EN);
  });

  it("toggleEnabled catch on a rejected fetch uses write_failed and reverts", async () => {
    webhooksImpl = async (url, method) => {
      if (method === "PATCH") throw new TypeError("Failed to fetch");
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(200, { endpoints: [ENDPOINT], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    const toggle = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === webhookEnabledLabel(true, "en"),
    ) as HTMLButtonElement | undefined;
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
    });
    await flush();
    await flush();
    const after = Array.from(el.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === webhookEnabledLabel(true, "en"),
    );
    expect(after).toBeTruthy();
    expect(after!.getAttribute("aria-pressed")).toBe("true");
    expect(el.textContent || "").toContain(WRITE_FAILED_EN);
  });
});

describe("delivery list ids are unique per endpoint", () => {
  it("emits wh-deliveries-<endpointId> once per endpoint", async () => {
    const ep2 = { ...ENDPOINT, id: "ep-2", url: "https://hooks.example.com/other" };
    webhooksImpl = async (url) => {
      if (url.includes("/deliveries")) return jsonRes(200, { deliveries: [] });
      return jsonRes(200, { endpoints: [ENDPOINT, ep2], callerRole: "owner", truncated: false });
    };
    const el = await mount(accountProps("en"));
    expect(el.querySelector("#wh-deliveries")).toBeNull();
    expect(el.querySelector("#wh-deliveries-ep-1")).not.toBeNull();
    expect(el.querySelector("#wh-deliveries-ep-2")).not.toBeNull();
    expect(el.querySelectorAll("[id^='wh-deliveries-']")).toHaveLength(2);
  });
});
