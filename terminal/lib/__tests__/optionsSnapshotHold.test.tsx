// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOptionsSnapshot } from "@/components/options-companion/useOptionsSnapshot";

const { fetchSnapshot } = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: fetchSnapshot, flowGetFresh: fetchSnapshot }));

const asData = (data: unknown) => ({ status: "data" as const, data });

type Hold = { active: boolean; key: (data: unknown) => string | null };
type Row = { data: unknown; status: string; pending: unknown; active: boolean | null };

function keyOf(data: unknown): string | null {
  if (data !== null && typeof data === "object" && "k" in data && typeof (data as { k: unknown }).k === "string") {
    return (data as { k: string }).k;
  }
  return null;
}

const committed: Row[] = [];

function Probe({ feed, hold }: { feed: string; hold?: Hold }) {
  const s = useOptionsSnapshot(feed, hold);
  const pending = "pending" in s ? s.pending : "MISSING";
  const view = {
    data: s.data,
    status: s.status,
    loading: s.loading,
    failed: s.failed,
    pending,
    hasApply: typeof s.applyPending === "function",
  };
  useEffect(() => {
    committed.push({ data: s.data, status: s.status, pending, active: hold ? hold.active : null });
  });
  return (
    <div>
      <output>{JSON.stringify(view)}</output>
      <button type="button" data-testid="apply" onClick={() => { if (typeof s.applyPending === "function") s.applyPending(); }}>Apply</button>
      <button type="button" data-testid="refresh" onClick={s.refresh}>Refresh</button>
    </div>
  );
}

let element: HTMLDivElement;
let root: Root;

beforeEach(() => {
  committed.length = 0;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  fetchSnapshot.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
});

const output = () => JSON.parse(element.querySelector("output")!.textContent!) as {
  data: { k?: string; v?: number } | null;
  status: string;
  loading: boolean;
  failed: boolean;
  pending: { key: string; data: unknown } | null | "MISSING";
  hasApply: boolean;
};

async function render(feed: string, hold?: Hold) {
  await act(async () => { root.render(<Probe feed={feed} hold={hold} />); });
}

async function click(id: "apply" | "refresh") {
  await act(async () => { element.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(); });
}

const A = { k: "A", v: 1 };
const B = { k: "B", v: 2 };
const C = { k: "C", v: 3 };
const holdOn = (key: Hold["key"] = keyOf): Hold => ({ active: true, key });

describe("useOptionsSnapshot hold", () => {
  it("(l) no hold replaces data, pending stays null, and the read count matches today", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B));
    await render("matrix:NVDA");
    expect(output()).toMatchObject({ data: A, status: "data", loading: false, failed: false, pending: null, hasApply: true });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await click("refresh");
    expect(output()).toMatchObject({ data: B, status: "data", pending: null, loading: false, failed: false });
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await click("apply");
    expect(output().data).toEqual(B);
    expect(output().pending).toBeNull();
  });

  it("(m) a new key while holding stays pending until applyPending", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B));
    await render("matrix:NVDA", holdOn());
    expect(output().data).toEqual(A);
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().status).toBe("data");
    expect(output().pending).toEqual({ key: "B", data: B });
    await click("apply");
    expect(output().data).toEqual(B);
    expect(output().pending).toBeNull();
    expect(output().status).toBe("data");
  });

  it("(n) a read whose key equals the displayed one clears pending", async () => {
    const again = { k: "A", v: 4 };
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B)).mockResolvedValueOnce(asData(again));
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    await click("refresh");
    expect(output().data).toEqual(again);
    expect(output().pending).toBeNull();
    expect(output().status).toBe("data");
  });

  it("(o) a third key replaces pending", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B)).mockResolvedValueOnce(asData(C));
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().pending).toEqual({ key: "B", data: B });
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "C", data: C });
  });

  it("(p) a null key replaces the displayed data", async () => {
    const unkeyed = { v: 9 };
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B)).mockResolvedValueOnce(asData(unkeyed));
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    await click("refresh");
    expect(output().data).toEqual(unkeyed);
    expect(output().pending).toBeNull();
  });

  it("(q) ending the hold applies pending in that render", async () => {
    const key = keyOf;
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValueOnce(asData(B));
    await render("matrix:NVDA", { active: true, key });
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    const calls = fetchSnapshot.mock.calls.length;
    const before = committed.length;
    await render("matrix:NVDA", { active: false, key });
    const flips = committed.slice(before).filter((row) => row.active === false);
    expect(flips.length).toBeGreaterThan(0);
    expect(flips[0].data).toEqual(B);
    expect(flips[0].pending).toBeNull();
    expect(flips[0].status).toBe("data");
    expect(flips.every((row) => row.pending === null && (row.data as { k: string }).k === "B")).toBe(true);
    expect(output().data).toEqual(B);
    expect(output().pending).toBeNull();
    expect(fetchSnapshot).toHaveBeenCalledTimes(calls);
  });

  it("(r) a feed change discards pending", async () => {
    fetchSnapshot.mockImplementation(async (feed: string) => {
      if (feed === "matrix:AMD") return asData({ k: "AMD", v: 9 });
      const n = fetchSnapshot.mock.calls.filter((call) => call[0] === "matrix:NVDA").length;
      return asData(n <= 1 ? A : B);
    });
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    await render("matrix:AMD", holdOn());
    expect(output().pending).toBeNull();
    expect(output().data).toEqual({ k: "AMD", v: 9 });
    expect(output().data).not.toEqual(B);
  });

  it("(s) a new key function on each render does not read again", async () => {
    fetchSnapshot.mockResolvedValueOnce(asData(A)).mockResolvedValue(asData(B));
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    const calls = fetchSnapshot.mock.calls.length;
    for (let i = 0; i < 5; i += 1) {
      const gen = i + 1;
      await render("matrix:NVDA", {
        active: true,
        key: (data) => {
          const base = keyOf(data);
          return base == null ? null : `${base}#${gen}`;
        },
      });
    }
    expect(fetchSnapshot).toHaveBeenCalledTimes(calls);
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
  });

  it("(t) an unavailable read while holding keeps data and pending", async () => {
    fetchSnapshot
      .mockResolvedValueOnce(asData(A))
      .mockResolvedValueOnce(asData(B))
      .mockResolvedValueOnce({ status: "unavailable", reason: "server" });
    await render("matrix:NVDA", holdOn());
    await click("refresh");
    expect(output().pending).toEqual({ key: "B", data: B });
    await click("refresh");
    expect(output().data).toEqual(A);
    expect(output().pending).toEqual({ key: "B", data: B });
    expect(output().status).toBe("unavailable");
    expect(output().failed).toBe(true);
  });
});
