// @vitest-environment jsdom
//
// Section coverage for B-F08-6 Alert delivery. Mounts the real
// SectionAlertDelivery through react-dom/client (no @testing-library — this
// repo has none). Fetch is stubbed against the BFF route only; the section
// never talks to macro. Fixtures are static in-memory mocks; this file does
// not shell out to git.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionAlertDelivery from "@/components/settings/SectionAlertDelivery";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";
import { GUEST_IDENTITY } from "@/lib/accountIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UNAVAILABLE_EN = "Alert delivery settings are not available yet.";
const UNAVAILABLE_ZH = "提醒送达设置尚未上线。";
const SAVE_FAIL_EN = "Preferences could not be saved. Try again.";
const SAVE_FAIL_ZH = "偏好设置未能保存，请重试。";
const FIELD_EN = "That time zone isn't one we know. Pick one from the list.";
const FIELD_ZH = "无法识别该时区，请从列表中选择。";
const CAT_HOLD_EN = "A position I hold moves on real news";
const CAT_THES_EN = "A market view I'm watching starts or ends";

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

function guestProps(lang: "en" | "zh"): SectionProps {
  return {
    ...accountProps(lang),
    identity: GUEST_IDENTITY,
    email: "",
    user: null,
  };
}

type FetchCall = { url: string; method: string; body: string | null };
let fetchCalls: FetchCall[];
let getImpl: (url: string) => Promise<Response>;
let postImpl: (url: string, init: RequestInit | undefined) => Promise<Response>;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch() {
  fetchCalls = [];
  getImpl = async () => jsonRes(200, {
    ok: true,
    prefs: {},
    unset: ["alert_email_optin", "alert_categories", "tz", "quiet_hours"],
    categories_available: ["holdings_material_change", "thesis_window"],
  });
  postImpl = async () => jsonRes(200, { ok: true, prefs: {}, metadata: true, email_prefs: false });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    fetchCalls.push({ url, method, body });
    if (method === "POST") return postImpl(url, init);
    return getImpl(url);
  }));
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
    root!.render(<SectionAlertDelivery {...props} />);
  });
  await flush();
  await flush();
  return container!;
}

beforeEach(() => {
  installFetch();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("guest never fetches; signed-out copy is the existing settings key", () => {
  it("a guest does not call the BFF and shows the existing signed-out sentence", async () => {
    const el = await mount(guestProps("en"));
    expect(fetchCalls).toHaveLength(0);
    expect(el.textContent).toContain(LEX.acsSignInToOn[0]);
    expect(el.querySelector("select")).toBeNull();
  });
});

describe("loading → populated from GET 200, unset fields stay empty", () => {
  it("renders every known field from prefs and leaves unset tz/quiet-hours empty", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: {
        alert_email_optin: true,
        alert_categories: ["holdings_material_change"],
      },
      unset: ["tz", "quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    const el = await mount(accountProps("en"));
    expect(fetchCalls.some((c) => c.method === "GET" && c.url.includes("/api/account/alert-prefs"))).toBe(true);
    const tz = el.querySelector<HTMLSelectElement>('select[data-alert-field="tz"]');
    expect(tz).not.toBeNull();
    expect(tz!.value).toBe("");
    const start = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-start"]');
    const end = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-end"]');
    expect(start!.value).toBe("");
    expect(end!.value).toBe("");
    const hold = el.querySelector<HTMLButtonElement>('button[data-alert-cat="holdings_material_change"]');
    const thes = el.querySelector<HTMLButtonElement>('button[data-alert-cat="thesis_window"]');
    expect(hold?.getAttribute("aria-pressed")).toBe("true");
    expect(thes?.getAttribute("aria-pressed")).toBe("false");
    expect(el.textContent).toContain(CAT_HOLD_EN);
    expect(el.textContent).toContain(CAT_THES_EN);
  });
});

describe("GET 404/503 → exact unavailable copy, both languages, no form", () => {
  it("404 EN", async () => {
    getImpl = async () => jsonRes(404, { detail: "Not Found" });
    const el = await mount(accountProps("en"));
    expect(el.textContent).toContain(UNAVAILABLE_EN);
    expect(el.querySelector("select")).toBeNull();
    expect(el.querySelector('button[data-alert-cat]')).toBeNull();
  });

  it("503 ZH", async () => {
    getImpl = async () => jsonRes(503, { error: "gateway_unreachable" });
    const el = await mount(accountProps("zh"));
    expect(el.textContent).toContain(UNAVAILABLE_ZH);
    expect(el.querySelector("select")).toBeNull();
  });
});

describe("GET 401 → signed-out/guest branch", () => {
  it("shows the existing signed-out sentence and no form", async () => {
    getImpl = async () => jsonRes(401, { error: "unauthenticated" });
    const el = await mount(accountProps("en"));
    expect(el.textContent).toContain(LEX.acsSignInToOn[0]);
    expect(el.querySelector("select")).toBeNull();
  });
});

describe("optimistic toggle → 200 Saved, including server-applied tz default", () => {
  it("turning alerts on with no tz stored paints the server-returned tz, not a blank and not a browser guess", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false },
      unset: ["tz", "quiet_hours", "alert_categories"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC" },
      metadata: true,
      email_prefs: false,
    });
    const el = await mount(accountProps("en"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]');
    expect(onBtn).not.toBeNull();
    await act(async () => { onBtn!.click(); });
    await flush();
    const tz = el.querySelector<HTMLSelectElement>('select[data-alert-field="tz"]');
    expect(tz!.value).toBe("UTC");
    expect(el.textContent).toContain(LEX.acsPrefSaved[0]);
    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    const sent = JSON.parse(posts[0].body || "{}");
    expect(sent.alert_email_optin).toBe(true);
    expect(sent.tz).toBeUndefined();
  });
});

