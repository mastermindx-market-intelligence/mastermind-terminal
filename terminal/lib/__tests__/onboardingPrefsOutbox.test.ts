/**
 * D5 — an explicitly chosen onboarding preference must survive a transient network failure.
 *
 * The old contract was "one-shot: the writer sets, the reader reads-then-removes", and the reader
 * removed the record BEFORE the write was acknowledged:
 *
 *   prefsApplied.current = true;                              // in-memory retry latch: burned
 *   auth.updateUser({ data }).catch(console.warn);            // un-awaited
 *   localStorage.removeItem(LS_PENDING_PREFS);                // durable copy: gone
 *
 * So a single failing request destroyed BOTH retry mechanisms while the user watched onboarding
 * complete normally, and their China/HK/US selection was simply absent next session.
 *
 * The rule under test is ACKNOWLEDGE BEFORE DELETE. The decisive case is "fail once, then succeed":
 * after the failure the choice must still be recoverable, and the record must clear only after the
 * authority confirms — not before, and not never.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LS_PENDING_PREFS, type PendingPrefs } from "@/components/onboarding/types";
import {
  readPendingPrefs, writePendingPrefs, clearPendingPrefs, deliverPendingPrefs,
  MAX_DELIVERY_ATTEMPTS,
} from "@/lib/onboardingPrefsOutbox";

const PREFS: PendingPrefs = {
  first_name: "Ada",
  last_name: "Lovelace",
  market_focus: ["cn", "hk", "us"],     // the explicit choice the defect threw away
  trade_types: ["stocks", "options"],
  theme_pref: "dark",
  onboarded_at: "2026-08-19T00:00:00.000Z",
};

// Minimal localStorage — the module is browser-only and vitest runs in node here.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});

const ok = async () => ({ error: null });
const failsWithError = async () => ({ error: { message: "network" } });
const throws = async () => { throw new Error("offline"); };

describe("D5 — the record clears only after the authority acknowledges", () => {
  /**
   * The load-bearing test, and the one this suite originally lacked.
   *
   * Asserting only the FINAL state cannot distinguish "cleared after the ack" from "cleared up
   * front and rewritten on the failure path" — a mutation that deleted the record before calling
   * updateUser passed every other test here. But that difference is the whole defect: if the tab
   * closes, the network hangs, or the process dies mid-request, an up-front delete has already
   * thrown the choice away. So the invariant has to be checked WHILE the write is in flight.
   */
  it("the record is still present WHILE the write is in flight", async () => {
    writePendingPrefs(PREFS);
    let release!: (v: { error: null }) => void;
    const inFlight = new Promise<{ error: null }>((resolve) => { release = resolve; });

    let observedDuringFlight: unknown = "not-observed";
    const delivery = deliverPendingPrefs(() => {
      // Called synchronously by deliverPendingPrefs, before it awaits.
      observedDuringFlight = readPendingPrefs()?.prefs ?? null;
      return inFlight;
    });

    // Let the microtask queue run so the call has definitely been made and awaited.
    await Promise.resolve();
    expect(observedDuringFlight).toEqual(PREFS);      // survives an interruption at this instant
    expect(readPendingPrefs()?.prefs).toEqual(PREFS);

    release({ error: null });
    expect((await delivery).status).toBe("delivered");
    expect(readPendingPrefs()).toBeNull();            // …and only now is it gone
  });

  it("a successful delivery clears it", async () => {
    writePendingPrefs(PREFS);
    const outcome = await deliverPendingPrefs(ok);
    expect(outcome.status).toBe("delivered");
    expect(readPendingPrefs()).toBeNull();
  });

  it("a failing delivery KEEPS it — the choice stays recoverable", async () => {
    writePendingPrefs(PREFS);
    const outcome = await deliverPendingPrefs(failsWithError);
    expect(outcome.status).toBe("failed");
    expect(readPendingPrefs()?.prefs).toEqual(PREFS);
  });

  it("a THROWN error keeps it too", async () => {
    writePendingPrefs(PREFS);
    await deliverPendingPrefs(throws);
    expect(readPendingPrefs()?.prefs).toEqual(PREFS);
  });

  it("an error reported in the RESULT is a failure, not a success", async () => {
    // Supabase reports failure in the resolved value, not by throwing. Treating a resolved promise
    // as success is exactly how the original fire-and-forget call declared victory over an error.
    writePendingPrefs(PREFS);
    const outcome = await deliverPendingPrefs(async () => ({ error: { message: "rate limited" } }));
    expect(outcome.status).toBe("failed");
    expect(readPendingPrefs()).not.toBeNull();
  });
});

