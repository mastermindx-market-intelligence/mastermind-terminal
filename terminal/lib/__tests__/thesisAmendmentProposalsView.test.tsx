// @vitest-environment jsdom
//
// B-F11-5 Suggested changes section — EN/ZH ceiling sentence, empty state, and
// populated accept/reject chips. Mounts the real ThesisWorkspace (no @testing-library).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";
import { LangProvider, applyLang } from "@/lib/i18n";
import type { ThesisDetail, ThesisSubjectRef, ThesisSummary, ThesisVersion } from "@/lib/theses";
import { THESIS_CONTENT_SCHEMA, THESIS_SUBJECT_SCHEMA } from "@/lib/theses";
import type { ProposalRow } from "@/lib/thesisAmendmentProposals";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THESIS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function subject(key: string, display: string): ThesisSubjectRef {
  return {
    schema: THESIS_SUBJECT_SCHEMA,
    kind: "issuer",
    owner: "data_os.security_master",
    key,
    identityState: "resolved",
    display,
  };
}

function content(): ThesisVersion["content"] {
  return {
    schema: THESIS_CONTENT_SCHEMA,
    title: "NVDA operating leverage",
    statement: "Demand will outrun supply.",
    catalysts: [],
    falsifiers: [],
    risks: [],
    horizon: "quarters",
    effectiveAt: null,
    revisionNote: null,
  };
}

function summary(): ThesisSummary {
  return {
    id: THESIS_ID,
    currentVersion: 2,
    lifecycleState: "active",
    subject: subject("NVDA", "NVIDIA"),
    title: "NVDA operating leverage",
    updatedAt: "2026-09-10T08:00:00.000Z",
  };
}

function detail(): ThesisDetail {
  const s = summary();
  const current: ThesisVersion = {
    id: VERSION_ID,
    thesisId: s.id,
    version: 2,
    previousVersion: 1,
    transition: "revise",
    lifecycleState: "active",
    subject: s.subject,
    content: content(),
    clientRequestId: "cr-1",
    systemRecordedAt: s.updatedAt,
    effectiveAt: null,
  };
  return { ...s, createdAt: "2026-01-01T00:00:00.000Z", current, history: [current], historyTruncated: false };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function proposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    proposalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    thesisId: THESIS_ID,
    amendedFrom: VERSION_ID,
    body: "Name the demand that has to keep compounding.",
    evidenceRefs: [],
    proposedBy: "assistant",
    state: "proposed",
    createdAt: "2026-09-12T12:00:00.000Z",
    versionNumber: 2,
    versionRecordedAt: "2026-09-10T08:00:00.000Z",
    ...overrides,
  };
}

