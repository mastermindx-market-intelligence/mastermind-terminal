import { describe, expect, it } from "vitest";
import { mutationPostcondition, type MutationReceipt } from "@/lib/portfolioMutation";
import type { Position } from "@/lib/portfolio";
const id = "11111111-1111-4111-8111-111111111111";
const row: Position = { id, ticker: "NVDA", shares: 10, entryPrice: 100, entryCurrency: "USD",
  entryDate: null, notes: "A note", status: "open", createdAt: "2026-10-18T00:00:00Z" };
const intent = { action: "create", clientPositionId: id, ticker: " nvda ", shares: "10",
  entryPrice: "100", entryCurrency: "USD", entryDate: "", notes: " A note " };
describe("shared Portfolio mutation confirmation", () => {
  it("accepts the normalized intended record, including a replay, only with canonical readback", () => {
    const receipt = { ok: true, position: row };
    expect(mutationPostcondition(intent, receipt, [row])).toBe(true);
    expect(mutationPostcondition(intent, receipt, [])).toBe(false);
    expect(mutationPostcondition(intent, receipt, [{ ...row, entryCurrency: null }])).toBe(false);
    expect(mutationPostcondition(intent, receipt, [{ ...row, createdAt: "different" }])).toBe(false);
  });
  it.each([
    { shares: "11" }, { ticker: "AAPL" }, { entryPrice: "101" }, { entryCurrency: "CAD" },
    { notes: "A different note" }, { entryDate: "2026-10-17" }, { clientPositionId: "different" },
    { shares: "not a number" }, { entryCurrency: "usd" },
  ])("rejects an intended field mismatch even if the response and store agree: %j", change => {
    expect(mutationPostcondition({ ...intent, ...change }, { ok: true, position: row }, [row])).toBe(false);
  });
  it("distinguishes cleared create fields from absent update fields", () => {
    expect(mutationPostcondition({ action: "create", ticker: "NVDA" }, { ok: true, position: row }, [row])).toBe(false);
    expect(mutationPostcondition({ action: "update", id, notes: "A note" }, { ok: true, position: row }, [row])).toBe(true);
    expect(mutationPostcondition({ action: "update", id, notes: "" }, { ok: true, position: row }, [row])).toBe(false);
  });
  it("requires exact identity and canonical status or absence for close, reopen and delete", () => {
    const closed = { ...row, status: "closed" as const };
    expect(mutationPostcondition({ action: "close", id }, { ok: true, position: closed }, [closed])).toBe(true);
    expect(mutationPostcondition({ action: "close", id }, { ok: true, position: row }, [row])).toBe(false);
    expect(mutationPostcondition({ action: "reopen", id }, { ok: true, position: row }, [row])).toBe(true);
    expect(mutationPostcondition({ action: "delete", id }, { ok: true, deletedId: id }, [])).toBe(true);
    expect(mutationPostcondition({ action: "delete", id }, { ok: true, deletedId: id }, [row])).toBe(false);
  });
  it("refuses malformed receipts and unsupported actions without throwing", () => {
    for (const bad of [null, [], 5, { ok: true, position: {} }, { ok: true, position: "bad" }]) {
      expect(mutationPostcondition(intent, bad as MutationReceipt, [row])).toBe(false);
    }
    expect(mutationPostcondition(null as unknown as Record<string, unknown>, { ok: true, position: row }, [row])).toBe(false);
    expect(mutationPostcondition({ action: "guess" }, { ok: true, position: row }, [row])).toBe(false);
  });
});