describe("D5 — fail first, succeed second (the handoff's required proof)", () => {
  it("intercepting the FIRST attempt leaves the prefs recoverable; the second delivers and only then clears", async () => {
    writePendingPrefs(PREFS);

    // Attempt 1 fails, and every retry inside it fails too — the whole first mount is a failure.
    const firstMount = vi.fn(failsWithError);
    const first = await deliverPendingPrefs(firstMount);
    expect(first.status).toBe("failed");
    expect(firstMount).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);

    // The durable receipt is intact between attempts — this is what used to be destroyed.
    const held = readPendingPrefs();
    expect(held).not.toBeNull();
    expect(held!.prefs.market_focus).toEqual(["cn", "hk", "us"]);
    expect(held!.attempts).toBeGreaterThan(0);          // the record is honest about having tried

    // Attempt 2 succeeds — and the metadata receives the EXACT selection, unchanged.
    const secondMount = vi.fn(async (data: Record<string, unknown>) => {
      expect(data).toMatchObject({ market_focus: ["cn", "hk", "us"], trade_types: ["stocks", "options"] });
      return { error: null };
    });
    const second = await deliverPendingPrefs(secondMount);
    expect(second.status).toBe("delivered");
    expect(secondMount).toHaveBeenCalledTimes(1);

    // Cleared ONLY afterwards.
    expect(readPendingPrefs()).toBeNull();
  });
});

describe("D5 — the retry is bounded, and never silently drops the choice", () => {
  it("one delivery pass makes at most MAX_DELIVERY_ATTEMPTS calls", async () => {
    writePendingPrefs(PREFS);
    const spy = vi.fn(failsWithError);
    await deliverPendingPrefs(spy);
    expect(spy).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
  });

  it("an exhausted record is still KEPT for a later session, not discarded", async () => {
    writePendingPrefs(PREFS);
    const outcome = await deliverPendingPrefs(failsWithError);
    expect(outcome).toMatchObject({ status: "failed", exhausted: true });
    // Bounded ≠ abandoned. A future mount can still deliver it.
    expect(readPendingPrefs()?.prefs).toEqual(PREFS);
    const revived = await deliverPendingPrefs(ok);
    expect(revived.status).toBe("delivered");
    expect(readPendingPrefs()).toBeNull();
  });
});

describe("D5 — read tolerance", () => {
  it("adopts a PRE-OUTBOX bare payload written by an older deploy", async () => {
    // A tab that started onboarding before this change holds the raw shape under the same key.
    // That is a real user's real choice; dropping it would reintroduce the very loss being fixed.
    localStorage.setItem(LS_PENDING_PREFS, JSON.stringify(PREFS));
    expect(readPendingPrefs()?.prefs).toEqual(PREFS);
    const outcome = await deliverPendingPrefs(ok);
    expect(outcome.status).toBe("delivered");
  });

  it("garbage is not a pending record", () => {
    localStorage.setItem(LS_PENDING_PREFS, "{not json");
    expect(readPendingPrefs()).toBeNull();
    localStorage.setItem(LS_PENDING_PREFS, JSON.stringify([1, 2, 3]));
    expect(readPendingPrefs()).toBeNull();
  });

  it("nothing pending is reported as such, and attempts no write", async () => {
    clearPendingPrefs();
    const spy = vi.fn(ok);
    expect((await deliverPendingPrefs(spy)).status).toBe("nothing-pending");
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocked storage does not throw (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => writePendingPrefs(PREFS)).not.toThrow();
    expect(readPendingPrefs()).toBeNull();
    expect(() => clearPendingPrefs()).not.toThrow();
  });
});
