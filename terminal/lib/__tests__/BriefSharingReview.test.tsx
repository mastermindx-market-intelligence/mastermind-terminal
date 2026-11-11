// @vitest-environment jsdom
//
// BriefSharingReview — the authenticated source consumer for exact single-team
// view-only sharing of one delivered brief.
//
// Real source decoders and authentication scope; only external auth/fetch/chrome are fixtures.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountIdentity } from "../accountIdentity";

const { state } = vi.hoisted(() => ({
  state: {
    identity: { kind: "guest" } as AccountIdentity,
    lang: "en" as "en" | "zh",
    authSubject: "",
    authListener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  },
}));

vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => state.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang, setLang: () => {} }) }));


vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  getUser: async () => ({ data: { user: { id: state.authSubject } }, error: null }),
  onAuthStateChange: (listener: typeof state.authListener) => { state.authListener = listener; return { data: { subscription: { unsubscribe() { if (state.authListener === listener) state.authListener = null; } } } }; },
} }) }));

import BriefSharingReview from "@/components/briefs/BriefSharingReview";

const PRINCIPAL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
const DELIVERY = "1b6f4a52-93c1-4e77-a5c3-8d1e2f4a6b80";
const TEAM = "9c858901-8a57-4791-81fe-4c455b099bc9";
const CONTENT = "aa".repeat(32);
const EFFECT = "bb".repeat(32);
const OTHER_EFFECT = "cc".repeat(32);
const SHARING_PATH = `/api/briefs/deliveries/${DELIVERY}/sharing`;

