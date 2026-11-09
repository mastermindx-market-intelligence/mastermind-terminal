import { describe, expect, it } from "vitest";
import {
  applyWatchSaveResponse, beginWatchSave, composeMonitorSnapshot, reconcileWatchSave,
  type MonitorAlert, type OwnerRead,
} from "@/lib/sharedShellMonitor";
import type { ServerWatchlist } from "@/lib/watchlists";

const lists: ServerWatchlist[] = [
  { id: "one", name: "Core", position: 0, symbols: [{ symbol: "AAPL", section: "", position: 0 }] },
  { id: "two", name: "Research", position: 1, symbols: [{ symbol: "AAPL", section: "Watchlist", position: 0 }] },
];
const inventory = (data = lists): OwnerRead<ServerWatchlist[]> => ({ subjectId: "A", state: "ready", data });
const alerts: OwnerRead<MonitorAlert[]> = { subjectId: "A", state: "ready", data: [] };
const save = () => beginWatchSave({ operationId: "op1", subjectId: "A", listId: "two", symbol: "AAPL" });

describe("Monitor composition", () => {
  it("counts memberships separately from distinct symbols and preserves source data", () => {
    const result = composeMonitorSnapshot("A", inventory(), alerts);
    expect(result.membershipCount).toBe(2);
    expect(result.distinctSymbolCount).toBe(1);
    expect(result.lists).toBe(lists);
    expect(result.alerts).toEqual([]);
  });

  it("distinguishes true zero from unavailable and keeps independent alert failure visible", () => {
    const empty = composeMonitorSnapshot("A", inventory([]), { subjectId: "A", state: "unavailable" });
    expect(empty.membershipCount).toBe(0);
    expect(empty.alertState).toBe("unavailable");
    const unavailable = composeMonitorSnapshot("A", { subjectId: "A", state: "unavailable" }, alerts);
    expect(unavailable.membershipCount).toBeNull();
    expect(unavailable.distinctSymbolCount).toBeNull();
    expect(unavailable.listState).toBe("unavailable");
  });

  it.each([null, "B"])("discards old-subject payloads after transition to %s", (subject) => {
    const result = composeMonitorSnapshot(subject, inventory(), {
      subjectId: "A", state: "ready",
      data: [{ id: "private", symbol: "AAPL", active: true, created_at: "2026-10-21" }],
    });
    expect(result.lists).toEqual([]);
    expect(result.alerts).toEqual([]);
    expect(result.membershipCount).toBeNull();
  });
});

describe("Save authoritative readback", () => {
  it("does not call an accepted POST saved until the exact named-list membership reads back", () => {
    const pending = applyWatchSaveResponse(save(), "A", { operationId: "op1", outcome: "accepted" })!;
    expect(pending.status).toBe("pending");
    expect(reconcileWatchSave(pending, "A", { operationId: "op1", inventory: inventory() })?.status).toBe("confirmed");
    expect(reconcileWatchSave(pending, "A", { operationId: "op1", inventory: inventory([lists[0]]) })?.status).toBe("unknown");
  });

  it("reconciles a timeout through the same operation and leaves absent/unavailable readback unknown", () => {
    const unknown = applyWatchSaveResponse(save(), "A", { operationId: "op1", outcome: "unknown" })!;
    expect(unknown.status).toBe("unknown");
    expect(reconcileWatchSave(unknown, "A", { operationId: "op1", inventory: inventory([]) })?.status).toBe("unknown");
    expect(reconcileWatchSave(unknown, "A", { operationId: "op1", inventory: { subjectId: "A", state: "unavailable" } })?.status).toBe("unknown");
    expect(reconcileWatchSave(unknown, "A", { operationId: "op1", inventory: inventory() })?.status).toBe("confirmed");
  });

  it("preserves rejection and ignores responses/readbacks from a different operation", () => {
    expect(applyWatchSaveResponse(save(), "A", { operationId: "old", outcome: "rejected" })?.status).toBe("pending");
    expect(reconcileWatchSave(save(), "A", { operationId: "old", inventory: inventory() })?.status).toBe("pending");
    const rejected = applyWatchSaveResponse(save(), "A", { operationId: "op1", outcome: "rejected" })!;
    expect(reconcileWatchSave(rejected, "A", { operationId: "op1", inventory: inventory() })?.status).toBe("rejected");
  });

  it("clears saves on logout/UUID change and refuses another subject's inventory", () => {
    expect(applyWatchSaveResponse(save(), "B", { operationId: "op1", outcome: "accepted" })).toBeNull();
    expect(reconcileWatchSave(save(), null, { operationId: "op1", inventory: inventory() })).toBeNull();
    expect(reconcileWatchSave(save(), "A", { operationId: "op1", inventory: { subjectId: "B", state: "ready", data: lists } })?.status).toBe("pending");
  });
});