describe("optimistic toggle → 400 rollback + field-scoped message, both languages", () => {
  it("EN rolls the control back and shows detail.en next to the field", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(400, {
      detail: { field: "tz", en: FIELD_EN, zh: FIELD_ZH },
    });
    const el = await mount(accountProps("en"));
    const tz = el.querySelector<HTMLSelectElement>('select[data-alert-field="tz"]')!;
    expect(tz.value).toBe("UTC");
    await act(async () => {
      tz.value = "Asia/Shanghai";
      tz.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(tz.value).toBe("UTC");
    expect(el.textContent).toContain(FIELD_EN);
    expect(el.textContent).not.toContain(FIELD_ZH);
  });

  it("ZH shows detail.zh", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC" },
      unset: [],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(400, {
      detail: { field: "tz", en: FIELD_EN, zh: FIELD_ZH },
    });
    const el = await mount(accountProps("zh"));
    const tz = el.querySelector<HTMLSelectElement>('select[data-alert-field="tz"]')!;
    await act(async () => {
      tz.value = "Asia/Shanghai";
      tz.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(el.textContent).toContain(FIELD_ZH);
  });
});

describe("optimistic toggle → 502/503/throw rollback + generic copy, both languages", () => {
  it("502 EN", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false },
      unset: ["tz"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(502, { detail: "could not save preferences, please try again" });
    const el = await mount(accountProps("en"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]')!;
    await act(async () => { onBtn.click(); });
    await flush();
    expect(onBtn.getAttribute("aria-pressed")).toBe("false");
    expect(el.textContent).toContain(SAVE_FAIL_EN);
  });

  it("503 EN", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false },
      unset: ["tz"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(503, { detail: "could not save preferences, please try again" });
    const el = await mount(accountProps("en"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]')!;
    await act(async () => { onBtn.click(); });
    await flush();
    expect(onBtn.getAttribute("aria-pressed")).toBe("false");
    expect(el.textContent).toContain(SAVE_FAIL_EN);
  });

  it("throw ZH", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false },
      unset: [],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => { throw new Error("network down"); };
    const el = await mount(accountProps("zh"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]')!;
    await act(async () => { onBtn.click(); });
    await flush();
    expect(el.textContent).toContain(SAVE_FAIL_ZH);
  });
});

describe("quiet-hours debounce: two edits inside 500 ms produce exactly one POST", () => {
  it("collapses two time edits into one save", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { quiet_hours: { start: "22:00", end: "07:00" } },
      metadata: true,
      email_prefs: false,
    });
    const el = await mount(accountProps("en"));
    vi.useFakeTimers();
    const start = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-start"]')!;
    const end = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-end"]')!;
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const setInput = (el: HTMLInputElement, value: string) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      desc?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await act(async () => { setInput(start, "22:00"); });
    await act(async () => { setInput(end, "07:00"); });
    expect(fetchCalls.filter((c) => c.method === "POST")).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(500); });
    await flush();
    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body || "{}")).toEqual({
      quiet_hours: { start: "22:00", end: "07:00" },
    });
  });
});

describe("category closed-set: only the two known categories render", () => {
  it("an unknown value in GET is never a third checkbox", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: {
        alert_email_optin: true,
        alert_categories: ["holdings_material_change", "bogus_phantom", "thesis_window"],
      },
      unset: [],
      categories_available: ["holdings_material_change", "thesis_window", "bogus_phantom"],
    });
    const el = await mount(accountProps("en"));
    const cats = el.querySelectorAll("button[data-alert-cat]");
    expect(cats).toHaveLength(2);
    expect(el.querySelector('button[data-alert-cat="bogus_phantom"]')).toBeNull();
    expect(el.textContent).not.toContain("bogus_phantom");
    expect(el.textContent).toContain(CAT_HOLD_EN);
    expect(el.textContent).toContain(CAT_THES_EN);
  });
});
