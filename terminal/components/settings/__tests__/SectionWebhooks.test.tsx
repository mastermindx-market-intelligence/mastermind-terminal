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
import { webhookCopy, webhookDeliveryStatusLabel } from "@/lib/webhookLabels";

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
let webhooksImpl: (url: string) => Promise<Response>;

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

function installFetch() {
  fetchCalls = [];
  teamsImpl = async () => jsonRes(200, { teams: [TEAM], truncated: false });
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
      if (url.includes("/api/teams")) return teamsImpl();
      if (url.includes("/api/webhooks")) return webhooksImpl(url);
      return jsonRes(404, {});
    }),
  );
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
