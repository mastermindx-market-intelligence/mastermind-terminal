// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
// Browser Storage boundary: Node26 global webstorage is undefined in Vitest2 jsdom setup.
const storageWindow = new JSDOM("", { url: "https://fixture.mastermind.test" }).window;
const browserStorage = storageWindow.localStorage;
import { applyScriptWriteReceipt, listScripts, publishRenameOutcome, renameScript, runRenameScriptClick, saveScript, type UserScript } from "@/lib/userScripts";

const TOKEN = "2026-10-06T12:00:00.123Z";

const GUEST_A = {
  id: "g_keep",
  name: "Keep Me",
  source: "// keep",
  lang: "pine",
  params: { n: 1 },
  updated_at: "2026-10-06T10:00:00.000Z",
};
const GUEST_B = {
  id: "g_rename",
  name: "Old Name",
  source: "// rename-me",
  lang: "pine",
  params: { n: 2 },
  updated_at: "2026-10-06T11:00:00.000Z",
};

describe("userScripts rename payload and guest store", () => {
  const fetches: Array<{ url: string; body: any }> = [];

  beforeEach(() => {
    fetches.length = 0;
    vi.stubGlobal("localStorage", browserStorage);
    browserStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetches.push({ url, body });
      return new Response(JSON.stringify({ ok: true, id: body?.id ?? "new-1", updated_at: "2026-10-06T12:00:01.000Z" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    browserStorage.clear();
  });

  it("logged-in rename POSTs the row's observed updated_at as expected_updated_at exact token", async () => {
    const ok = await renameScript(true, {
      id: "script-a",
      name: "Renamed Momentum",
      source: "//@version=6\nplot(close)\n",
      params: { len: 14 },
      updated_at: TOKEN,
    });
    expect(ok != null).toBe(true);
    expect(ok && ok.id).toBe("script-a");
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("/api/scripts/save");
    expect(fetches[0].body).toEqual({
      id: "script-a",
      name: "Renamed Momentum",
      source: "//@version=6\nplot(close)\n",
      params: { len: 14 },
      expected_updated_at: TOKEN,
    });
    expect(fetches[0].body.expected_updated_at).toBe(TOKEN);
    expect(Object.prototype.hasOwnProperty.call(fetches[0].body, "expected_updated_at")).toBe(true);
  });

  it("logged-in update does not invent a CAS token when updated_at is omitted", async () => {
    const id = await saveScript(true, {
      id: "script-a",
      name: "A",
      source: "plot(1)",
      params: {},
    });
    expect(id && id.id).toBe("script-a");
    expect(fetches).toHaveLength(1);
    expect(fetches[0].body.id).toBe("script-a");
    expect(fetches[0].body).not.toHaveProperty("expected_updated_at");
  });

  it("guest rename never fetches and preserves other localStorage scripts", async () => {
    localStorage.setItem("mm.guestScripts", JSON.stringify([GUEST_A, GUEST_B]));
    const ok = await renameScript(false, {
      id: GUEST_B.id,
      name: "New Name",
      source: GUEST_B.source,
      params: GUEST_B.params,
      updated_at: GUEST_B.updated_at,
    });
    expect(ok != null).toBe(true);
    expect(ok && ok.id).toBe(GUEST_B.id);
    expect(fetches).toHaveLength(0);
    const lib = await listScripts(false);
    expect(lib.status).toBe("ok");
    if (lib.status !== "ok") return;
    expect(lib.scripts).toHaveLength(2);
    const kept = lib.scripts.find((s) => s.id === GUEST_A.id);
    const renamed = lib.scripts.find((s) => s.id === GUEST_B.id);
    expect(kept).toEqual(GUEST_A);
    expect(renamed?.name).toBe("New Name");
    expect(renamed?.source).toBe(GUEST_B.source);
    expect(renamed?.params).toEqual(GUEST_B.params);
    expect(renamed?.id).toBe(GUEST_B.id);
  });
});

const T0 = "2026-10-06T12:00:00.000Z";
const T1 = "2026-10-06T12:00:01.000Z";
const T2 = "2026-10-06T12:00:02.000Z";

const ROW_A: UserScript = {
  id: "script-a",
  name: "Alpha",
  source: "//@version=6\nplot(close)\n",
  lang: "pine",
  params: { len: 14 },
  updated_at: T0,
};
const ROW_B: UserScript = {
  id: "script-b",
  name: "Beta",
  source: "// keep-b",
  lang: "pine",
  params: { n: 2 },
  updated_at: "2026-10-06T11:00:00.000Z",
};

describe("logged-in rename receipt consumption", () => {
  const fetches: Array<{ url: string; body: any }> = [];
  let fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  beforeEach(() => {
    fetches.length = 0;
    vi.stubGlobal("localStorage", browserStorage);
    browserStorage.clear();
    fetchImpl = async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({ ok: true, id: body?.id ?? "new-1", updated_at: T1 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetches.push({ url, body });
      return fetchImpl(input, init);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    browserStorage.clear();
  });

  it("two consecutive logged-in updates send the last validated receipt token, not the mount stamp", async () => {
    const stamps = [T1, T2];
    let n = 0;
    fetchImpl = async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({ ok: true, id: body.id, updated_at: stamps[n++] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };

    let scripts: UserScript[] = [{ ...ROW_A }, { ...ROW_B }];
    const setScripts = (up: (list: UserScript[]) => UserScript[]) => { scripts = up(scripts); };

    await runRenameScriptClick(true, scripts[0], "Alpha One", setScripts);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("/api/scripts/save");
    expect(fetches[0].body.expected_updated_at).toBe(T0);
    expect(fetches[0].body.id).toBe("script-a");
    expect(fetches[0].body.name).toBe("Alpha One");
    expect(scripts[0].updated_at).toBe(T1);
    expect(scripts[0].name).toBe("Alpha One");
    expect(scripts[0].source).toBe(ROW_A.source);
    expect(scripts[1]).toEqual(ROW_B);

    await runRenameScriptClick(true, scripts[0], "Alpha Two", setScripts);
    expect(fetches).toHaveLength(2);
    expect(fetches[1].body.expected_updated_at).toBe(T1);
    expect(fetches[1].body.expected_updated_at).not.toBe(T0);
    expect(fetches[1].body.name).toBe("Alpha Two");
    expect(scripts[0].updated_at).toBe(T2);
    expect(scripts[0].name).toBe("Alpha Two");
    expect(scripts[0].source).toBe(ROW_A.source);
    expect(scripts[0].params).toEqual(ROW_A.params);
    expect(scripts[1]).toEqual(ROW_B);
  });

  it("malformed, missing, or wrong-id receipts are failures and preserve the old stamp", async () => {
    const cases: Array<{ label: string; body: string }> = [
      { label: "malformed json", body: "{not-json" },
      { label: "missing updated_at", body: JSON.stringify({ ok: true, id: "script-a" }) },
      { label: "missing id", body: JSON.stringify({ ok: true, updated_at: T1 }) },
      { label: "wrong id", body: JSON.stringify({ ok: true, id: "script-b", updated_at: T1 }) },
      { label: "unparseable stamp", body: JSON.stringify({ ok: true, id: "script-a", updated_at: "not-a-stamp" }) },
      { label: "date-only stamp", body: JSON.stringify({ ok: true, id: "script-a", updated_at: "2026-10-06" }) },
      { label: "timezone-less stamp", body: JSON.stringify({ ok: true, id: "script-a", updated_at: "2026-10-06T12:00:01.000" }) },
    ];
    for (const rec of cases) {
      fetches.length = 0;
      fetchImpl = async () => new Response(rec.body, { status: 200, headers: { "Content-Type": "application/json" } });
      let scripts: UserScript[] = [{ ...ROW_A }, { ...ROW_B }];
      const setScripts = (up: (list: UserScript[]) => UserScript[]) => { scripts = up(scripts); };
      await runRenameScriptClick(true, scripts[0], `Renamed ${rec.label}`, setScripts);
      expect(fetches, rec.label).toHaveLength(1);
      expect(fetches[0].body.expected_updated_at, rec.label).toBe(T0);
      expect(scripts[0].updated_at, rec.label).toBe(T0);
      expect(scripts[0].name, rec.label).toBe(ROW_A.name);
      expect(scripts[0].source, rec.label).toBe(ROW_A.source);
      expect(scripts[1], rec.label).toEqual(ROW_B);

      const helper = await saveScript(true, {
        id: ROW_A.id, name: "X", source: ROW_A.source, params: ROW_A.params, updated_at: T0,
      });
      expect(helper, rec.label).toBeNull();
    }
  });

  it("a late older receipt does not regress a newer accepted stamp or clobber another row", () => {
    const withT2 = applyScriptWriteReceipt([{ ...ROW_A, name: "Alpha Two", updated_at: T2 }, { ...ROW_B }], { id: "script-a", updated_at: T2 });
    const late = applyScriptWriteReceipt(withT2, { id: "script-a", updated_at: T1 });
    expect(late[0].updated_at).toBe(T2);
    expect(late[0].name).toBe("Alpha Two");
    expect(late[0].source).toBe(ROW_A.source);
    expect(late[1]).toEqual(ROW_B);

    const wrongRow = applyScriptWriteReceipt([{ ...ROW_A }, { ...ROW_B }], { id: "script-zzz", updated_at: T1 });
    expect(wrongRow[0]).toEqual(ROW_A);
    expect(wrongRow[1]).toEqual(ROW_B);

    const malformedApply = applyScriptWriteReceipt([{ ...ROW_A }, { ...ROW_B }], { id: "script-a", updated_at: "October 6, 2026" });
    expect(malformedApply[0].updated_at).toBe(T0);
    expect(malformedApply[0]).toEqual(ROW_A);
  });

  it("overlapping renames: later receipt wins; stale receipt cannot roll back a newer name or stamp", async () => {
    const deferred: Array<(r: Response) => void> = [];
    fetchImpl = () => new Promise<Response>((resolve) => { deferred.push(resolve); });

    let scripts: UserScript[] = [{ ...ROW_A }, { ...ROW_B }];
    const setScripts = (up: (list: UserScript[]) => UserScript[]) => { scripts = up(scripts); };

    const first = runRenameScriptClick(true, scripts[0], "First", setScripts);
    expect(scripts[0].name).toBe("First");
    const secondRow = scripts[0];
    const second = runRenameScriptClick(true, secondRow, "Second", setScripts);
    expect(scripts[0].name).toBe("Second");
    expect(fetches).toHaveLength(2);
    expect(fetches[0].body.expected_updated_at).toBe(T0);
    expect(fetches[1].body.expected_updated_at).toBe(T0);

    deferred[1](new Response(JSON.stringify({ ok: true, id: "script-a", updated_at: T2 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await second;
    expect(scripts[0].updated_at).toBe(T2);
    expect(scripts[0].name).toBe("Second");

    deferred[0](new Response(JSON.stringify({ ok: true, id: "script-a", updated_at: T1 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await first;
    expect(scripts[0].updated_at).toBe(T2);
    expect(scripts[0].name).toBe("Second");
    expect(scripts[0].source).toBe(ROW_A.source);
    expect(scripts[1]).toEqual(ROW_B);
  });

  it("409 conflict rolls back the optimistic name, keeps the old stamp, and does not retry or reread", async () => {
    fetchImpl = async () => new Response(JSON.stringify({ error: "conflict" }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
    let scripts: UserScript[] = [{ ...ROW_A }, { ...ROW_B }];
    const setScripts = (up: (list: UserScript[]) => UserScript[]) => { scripts = up(scripts); };
    await runRenameScriptClick(true, scripts[0], "Nope", setScripts);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("/api/scripts/save");
    expect(scripts[0].name).toBe(ROW_A.name);
    expect(scripts[0].updated_at).toBe(T0);
    expect(scripts[1]).toEqual(ROW_B);
  });

  it("publishRenameOutcome rolls back only the matching optimistic name", () => {
    const list: UserScript[] = [{ ...ROW_A, name: "Newer" }, { ...ROW_B }];
    const out = publishRenameOutcome(list, "script-a", "First", "Alpha", null);
    expect(out[0].name).toBe("Newer");
    expect(out[0].updated_at).toBe(T0);
    expect(out[1]).toEqual(ROW_B);
  });
});



describe("actual timestamptz receipt precision", () => {
  it("an older microsecond receipt cannot regress a newer token in the same millisecond", () => {
    const newer = "2026-10-06T12:00:01.123789Z";
    const older = "2026-10-06T12:00:01.123456Z";
    expect(Date.parse(newer)).toBe(Date.parse(older));
    expect(Date.parse(newer) < Date.parse(older)).toBe(false);
    const list = [{ ...ROW_A, updated_at: newer }];
    const after = applyScriptWriteReceipt(list, { id: ROW_A.id, updated_at: older });
    expect(after[0].updated_at).toBe(newer);
  });

  it("keeps the exact accepted token for a timezone-equivalent later-looking string", () => {
    const newer = "2026-10-06T12:00:01.123789Z";
    const olderOffset = "2026-10-06T13:00:01.123456+01:00";
    const equivalent = "2026-10-06T13:00:01.123789+01:00";
    const list = [{ ...ROW_A, updated_at: newer }];
    expect(applyScriptWriteReceipt(list, { id: ROW_A.id, updated_at: olderOffset })[0].updated_at).toBe(newer);
    expect(applyScriptWriteReceipt(list, { id: ROW_A.id, updated_at: equivalent })[0].updated_at).toBe(newer);
    const fromOlder = applyScriptWriteReceipt(
      [{ ...ROW_A, updated_at: "2026-10-06T12:00:01.123456Z" }],
      { id: ROW_A.id, updated_at: newer },
    );
    expect(fromOlder[0].updated_at).toBe(newer);
  });
});

describe("production Shell rename binding", () => {
  it("TerminalShell handleRenameScript calls runRenameScriptClick as the sole production path", () => {
    const shell = readFileSync(path.resolve(__dirname, "../../components/TerminalShell.tsx"), "utf8");
    const helpers = readFileSync(path.resolve(__dirname, "../userScripts.ts"), "utf8");
    expect(shell).toMatch(/import\s*\{[^}]*\brunRenameScriptClick\b[^}]*\}\s*from\s*"@\/lib\/userScripts"/);
    expect(shell).toMatch(/runRenameScriptClick\(\s*loggedIn,\s*s,\s*name,\s*setScripts\s*\)/);
    expect(shell).not.toMatch(/\brenScript\s*\(/);
    expect(shell).not.toMatch(/\bpublishRenameOutcome\s*\(/);
    expect(helpers).toMatch(/export function runRenameScriptClick/);
    expect(helpers).toMatch(/return renameScript\(loggedIn,/);
  });
});
