import { describe, expect, it } from "vitest";
import { positionMutationFailure } from "@/lib/portfolioMutation";

const refusals = [
  [400, "invalid ticker", "invalidPositionTicker"],
  [400, "invalid shares", "invalidPositionShares"],
  [400, "invalid entry price", "invalidPositionPrice"],
  [400, "invalid entry currency", "invalidPositionCurrency"],
  [400, "invalid entry date", "invalidPositionDate"],
  [400, "invalid notes", "invalidPositionNotes"],
  [400, "invalid position intent", "invalidPositionIntent"],
  [404, "position not found", "positionNotFound"],
  [409, "position intent conflict", "createConflict"],
  [409, "entry price or identity changed; currency not recorded", "positionCurrencyUnconfirmed"],
] as const;

describe("shared position refusal mapping", () => {
  it.each(refusals)("maps HTTP %i %s to %s", (status, error, reason) => {
    expect(positionMutationFailure(status, { error })).toEqual({ ok: false, reason });
  });

  it("requires the matching HTTP status, even for a recognized refusal message", () => {
    const otherStatuses = [-1, 0, 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503];
    for (const [expectedStatus, error] of refusals) {
      for (const status of otherStatuses.filter(candidate => candidate !== expectedStatus)) {
        expect(positionMutationFailure(status, { error }), `HTTP ${status}: ${error}`)
          .toEqual({ ok: false, reason: null });
      }
    }
  });

  it("treats malformed receipts as uncertain without throwing", () => {
    const malformed: unknown[] = [
      undefined, null, false, 0, "", "invalid ticker", [], ["invalid ticker"],
      Object.assign([], { error: "invalid ticker" }), {}, { error: null },
      { error: 7 }, { error: ["invalid ticker"] }, { error: { message: "invalid ticker" } },
      { message: "invalid ticker" }, { ok: true, position: {} },
    ];
    for (const receipt of malformed) {
      for (const status of [400, 404, 409, 500]) {
        expect(positionMutationFailure(status, receipt)).toEqual({ ok: false, reason: null });
      }
    }
  });

  it("does not promote unrecognized server text or approximate message matches into UI copy", () => {
    for (const [status, message] of refusals) {
      for (const error of [message.toUpperCase(), ` ${message} `, `${message}\nfixture database detail`]) {
        expect(positionMutationFailure(status, { error })).toEqual({ ok: false, reason: null });
      }
    }
    for (const error of [
      "permission denied for table portfolio_positions", "fixture transport detail", "<b>invalid ticker</b>",
    ]) {
      expect(positionMutationFailure(400, { error })).toEqual({ ok: false, reason: null });
    }
  });
});