const reviewRaw = (over: Record<string, unknown> = {}) => ({
  schema: "mastermind.brief_delivery_sharing.v1",
  delivery: {
    delivery_id: DELIVERY,
    slot_asof: "2026-11-02",
    artifact_asof: "2026-11-02T20:05:00.000Z",
    content_sha256: CONTENT,
    body: {
      target: { kind: "thesis", id: "fixture-thesis", name: "NVDA cycle", version_or_asof: "2026-11-02" },
      market_read: [
        { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-11-02" },
      ],
      monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
      artifact: { name: "US session digest", asof: "2026-11-02T20:05:00.000Z" },
    },
  },
  audience: { team_id: TEAM, name: "Desk research", membership_policy: "DYNAMIC_TEAM_MEMBERSHIP" },
  eligibility: { can_share: true },
  expected_effect_sha256: EFFECT,
  grant: null,
  ...over,
});

const grantRaw = (over: Record<string, unknown> = {}) => ({
  team_id: TEAM,
  content_sha256: CONTENT,
  effect_sha256: EFFECT,
  shared_by: PRINCIPAL,
  shared_at: "2026-11-02T21:04:00.000Z",
  ...over,
});

const receiptRaw = (over: Record<string, unknown> = {}) => ({
  schema: "mastermind.brief_delivery_sharing_receipt.v1",
  delivery_id: DELIVERY,
  expected_effect_sha256: EFFECT,
  observation: "NOT_OBSERVED",
  grant: null,
  current_access: false,
  ...over,
});

const teamsBody = { teams: [{ id: TEAM, name: "Desk research", role: "member", createdAt: null }], truncated: false };

const jsonRes = (raw: unknown, status = 200) =>
  new Response(JSON.stringify(raw), { status, headers: { "content-type": "application/json" } });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;

// Overridable per-test answers for the three sharing reads.
let serveReview: () => Response = () => jsonRes(reviewRaw());
let serveReceipt: () => Response = () => jsonRes(receiptRaw());
let servePost: () => Response | Promise<Response> = () => jsonRes(reviewRaw({ grant: grantRaw() }));

function installFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://terminal.test");
    if (url.pathname === "/api/teams") return jsonRes(teamsBody);
    if (url.pathname === SHARING_PATH) {
      if (init?.method === "POST") return servePost();
      if (url.searchParams.has("expected_effect_sha256")) return serveReceipt();
      return serveReview();
    }
    return jsonRes({ ok: false, code: "unavailable" }, 503);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

type ViewProps = { principalId?: string; initialExpectedEffect?: string | null };

async function renderView(props: ViewProps = {}) {
  await act(async () => {
    root.render(
      <BriefSharingReview
        deliveryId={DELIVERY}
        principalId={props.principalId ?? PRINCIPAL}
        initialExpectedEffect={props.initialExpectedEffect ?? null}
      />,
    );
  });
  await flush();
}

async function mount(props: ViewProps = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await renderView(props);
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`missing button ${label}: ${host.textContent}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

async function chooseTeam(id: string) {
  const select = host.querySelector("select");
  if (!select) throw new Error(`missing team chooser: ${host.textContent}`);
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

const callsTo = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input).includes(url));
const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const receiptCalls = () => callsTo("expected_effect_sha256=");
const stateAttr = () => host.querySelector("[data-brief-sharing]")?.getAttribute("data-brief-sharing-state");

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  state.identity = { kind: "account", userId: PRINCIPAL, email: "display@example.test" };
  state.lang = "en";
  state.authSubject = PRINCIPAL;
  window.history.replaceState(null, "", `/briefs/${DELIVERY}/sharing`);
  serveReview = () => jsonRes(reviewRaw());
  serveReceipt = () => jsonRes(receiptRaw());
  servePost = () => jsonRes(reviewRaw({ grant: grantRaw() }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Real jsdom history underneath — the assertion is on what the component wrote.
  replaceStateSpy = vi.spyOn(window.history, "replaceState");
  installFetch();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  replaceStateSpy.mockRestore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BriefSharingReview", () => {
  it("reads teams once, reviews the chosen team, sends exactly one POST and claims the share only from the same-address receipt", async () => {
    await mount();
    // no invented panel before a source owner review exists
    expect(host.querySelector("[data-brief-sharing-artifact]")).toBeNull();
    expect(callsTo("/api/teams")).toHaveLength(1);
    expect(postCalls()).toHaveLength(0);

    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(String(callsTo("team_id=")[0]?.[0])).toBe(`${SHARING_PATH}?team_id=${TEAM}`);
    expect(host.querySelector("[data-brief-sharing-artifact]")).not.toBeNull();
    expect(host.textContent).toContain("NVDA cycle");
    expect(host.textContent).toContain(CONTENT);
    expect(host.querySelector("[data-brief-sharing-send]")).not.toBeNull();
    expect(host.textContent).toContain("Keep private");

    await click("Open brief");
    const sentence = host.querySelector("[data-brief-sharing-sentence]");
    expect(sentence?.textContent).toBe("The close held above last week's range.");

    servePost = () => jsonRes(reviewRaw({ grant: grantRaw() }));
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw(), current_access: true }));
    await click("Share with team");
    const posts = postCalls();
    expect(posts).toHaveLength(1);
    expect(String(posts[0][0])).toBe(SHARING_PATH);
    expect(JSON.parse(String(posts[0][1].body))).toEqual({
      team_id: TEAM,
      expected_content_sha256: CONTENT,
      expected_effect_sha256: EFFECT,
    });
    expect(posts[0][1].credentials).toBe("same-origin");
    expect(posts[0][1].cache).toBe("no-store");
    // the original address was carried into the page address before the send
    expect(replaceStateSpy.mock.calls.some((call) => String(call[2]).includes(`expected_effect_sha256=${EFFECT}`))).toBe(true);
    // ONE reconcile, of the SAME hash
    expect(receiptCalls()).toHaveLength(1);
    expect(String(receiptCalls()[0][0])).toBe(`${SHARING_PATH}?expected_effect_sha256=${EFFECT}`);

    expect(host.textContent).toContain("Shared with your team.");
    expect(host.textContent).toContain("Desk research");
    expect(host.textContent).toContain("US session digest");
    expect(host.textContent).toContain("The view-only grant is active for current team members.");
    expect(stateAttr()).toBe("shared");
    expect(host.querySelector(`a[href="/briefs/shared/${DELIVERY}"]`)?.textContent).toBe("Open team view");
    expect(host.querySelector("h1")?.textContent).toBe("Shared with your team.");
    expect(host.querySelector("[data-brief-sharing-artifact] h2")?.textContent).toBe("US session digest");
    // a source grant means no fresh send and no keep-private
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(host.textContent).not.toContain("Keep private");

    await flush();
    expect(postCalls()).toHaveLength(1);
    expect(receiptCalls()).toHaveLength(1);
  });

  it("keeps the send control visible but spent while a send is in flight, then never again", async () => {
    const post = deferred<Response>();
    servePost = () => post.promise;
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Share with team");
    const send = host.querySelector("[data-brief-sharing-send]");
    expect(send).not.toBeNull();
    expect(send?.hasAttribute("disabled")).toBe(true);
    expect(send?.textContent).toBe("Sharing…");
    post.resolve(jsonRes(reviewRaw({ grant: grantRaw() })));
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw(), current_access: true }));
    await flush();
    expect(host.textContent).toContain("Shared with your team.");
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(1);
  });

  it("keeps the chooser blank until a real team is chosen and never posts without one", async () => {
    await mount();
    const select = host.querySelector("select");
    expect(select?.value ?? "").toBe("");
    expect(select?.hasAttribute("disabled")).toBe(false);
    await click("Review sharing");
    expect(callsTo("team_id=")).toHaveLength(0);
    expect(postCalls()).toHaveLength(0);
    expect(host.textContent).toContain("Select a team");
  });

  it("a denied source cannot be shared and nothing is sent", async () => {
    serveReview = () => jsonRes({ ok: false, code: "denied" }, 403);
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(host.textContent).toContain("This brief can't be shared with that team from your account.");
    expect(host.querySelector("[data-brief-sharing-artifact]")).toBeNull();
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("a source that says the brief cannot be shared offers no send", async () => {
    serveReview = () => jsonRes(reviewRaw({ eligibility: { can_share: false } }));
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(host.textContent).toContain("This brief can't be shared from this page right now.");
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("a source already shared with a team offers no fresh send and no keep-private", async () => {
    serveReview = () => jsonRes(reviewRaw({ grant: grantRaw() }));
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(host.textContent).toContain("This brief is already shared.");
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(host.textContent).not.toContain("Keep private");
    expect(postCalls()).toHaveLength(0);
  });

  it("an ambiguous send keeps the original address, withholds the body and never resends", async () => {
    servePost = () => jsonRes({ ok: false, code: "unavailable" }, 503);
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Share with team");
    expect(stateAttr()).toBe("unknown");
    expect(host.textContent).toContain("We couldn't confirm what happened.");
    expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened.");
    expect(host.textContent).not.toContain("Shared with your team");
    // the body is withheld while the outcome is unknown
    expect(host.querySelector("[data-brief-sharing-toggle]")).toBeNull();
    expect(host.querySelector("[data-brief-sharing-body]")).toBeNull();
    // the original reference survives on the page address
    expect(window.location.search).toContain(`expected_effect_sha256=${EFFECT}`);
    // no retry control, and the spent send cannot be repeated
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(1);
    await click("Review sharing");
    expect(postCalls()).toHaveLength(1);
    expect(host.textContent).not.toContain("Try again");
  });

  it("an ambiguous response is settled only by the exact recorded owner receipt", async () => {
    servePost = () => { throw Error("response lost"); };
    await mount(); await chooseTeam(TEAM); await click("Review sharing");
    await click("Share with team");
    expect(host.querySelector("h1")?.textContent).toBe("We couldn't confirm what happened.");
    expect(host.textContent).not.toContain("The view-only grant is active");
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw(), current_access: true }));
    await click("Check original sharing");
    expect(host.querySelector("h1")?.textContent).toBe("Shared with your team.");
    expect(host.textContent).toContain("The view-only grant is active for current team members.");
    expect(postCalls()).toHaveLength(1); expect(receiptCalls()).toHaveLength(1);
  });

  it("an initial reference recovers by reading the original receipt only", async () => {
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw(), current_access: true }));
    await mount({ initialExpectedEffect: EFFECT });
    expect(stateAttr()).toBe("addressed");
    expect(host.textContent).toContain("Check original sharing");
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(0);
    // nothing is read automatically before the person asks
    expect(receiptCalls()).toHaveLength(0);

    await click("Check original sharing");
    expect(receiptCalls()).toHaveLength(1);
    expect(String(receiptCalls()[0][0])).toBe(`${SHARING_PATH}?expected_effect_sha256=${EFFECT}`);
    expect(host.textContent).toContain("Shared with your team.");
    expect(host.textContent).toContain("Desk research");
    expect(host.textContent).toContain("The view-only grant is active for current team members.");
    expect(postCalls()).toHaveLength(0);
    await flush();
    expect(receiptCalls()).toHaveLength(1);
  });

  it("states NOT_OBSERVED without replaying the send or re-reading on its own", async () => {
    serveReceipt = () => jsonRes(receiptRaw());
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Share with team");
    expect(postCalls()).toHaveLength(1);
    expect(host.textContent).toContain("Sharing recorded; current access not established.");
    expect(host.textContent).toContain("No sharing record is visible yet.");
    expect(host.querySelector(`a[href="/briefs/shared/${DELIVERY}"]`)).toBeNull();
    expect(host.textContent).not.toContain("Shared with your team");
    expect(receiptCalls()).toHaveLength(1);
    await flush();
    await flush();
    // no polling: still exactly one reconcile
    expect(receiptCalls()).toHaveLength(1);
    // a manual read of the same original receipt stays available, once per ask
    await click("Check original sharing");
    expect(receiptCalls()).toHaveLength(2);
  });

  it("a grant that does not match the page's own address cannot claim Shared", async () => {
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw({ effect_sha256: OTHER_EFFECT }), current_access: true }));
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Share with team");
    expect(host.textContent).not.toContain("Shared with your team");
    expect(host.textContent).toContain("Sharing recorded; current access not established.");
    expect(host.textContent).toContain("Briefs could not load right now.");
    expect(stateAttr()).toBe("recorded");
  });

  it("a matched grant without current access is not claimed as shared", async () => {
    serveReceipt = () => jsonRes(receiptRaw({ observation: "MATCHED", grant: grantRaw(), current_access: false }));
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Share with team");
    expect(host.textContent).not.toContain("Shared with your team");
    expect(host.textContent).toContain("current team access is not active");
  });

  it("rotation of the principal hides earlier content and late promises land nowhere", async () => {
    const post = deferred<Response>();
    servePost = () => post.promise;
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(host.textContent).toContain("NVDA cycle");
    await click("Share with team");

    // rotate to a different principal while the send is in flight
    state.identity = { kind: "account", userId: OTHER, email: "other@example.test" };
    await renderView({ principalId: OTHER });
    expect(host.textContent).not.toContain("NVDA cycle");
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    expect(postCalls()).toHaveLength(1);

    // the late POST resolves for the PREVIOUS principal only
    post.resolve(jsonRes(reviewRaw({ grant: grantRaw() })));
    await flush();
    await flush();
    expect(host.textContent).not.toContain("Shared with your team");
    expect(host.textContent).not.toContain("NVDA cycle");
    expect(postCalls()).toHaveLength(1);
    // Shell identity alone cannot authorize reads as another Supabase subject.
    expect(callsTo("/api/teams")).toHaveLength(1);
  });

  it("an ended session clears private content and reads nothing further", async () => {
    serveReview = () => jsonRes({ ok: false, code: "denied" }, 401);
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    expect(stateAttr()).toBe("signed-out");
    expect(host.textContent).toContain("Your session ended. Sign in to continue.");
    expect(host.textContent).not.toContain("NVDA cycle");
    expect(host.querySelector("select")).toBeNull();
    const after = fetchMock.mock.calls.length;
    await flush();
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it("a guest identity reads nothing at all", async () => {
    state.identity = { kind: "guest" };
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Sign in to share a brief.");
    expect(stateAttr()).toBe("signed-out");
  });

  it("renders the zh surface without mixing locales", async () => {
    state.lang = "zh";
    await mount();
    expect(host.textContent).toContain("分享这份简报？");
    expect(host.textContent).toContain("哪个团队可以看到这份简报？");
    expect(host.textContent).not.toContain("Share the brief?");
    expect(host.querySelector("[data-brief-sharing]")?.getAttribute("lang")).toBe("zh");
    await chooseTeam(TEAM);
    await click("查看分享状态");
    expect(host.textContent).toContain("NVDA cycle"); // source title stays source
    expect(host.textContent).toContain("与团队分享");
    expect(host.textContent).not.toContain("Share with team");
    await click("打开简报");
    const sentence = host.querySelector("[data-brief-sharing-sentence]");
    expect(sentence?.textContent).toBe("收盘守住了上周的区间。");
    expect(host.textContent).not.toContain("The close held above last week's range.");
  });

  it("renders supplied brief content as text only", async () => {
    serveReview = () =>
      jsonRes(
        reviewRaw({
          delivery: {
            delivery_id: DELIVERY,
            slot_asof: "2026-11-02",
            artifact_asof: null,
            content_sha256: CONTENT,
            body: {
              target: { kind: "thesis", id: "fixture-thesis", name: "NVDA cycle", version_or_asof: "2026-11-02" },
              market_read: [
                {
                  section: "tape",
                  sentence_en: '<img src=x onerror="alert(1)"> Close held above the range.',
                  sentence_zh: "收盘守住了上周的区间。",
                  asof: "2026-11-02",
                },
              ],
              monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
              artifact: { name: "US session digest", asof: "2026-11-02T20:05:00.000Z" },
            },
          },
        }),
      );
    await mount();
    await chooseTeam(TEAM);
    await click("Review sharing");
    await click("Open brief");
    const sentence = host.querySelector("[data-brief-sharing-sentence]");
    expect(sentence?.textContent).toBe('<img src=x onerror="alert(1)"> Close held above the range.');
    expect(sentence?.children).toHaveLength(0);
    expect(host.querySelector("img")).toBeNull();
    // a delivery with no artifact time says so, it does not invent one
    expect(host.textContent).toContain("—");
  });
  it("does not dispatch when the exact operation address cannot be retained", async () => {
    await mount(); await chooseTeam(TEAM); await click("Review sharing");
    replaceStateSpy.mockImplementation(() => { throw new DOMException("blocked"); });
    await click("Share with team");
    expect(postCalls()).toHaveLength(0);
    expect(host.textContent).toContain("Nothing was sent.");
  });

  it("auth departure aborts reads, hides content and never revives A after A→B→A", async () => {
    await mount(); await chooseTeam(TEAM); await click("Review sharing");
    const originalListener = state.authListener;
    await act(async () => { originalListener?.("SIGNED_IN", { user: { id: OTHER } }); });
    expect(host.textContent).not.toContain("NVDA cycle");
    expect(host.querySelector("select")).toBeNull();
    const before = fetchMock.mock.calls.length;
    await act(async () => { originalListener?.("SIGNED_IN", { user: { id: PRINCIPAL } }); });
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(host.querySelector("select")).toBeNull();
  });

  it("a retained URL address survives a fresh mount and offers only original reconciliation", async () => {
    await mount(); await chooseTeam(TEAM); await click("Review sharing");
    servePost = () => { throw Error("lost response"); };
    await click("Share with team");
    await act(async () => { root.unmount(); }); root = createRoot(host);
    await renderView();
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
    await click("Check original sharing");
    expect(postCalls()).toHaveLength(1);
    expect(receiptCalls()).toHaveLength(1);
  });

  it("duplicate retained addresses fail closed without any sharing reads or sends", async () => {
    window.history.replaceState(null, "", `/briefs/${DELIVERY}/sharing?expected_effect_sha256=${EFFECT}&expected_effect_sha256=${EFFECT}`);
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector("select")).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("changing the team masks the former review and aborts its late result", async () => {
    const late = deferred<Response>();
    serveReview = () => late.promise as unknown as Response;
    await mount(); await chooseTeam(TEAM); await click("Review sharing");
    await chooseTeam("");
    late.resolve(jsonRes(reviewRaw())); await flush();
    expect(host.textContent).not.toContain("NVDA cycle");
    expect(host.querySelector("[data-brief-sharing-send]")).toBeNull();
  });

});