function installFetch(rows: ProposalRow[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const url = new URL(raw, "https://x.test");
    if (url.pathname === "/api/thesis-saved-views") return jsonResponse({ views: [] });
    if (url.pathname === "/api/thesis-fire-status") return jsonResponse({ states: {} });
    if (url.pathname === `/api/thesis/${THESIS_ID}/proposals`) {
      if ((input as Request).method === "POST") {
        return jsonResponse({ proposal: proposal() }, 201);
      }
      return jsonResponse({ proposals: rows });
    }
    if (url.pathname !== "/api/theses") return jsonResponse({ error: "not_found" }, 404);
    if (url.searchParams.get("id") === THESIS_ID) return jsonResponse({ thesis: detail() });
    return jsonResponse({ theses: [summary()], truncated: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(lang: "en" | "zh") {
  container = document.createElement("div");
  document.body.appendChild(container);
  document.documentElement.setAttribute("data-lang", lang);
  applyLang(lang);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LangProvider>
        <ThesisWorkspace ownerKey="owner-proposals" initialThesisId={THESIS_ID} />
      </LangProvider>,
    );
  });
  await flush();
  await flush();
  return container;
}

beforeEach(() => {
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) {
    Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
    Object.defineProperty(window, "sessionStorage", { value: dom.window.sessionStorage, configurable: true, writable: true });
  }
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ThesisWorkspace suggested changes (B-F11-5)", () => {
  it("EN empty state renders the ceiling sentence and the empty line", async () => {
    installFetch([]);
    const el = await mount("en");
    const section = el.querySelector('[data-testid="thesis-proposals"]');
    expect(section, "suggested-changes section missing").toBeTruthy();
    expect(section!.textContent).toContain("Suggested changes");
    expect(el.querySelector('[data-testid="thesis-proposals-ceiling"]')!.textContent)
      .toBe("The assistant can suggest a change to your thesis. Only you can publish one.");
    expect(el.querySelector('[data-testid="thesis-proposals-empty"]')!.textContent)
      .toBe("No suggested changes yet.");
    expect(el.querySelector('[data-testid="thesis-suggest-amendment"]')!.textContent)
      .toBe("Suggest as a change to this thesis");
    expect(section!.textContent).not.toMatch(/falsifier|refuted|证伪/i);
  });

  it("ZH empty state renders the real Chinese ceiling sentence", async () => {
    installFetch([]);
    const el = await mount("zh");
    expect(el.querySelector('[data-testid="thesis-proposals-ceiling"]')!.textContent)
      .toBe("助手可以建议你修改论点。只有你能发布新版本。");
    expect(el.querySelector('[data-testid="thesis-proposals-empty"]')!.textContent)
      .toBe("目前还没有建议的修改。");
    expect(el.querySelector('[data-testid="thesis-suggest-amendment"]')!.textContent)
      .toBe("建议将这段文字作为对此论点的修改");
    expect(el.textContent).not.toMatch(/falsifier|refuted|证伪/);
  });

  it("EN populated row names the version in a plain sentence and offers Accept / Reject", async () => {
    installFetch([proposal()]);
    const el = await mount("en");
    const row = el.querySelector('[data-testid="thesis-proposal-row"]');
    expect(row, "proposal row missing").toBeTruthy();
    expect(row!.textContent).toContain("Name the demand that has to keep compounding.");
    expect(row!.textContent).toMatch(/Based on version 2 from /);
    expect(row!.textContent).toContain("Suggested");
    const buttons = Array.from(row!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Accept");
    expect(buttons).toContain("Reject");
    expect(row!.textContent).not.toMatch(/\bproposed\b/);
  });

  it("ZH populated row uses a plain Chinese version sentence and state chip", async () => {
    installFetch([proposal()]);
    const el = await mount("zh");
    const row = el.querySelector('[data-testid="thesis-proposal-row"]');
    // Q3 (Round-1 heal): ZH version sentence now uses the ordinal 第.
    expect(row!.textContent).toMatch(/依据第 2 版，日期为 /);
    expect(row!.textContent).not.toMatch(/依据 2 版/);
    expect(row!.textContent).toContain("已建议");
    const buttons = Array.from(row!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("接受");
    expect(buttons).toContain("拒绝");
  });

  // Q2 (Round-1 heal): when the version row cannot be resolved, the sentence says so
  // plainly — it never invents a "version 0" or an "unknown date".
  it("EN unresolved version renders the plain 'couldn't find any more' sentence", async () => {
    installFetch([proposal({ versionNumber: null, versionRecordedAt: null })]);
    const el = await mount("en");
    const row = el.querySelector('[data-testid="thesis-proposal-row"]');
    expect(row!.textContent).toContain("Based on a version of this thesis we couldn't find any more.");
    expect(row!.textContent).not.toMatch(/version 0|from an unknown date/i);
  });

  it("ZH unresolved version renders the plain 'we couldn't find' sentence", async () => {
    installFetch([proposal({ versionNumber: null, versionRecordedAt: null })]);
    const el = await mount("zh");
    const row = el.querySelector('[data-testid="thesis-proposal-row"]');
    expect(row!.textContent).toContain("依据这条论点的一个我们已找不到的版本。");
    expect(row!.textContent).not.toMatch(/0 版|未知日期/);
  });

  // H2 (Round-1 heal): the proposal state chip carries a data-state attribute equal to the
  // raw ProposalState; the visible text is the plain-word label, never the raw enum.
  it.each([
    { state: "proposed", en: "Suggested", zh: "已建议" },
    { state: "accepted", en: "Accepted", zh: "已接受" },
    { state: "rejected", en: "Declined", zh: "已拒绝" },
    { state: "superseded", en: "Replaced by a later choice", zh: "已被之后的选择替代" },
  ] as const)(
    "EN chip for state=$state carries data-state with the plain-word label",
    async ({ state, en }) => {
      installFetch([proposal({ state })]);
      const el = await mount("en");
      const chip = el.querySelector('[data-testid="thesis-proposal-row"] i');
      expect(chip, "state chip missing").toBeTruthy();
      expect(chip!.getAttribute("data-state")).toBe(state);
      expect(chip!.textContent).toBe(en);
      expect(chip!.textContent).not.toMatch(/\bproposed\b|\baccepted\b|\brejected\b|\bsuperseded\b/);
    },
  );

  it.each([
    { state: "proposed", zh: "已建议" },
    { state: "accepted", zh: "已接受" },
    { state: "rejected", zh: "已拒绝" },
    { state: "superseded", zh: "已被之后的选择替代" },
  ] as const)(
    "ZH chip for state=$state carries data-state with the plain-word label",
    async ({ state, zh }) => {
      installFetch([proposal({ state })]);
      const el = await mount("zh");
      const chip = el.querySelector('[data-testid="thesis-proposal-row"] i');
      expect(chip, "state chip missing").toBeTruthy();
      expect(chip!.getAttribute("data-state")).toBe(state);
      expect(chip!.textContent).toBe(zh);
      expect(chip!.textContent).not.toMatch(/proposed|accepted|rejected|superseded/);
    },
  );
});
