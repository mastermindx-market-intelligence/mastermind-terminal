import type { ServerWatchlist } from "@/lib/watchlists";

/** Inputs belong to the existing authenticated APIs. This module neither fetches nor persists. */
export type OwnerRead<T> =
  | { subjectId: string; state: "ready"; data: T }
  | { subjectId: string; state: "loading" | "restricted" | "unavailable" };

export type MonitorAlert = {
  id: string;
  symbol: string;
  active: boolean;
  created_at: string;
  condition?: Record<string, unknown>;
};

type ReadState = OwnerRead<unknown>["state"];

/** Preserve source order and clocks. Memberships and alert definitions are different facts. */
export function composeMonitorSnapshot(
  activeSubjectId: string | null,
  inventory: OwnerRead<readonly ServerWatchlist[]>,
  alertInventory: OwnerRead<readonly MonitorAlert[]>,
) {
  const listState: ReadState = activeSubjectId && inventory.subjectId === activeSubjectId
    ? inventory.state : "loading";
  const alertState: ReadState = activeSubjectId && alertInventory.subjectId === activeSubjectId
    ? alertInventory.state : "loading";
  const lists = listState === "ready" && inventory.state === "ready" ? inventory.data : [];
  const alerts = alertState === "ready" && alertInventory.state === "ready" ? alertInventory.data : [];
  return {
    subjectId: activeSubjectId,
    listState,
    alertState,
    lists,
    alerts,
    membershipCount: listState === "ready" ? lists.reduce((sum, list) => sum + list.symbols.length, 0) : null,
    distinctSymbolCount: listState === "ready"
      ? new Set(lists.flatMap((list) => list.symbols.map((row) => row.symbol))).size : null,
  };
}

export type WatchSave = {
  operationId: string;
  subjectId: string;
  listId: string;
  symbol: string;
  status: "pending" | "confirmed" | "rejected" | "unknown";
};

/** Select an actual owned list; the existing POST /api/watchlist remains the mutation owner. */
export function beginWatchSave(input: Omit<WatchSave, "status">): WatchSave {
  return { ...input, status: "pending" };
}

export function applyWatchSaveResponse(
  save: WatchSave,
  activeSubjectId: string | null,
  response: { operationId: string; outcome: "accepted" | "rejected" | "unknown" },
): WatchSave | null {
  if (save.subjectId !== activeSubjectId) return null;
  if (save.operationId !== response.operationId || save.status === "confirmed") return save;
  return { ...save, status: response.outcome === "accepted" ? "pending" : response.outcome };
}

/**
 * Use an authoritative request STARTED AFTER this operation's response or timeout, tagged
 * with the same operationId. An earlier page read cannot settle a later save. A timeout
 * never authorizes another POST. Missing membership cannot prove a timed-out write will
 * not land; only successful readback of the named membership confirms the postcondition.
 */
export function reconcileWatchSave(
  save: WatchSave,
  activeSubjectId: string | null,
  readback: { operationId: string; inventory: OwnerRead<readonly ServerWatchlist[]> },
): WatchSave | null {
  if (save.subjectId !== activeSubjectId) return null;
  if (save.operationId !== readback.operationId || save.status === "rejected") return save;
  const inventory = readback.inventory;
  if (inventory.subjectId !== activeSubjectId) return save;
  if (inventory.state !== "ready") return { ...save, status: "unknown" };
  const present = inventory.data.find((list) => list.id === save.listId)
    ?.symbols.some((row) => row.symbol === save.symbol) === true;
  return { ...save, status: present ? "confirmed" : "unknown" };
}
