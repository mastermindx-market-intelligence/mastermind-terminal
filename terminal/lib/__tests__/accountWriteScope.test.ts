/**
 * B-F08-7b — the Terminal write fence.
 *
 * The Terminal already writes key-scoped at the top level. This suite turns that from an
 * observed property into an invariant a test can falsify: a user_metadata patch never names a
 * key the Terminal does not own, even if a caller passes one, and every existing
 * `auth.updateUser({ data })` site routes through the fence.
 *
 * Fixtures are static in-memory mocks. Nothing here shells out to git.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  TERMINAL_WRITE_KEYS, scopeAccountWrite, sendScopedAccountWrite,
} from "@/lib/accountPrefs";
import { DEFAULT_PREFS, serializeMarketPrefs, type MarketPrefs } from "@/lib/markets";

// ── store mocks (same impure edges as marketPrefsOwner.test.ts) ───────────────────────────

type GetUserResult = { data: { user: unknown }; error: unknown };
let getUser: () => Promise<GetUserResult> = async () => ({ data: { user: null }, error: new Error("unset") });
const updates: Record<string, unknown>[] = [];
let remote: Record<string, unknown> = {};
let updateResult: () => Promise<{ error?: unknown }> = async () => ({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => getUser(),
      updateUser: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(remote, data);
        updates.push({ ...data });
        return updateResult();
      },
    },
  }),
}));
vi.mock("@/lib/i18n", () => ({ applyLang: vi.fn() }));

import { ownerKeyFor } from "@/lib/accountIdentity";
import {
  __loadOwner, __persistMarketsForTest, __resetMarketPrefsStore,
  persistLang, persistMetaPrefs, persistStartTf, persistTradeTypes, persistUpDown,
} from "@/lib/useMarketPrefs";

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const OWNER_A = ownerKeyFor(UUID_A);

const ALERT_SEED = {
  alert_email_optin: true,
  alert_categories: ["thesis_window"],
  tz: "Asia/Shanghai",
  quiet_hours: { start: "22:00", end: "07:00" },
} as const;

const ALERT_KEYS = [
  "alert_email_optin",
  "alert_categories",
  "tz",
  "quiet_hours",
] as const;

const ONBOARDING_PAYLOAD = {
  first_name: "Ada",
  last_name: "Lovelace",
  market_focus: ["us", "hk"],
  trade_types: ["stocks"],
  theme_pref: "dark",
  onboarded_at: "2026-08-19T00:00:00.000Z",
};

const userWith = (id: string, meta: Record<string, unknown>) => ({
  data: { user: { id, user_metadata: meta } }, error: null,
});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  updates.length = 0;
  remote = {};
  updateResult = async () => ({ error: null });
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const attrs: Record<string, string> = {};
  g.document = {
    documentElement: {
      getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
    },
  };
  g.window = { dispatchEvent: () => true };
  g.CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  __resetMarketPrefsStore();
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.localStorage; delete g.document; delete g.window; delete g.CustomEvent;
});

const OWNED = [
  "market_focus", "markets", "terminal", "theme", "theme_auto", "lang", "prefs",
  "trade_types", "display_name", "first_name", "last_name", "theme_pref", "onboarded_at",
] as const;

const FORBIDDEN = ["alert_email_optin", "alert_categories", "tz", "quiet_hours", "brain_depth"] as const;

describe("TERMINAL_WRITE_KEYS is today's write set and nothing else", () => {
  it("contains every key the Terminal already writes, and none of the alert or brain keys", () => {
    expect([...TERMINAL_WRITE_KEYS]).toEqual([...OWNED]);
    for (const key of FORBIDDEN) expect(TERMINAL_WRITE_KEYS).not.toContain(key);
  });
});

describe("§2.5.1 the contract test", () => {
  it("keeps lang and drops the four alert keys even when a caller passes them", () => {
    const { data, dropped } = scopeAccountWrite({
      lang: "zh",
      alert_email_optin: true,
      tz: "Asia/Shanghai",
      quiet_hours: { start: "22:00", end: "07:00" },
      alert_categories: ["thesis_window"],
    });
    expect(data).toEqual({ lang: "zh" });
    expect(dropped.sort()).toEqual([...ALERT_KEYS].sort());
  });

  it("never sends unknown keys the Terminal never owned", () => {
    const { data, dropped } = scopeAccountWrite({
      lang: "zh",
      brain_depth: "concise",
      not_a_terminal_key: 1,
    });
    expect(data).toEqual({ lang: "zh" });
    expect(dropped.sort()).toEqual(["brain_depth", "not_a_terminal_key"]);
  });
});

describe("§2.5.2 preserving unknown alert keys, end to end", () => {
  it("a persistLang write leaves macro's four alert values byte-identical", async () => {
    const seed = {
      alert_email_optin: true,
      alert_categories: ["thesis_window"],
      tz: "Asia/Shanghai",
      quiet_hours: { start: "22:00", end: "07:00" },
    };
    remote = { ...seed, quiet_hours: { ...seed.quiet_hours } };
    getUser = async () => userWith(UUID_A, { ...remote });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;

    persistLang("zh");
    await settle();

    expect(remote.lang).toBe("zh");
    expect(remote.alert_email_optin).toBe(seed.alert_email_optin);
    expect(remote.alert_categories).toEqual(seed.alert_categories);
    expect(remote.tz).toBe(seed.tz);
    expect(JSON.stringify(remote.quiet_hours)).toBe(JSON.stringify(seed.quiet_hours));
    for (const u of updates) {
      for (const key of ALERT_KEYS) expect(u).not.toHaveProperty(key);
    }
  });
});

describe("§2.5.3 every existing pump write stays whole", () => {
  async function loadEmptyAccount() {
    getUser = async () => userWith(UUID_A, {
      terminal: { start_tf: "D", updown: "west" },
      prefs: { theme: "dark", themeAuto: "0" },
    });
    __loadOwner(OWNER_A);
    await settle();
    updates.length = 0;
  }

  function expectUnscoped(sent: Record<string, unknown>) {
    const scoped = scopeAccountWrite(sent);
    expect(scoped.dropped).toEqual([]);
    expect(scoped.data).toEqual(sent);
  }

  it("persistMarkets without follows still sends markets only", async () => {
    await loadEmptyAccount();
    const next: MarketPrefs = {
      ...DEFAULT_PREFS,
      enabled: ["us", "crypto"],
      autoNarrowed: false,
    };
    __persistMarketsForTest(next, false);
    await settle();
    const expected = serializeMarketPrefs(next);
    expect(updates[0]).toEqual(expected);
    expectUnscoped(updates[0]);
  });

  it("persistMarkets with follows still sends market_focus and markets", async () => {
    await loadEmptyAccount();
    const next: MarketPrefs = {
      home: "us",
      enabled: ["us", "hk", "crypto"],
      autoNarrowed: false,
      followed: ["us", "hk"],
    };
    __persistMarketsForTest(next, true);
    await settle();
    const expected = { market_focus: next.followed, ...serializeMarketPrefs(next) };
    expect(updates[0]).toEqual(expected);
    expectUnscoped(updates[0]);
  });

  it("persistStartTf still sends the whole terminal blob", async () => {
    await loadEmptyAccount();
    persistStartTf("W");
    await settle();
    expect(updates[0]).toEqual({ terminal: { start_tf: "W", updown: "west" } });
    expectUnscoped(updates[0]);
  });

  it("persistUpDown still sends the whole terminal blob", async () => {
    await loadEmptyAccount();
    persistUpDown("east");
    await settle();
    expect(updates[0]).toEqual({ terminal: { start_tf: "D", updown: "east" } });
    expectUnscoped(updates[0]);
  });

  it("persistMetaPrefs still dual-writes the atomics and the nested prefs blob", async () => {
    await loadEmptyAccount();
    persistMetaPrefs({ lang: "zh" });
    await settle();
    expect(updates[0]).toEqual({
      lang: "zh",
      prefs: { theme: "dark", themeAuto: "0", lang: "zh" },
    });
    expectUnscoped(updates[0]);
  });

  it("persistTradeTypes still sends trade_types", async () => {
    await loadEmptyAccount();
    persistTradeTypes(["stocks", "options"]);
    await settle();
    expect(updates[0]).toEqual({ trade_types: ["stocks", "options"] });
    expectUnscoped(updates[0]);
  });
});

describe("§2.5.4 the onboarding payload survives scoping", () => {
  it("all six keys from OnboardingSheet pass through untouched", () => {
    const { data, dropped } = scopeAccountWrite(ONBOARDING_PAYLOAD);
    expect(dropped).toEqual([]);
    expect(data).toEqual(ONBOARDING_PAYLOAD);
  });
});

describe("§2.5.5 display_name survives, and an empty scoped patch is never sent", () => {
  it("display_name survives scoping", () => {
    const { data, dropped } = scopeAccountWrite({ display_name: "Ada" });
    expect(dropped).toEqual([]);
    expect(data).toEqual({ display_name: "Ada" });
  });

  it("a patch that scopes to empty is never sent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(async () => ({ error: null }));
    const result = await sendScopedAccountWrite(send, {
      alert_email_optin: true,
      tz: "UTC",
      brain_depth: "concise",
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a mixed patch is sent without the alert keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(async (data: Record<string, unknown>) => {
      expect(data).toEqual({ lang: "zh" });
      return { error: null };
    });
    await sendScopedAccountWrite(send, { lang: "zh", ...ALERT_SEED });
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("every user_metadata write site is wrapped by the fence", () => {
  const TERMINAL_ROOT = join(__dirname, "..", "..");
  const SKIP_DIRS = new Set([
    "node_modules", ".next", "__tests__", "proof", "e2e", "docs", "public", "test-fixtures",
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("each auth.updateUser({ data }) call sits behind sendScopedAccountWrite or scopeAccountWrite", () => {
    const files = walk(TERMINAL_ROOT);
    const hits: { file: string; wrapped: boolean }[] = [];
    const dataWrite = /auth\.updateUser\(\{\s*data/;
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      let from = 0;
      while (from < stripped.length) {
        const idx = stripped.slice(from).search(dataWrite);
        if (idx < 0) break;
        const abs = from + idx;
        const window = stripped.slice(Math.max(0, abs - 400), abs);
        hits.push({
          file: relative(TERMINAL_ROOT, file),
          wrapped: /scopeAccountWrite|sendScopedAccountWrite/.test(window),
        });
        from = abs + 1;
      }
    }
    expect(hits.map((h) => h.file).sort()).toEqual([
      "components/onboarding/OnboardingProvider.tsx",
      "components/onboarding/OnboardingSheet.tsx",
      "components/settings/SectionAccount.tsx",
      "lib/useMarketPrefs.ts",
    ]);
    for (const hit of hits) expect(hit.wrapped, hit.file).toBe(true);
  });
});
