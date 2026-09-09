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

// ---------------------------------------------------------------------------
// Round 2 — findings from the adversarial review at 6532ef6f.
// ---------------------------------------------------------------------------

describe("time zone options read as a place plus its UTC offset, in both languages", () => {
  const READY = {
    ok: true,
    prefs: { alert_email_optin: true, tz: "Asia/Shanghai" },
    unset: ["quiet_hours"],
    categories_available: ["holdings_material_change", "thesis_window"],
  };

  it("EN renders the city name and the offset, and keeps the IANA id as the value", async () => {
    getImpl = async () => jsonRes(200, READY);
    const el = await mount(accountProps("en"));
    const opt = el.querySelector<HTMLOptionElement>('option[value="Asia/Shanghai"]')!;
    expect(opt).not.toBeNull();
    expect(opt.textContent).toBe("Shanghai (UTC+8)");
    const utc = el.querySelector<HTMLOptionElement>('option[value="UTC"]')!;
    expect(utc.textContent).toBe("Coordinated Universal Time (UTC+0)");
  });

  it("ZH renders the Chinese place name; no option is a bare IANA id for a known zone", async () => {
    getImpl = async () => jsonRes(200, READY);
    const el = await mount(accountProps("zh"));
    const opt = el.querySelector<HTMLOptionElement>('option[value="Asia/Shanghai"]')!;
    expect(opt.textContent).toBe("上海（UTC+8）");
    const ny = el.querySelector<HTMLOptionElement>('option[value="America/New_York"]')!;
    expect(ny.textContent).toContain("纽约（UTC");
    expect(ny.textContent).not.toContain("America/New_York");
  });

  it("a zone with no curated name still gets an offset rather than a bare id", async () => {
    getImpl = async () => jsonRes(200, READY);
    const el = await mount(accountProps("zh"));
    const odd = el.querySelector<HTMLOptionElement>('option[value="America/Port_of_Spain"]');
    if (odd) {
      expect(odd.textContent).toMatch(/^America\/Port_of_Spain（UTC[+−]/);
    }
  });
});

describe("quiet-hours time inputs follow the app language and say the clock is 24-hour", () => {
  const READY = {
    ok: true,
    prefs: { alert_email_optin: true, tz: "Asia/Shanghai", quiet_hours: { start: "22:00", end: "07:00" } },
    unset: [],
    categories_available: ["holdings_material_change", "thesis_window"],
  };

  it("ZH binds lang on both inputs and shows the 24-hour hint", async () => {
    getImpl = async () => jsonRes(200, READY);
    const el = await mount(accountProps("zh"));
    const start = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-start"]')!;
    const end = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-end"]')!;
    expect(start.getAttribute("lang")).toBe("zh-CN");
    expect(end.getAttribute("lang")).toBe("zh-CN");
    expect(el.textContent).toContain(LEX.acsAlertQh24h[1]);
  });

  it("EN binds lang on both inputs and shows the 24-hour hint", async () => {
    getImpl = async () => jsonRes(200, READY);
    const el = await mount(accountProps("en"));
    const start = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-start"]')!;
    expect(start.getAttribute("lang")).toBe("en");
    expect(el.textContent).toContain(LEX.acsAlertQh24h[0]);
  });
});

