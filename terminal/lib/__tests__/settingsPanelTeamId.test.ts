// @vitest-environment jsdom
//
// BLOCKER 1 (h_t587 r2): live Settings must parse GET /api/teams as {teams, truncated}
// and pass the caller's team id into SectionAccuracy. A bare-array parse leaves
// activeTeamIdLive null, so the rollup never renders. RED at d0058eca.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SettingsPanel from "@/components/settings/SettingsPanel";
import SectionAccuracy from "@/components/settings/SectionAccuracy";
import { LangProvider, LEX } from "@/lib/i18n";
import { accountIdentity } from "@/lib/accountIdentity";
import { emptyAccuracyReadout } from "@/lib/personalAccuracy";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";
import type { AccuracyProps } from "@/components/settings/SectionAccuracy";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = accountIdentity("8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22", "a@example.com");

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function accuracyProps(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}): AccuracyProps {
  return {
    t: makeT(lang),
    lang,
    identity: OWNER,
    email: "a@example.com",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
    readout: emptyAccuracyReadout(),
    loadErr: false,
    ...extra,
  };
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flushUntil(pred: () => boolean, label: string) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 2500) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

describe("live SettingsPanel team id from GET /api/teams {teams, truncated}", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) =>
        ({
          matches: false,
          media: query,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        }) as unknown as MediaQueryList) as typeof window.matchMedia;
    }
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
  });

  function stubTeams(body: unknown, rollupStatus = 200, rollupBody: unknown = { kind: "empty_members", memberCount: 0 }) {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teams" || url.endsWith("/api/teams")) {
        return jsonRes(200, body);
      }
      if (url.includes("/accuracy/rollup")) {
        return jsonRes(rollupStatus, rollupBody);
      }
      if (url.includes("/api/accuracy")) {
        return jsonRes(200, emptyAccuracyReadout());
      }
      if (url.includes("/api/me") || url.includes("/api/brain/me")) {
        return jsonRes(200, { tier: "free", status: "none" });
      }
      return jsonRes(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  async function mountLive() {
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(SettingsPanel, {
            visible: true,
            openSeq: 1,
            section: "accuracy",
            onSection: () => {},
            onClose: () => {},
            identity: OWNER,
            user: { id: OWNER.kind === "account" ? OWNER.userId : "x", email: "a@example.com" } as never,
            onPatchMeta: () => {},
            onRefreshUser: async () => {},
            devPlan: { tier: "free", status: "none" },
            devAccuracy: emptyAccuracyReadout(),
          }),
        ),
      );
    });
  }

  it("mock {teams:[{id:\"t1\",role:\"member\"}],truncated:false} passes teamId=t1 into the rollup", async () => {
    stubTeams({ teams: [{ id: "t1", role: "member" }], truncated: false });
    await mountLive();
    await flushUntil(
      () => fetchMock.mock.calls.some((c) => String(c[0]) === "/api/teams" || String(c[0]).endsWith("/api/teams")),
      "GET /api/teams",
    );
    await flushUntil(
      () => fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/teams/t1/accuracy/rollup")),
      "rollup fetch for t1",
    );
    await flushUntil(
      () => (document.body.textContent || "").includes(LEX.accTeamTitle[0]),
      "rollup title",
    );
    expect(document.body.textContent).toContain(LEX.accTeamTitle[0]);
    expect(document.body.textContent).not.toContain(LEX.accTeamNoneCreate[0]);
  });

  it("mock {teams:[]} renders the no-team sentence", async () => {
    stubTeams({ teams: [], truncated: false });
    await mountLive();
    await flushUntil(
      () => fetchMock.mock.calls.some((c) => String(c[0]) === "/api/teams" || String(c[0]).endsWith("/api/teams")),
      "GET /api/teams",
    );
    await flushUntil(
      () => (document.body.textContent || "").includes(LEX.accTeamNoneCreate[0]),
      "no-team sentence",
    );
    expect(document.body.textContent).toContain(LEX.accTeamNoneCreate[0]);
    expect(document.body.textContent).toContain(LEX.accTeamNoneCreate[0]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/accuracy/rollup"))).toBe(false);
  });
});

describe("SectionAccuracy 503 from the rollup route is the unavailable pair", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes(503, {
        error: "READ_UNAVAILABLE",
        message: TEAM_ROUTE_MESSAGES.unavailable[0],
        messageZh: TEAM_ROUTE_MESSAGES.unavailable[1],
      })),
    );
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("EN and ZH: a 503 renders TEAM_ROUTE_MESSAGES.unavailable verbatim, never accDetLoadErr", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionAccuracy, accuracyProps("en", { teamId: "t1" })));
    });
    await flushUntil(
      () => (container.textContent || "").includes(TEAM_ROUTE_MESSAGES.unavailable[0])
        || (container.textContent || "").includes(LEX.accDetLoadErr[0]),
      "503 EN copy",
    );
    expect(container.textContent).toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
    expect(container.textContent).toContain(TEAM_ROUTE_MESSAGES.unavailable[1]);
    expect(container.textContent).not.toContain(LEX.accDetLoadErr[0]);

    act(() => {
      root?.unmount();
      root = createRoot(container);
      root.render(React.createElement(SectionAccuracy, accuracyProps("zh", { teamId: "t1" })));
    });
    await flushUntil(
      () => (container.textContent || "").includes(TEAM_ROUTE_MESSAGES.unavailable[1])
        || (container.textContent || "").includes(LEX.accDetLoadErr[1]),
      "503 ZH copy",
    );
    expect(container.textContent).toContain(TEAM_ROUTE_MESSAGES.unavailable[0]);
    expect(container.textContent).toContain(TEAM_ROUTE_MESSAGES.unavailable[1]);
    expect(container.textContent).not.toContain(LEX.accDetLoadErr[1]);
  });
});