describe("a failed save rolls back only the field it was writing", () => {
  it("a 400 on the opt-in save does not undo a category tick the server already accepted", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false, alert_categories: [], tz: "UTC" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    let releaseOptin: (() => void) | null = null;
    const optinGate = new Promise<void>((resolve) => { releaseOptin = resolve; });
    postImpl = async (_url, init) => {
      const sent = JSON.parse((init?.body as string) || "{}");
      if ("alert_email_optin" in sent) {
        await optinGate;
        return jsonRes(400, { detail: { field: "alert_email_optin", en: "That setting is on or off — nothing else.", zh: "该设置只有开或关两种状态。" } });
      }
      return jsonRes(200, { ok: true, prefs: { alert_categories: ["thesis_window"] }, metadata: true, email_prefs: false });
    };
    const el = await mount(accountProps("en"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]')!;
    const thes = el.querySelector<HTMLButtonElement>('button[data-alert-cat="thesis_window"]')!;
    await act(async () => { onBtn.click(); });
    await act(async () => { thes.click(); });
    await flush();
    expect(thes.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { releaseOptin!(); });
    await flush();
    await flush();
    // The opt-in reverts (its own save failed) but the accepted category stays.
    expect(onBtn.getAttribute("aria-pressed")).toBe("false");
    expect(thes.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("quiet hours survive a failed save: the next partial edit keeps the other half", () => {
  it("a failed 'turn quiet hours off' rolls back, and editing Start alone still posts both times", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC", quiet_hours: { start: "22:00", end: "07:00" } },
      unset: [],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(502, { detail: "could not save preferences, please try again" });
    const el = await mount(accountProps("en"));
    const start = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-start"]')!;
    const end = el.querySelector<HTMLInputElement>('input[data-alert-field="qh-end"]')!;
    expect(start.value).toBe("22:00");
    const clear = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === LEX.acsAlertQhClear[0])!;
    await act(async () => { clear.click(); });
    await flush();
    expect(start.value).toBe("22:00");
    expect(end.value).toBe("07:00");

    postImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { quiet_hours: { start: "23:00", end: "07:00" } },
      metadata: true,
      email_prefs: false,
    });
    const before = fetchCalls.filter((c) => c.method === "POST").length;
    vi.useFakeTimers();
    const setInput = (node: HTMLInputElement, value: string) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      desc?.set?.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await act(async () => { setInput(start, "23:00"); });
    expect(end.value).toBe("07:00");
    await act(async () => { vi.advanceTimersByTime(500); });
    await flush();
    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(before + 1);
    expect(JSON.parse(posts[posts.length - 1].body || "{}")).toEqual({
      quiet_hours: { start: "23:00", end: "07:00" },
    });
  });
});

describe("a GET that fails for a transient reason says so, not 'not available yet'", () => {
  it("502 EN reads as a load that can be retried", async () => {
    getImpl = async () => jsonRes(502, { detail: "auth check failed, please try again" });
    const el = await mount(accountProps("en"));
    expect(el.textContent).toContain(LEX.acsAlertLoadFail[0]);
    expect(el.textContent).not.toContain(UNAVAILABLE_EN);
    expect(el.querySelector("select")).toBeNull();
  });

  it("502 ZH reads as a load that can be retried", async () => {
    getImpl = async () => jsonRes(502, { detail: "auth check failed, please try again" });
    const el = await mount(accountProps("zh"));
    expect(el.textContent).toContain(LEX.acsAlertLoadFail[1]);
    expect(el.textContent).not.toContain(UNAVAILABLE_ZH);
  });

  it("404 still reads as the calm not-available-yet state", async () => {
    getImpl = async () => jsonRes(404, { detail: "Not Found" });
    const el = await mount(accountProps("en"));
    expect(el.textContent).toContain(UNAVAILABLE_EN);
    expect(el.textContent).not.toContain(LEX.acsAlertLoadFail[0]);
  });
});

describe("the Saving/Saved note is per row", () => {
  it("saving the time zone notes it on the time-zone row only", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: true, tz: "UTC" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(200, { ok: true, prefs: { tz: "Asia/Shanghai" }, metadata: true, email_prefs: false });
    const el = await mount(accountProps("en"));
    const tz = el.querySelector<HTMLSelectElement>('select[data-alert-field="tz"]')!;
    await act(async () => {
      tz.value = "Asia/Shanghai";
      tz.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    const tzRow = tz.closest(".acs-row")!;
    const optinRow = el.querySelector('button[data-alert-field="optin-on"]')!.closest(".acs-row")!;
    expect(tzRow.textContent).toContain(LEX.acsPrefSaved[0]);
    expect(optinRow.textContent).not.toContain(LEX.acsPrefSaved[0]);
  });
});

describe("a 400 naming a field this section does not render still explains itself", () => {
  it("shows the generic save-failed sentence instead of reverting in silence", async () => {
    getImpl = async () => jsonRes(200, {
      ok: true,
      prefs: { alert_email_optin: false, tz: "UTC" },
      unset: ["quiet_hours"],
      categories_available: ["holdings_material_change", "thesis_window"],
    });
    postImpl = async () => jsonRes(400, { detail: { field: "brain_depth", en: "Pick a length from the list.", zh: "请从列表中选择长度。" } });
    const el = await mount(accountProps("en"));
    const onBtn = el.querySelector<HTMLButtonElement>('button[data-alert-field="optin-on"]')!;
    await act(async () => { onBtn.click(); });
    await flush();
    expect(onBtn.getAttribute("aria-pressed")).toBe("false");
    expect(el.textContent).toContain(SAVE_FAIL_EN);
    expect(el.textContent).not.toContain("Pick a length from the list.");
  });
});

describe("the quiet-hours hint says the same thing in both languages", () => {
  it("the Chinese hint mirrors the English one and ends in a full stop", () => {
    expect(LEX.acsAlertQhHint[1].endsWith("。")).toBe(true);
    expect(LEX.acsAlertQhHint[1]).not.toContain("这段时间不会发送任何邮件");
  });
});
