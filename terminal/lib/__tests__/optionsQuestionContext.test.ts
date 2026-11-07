import { describe, expect, it, vi } from "vitest";
import { prepareOptionsQuestion, optionsQuestionIdentity, submitOptionsQuestion } from "../optionsQuestionContext";
import type { OptionsSelectionMintInput } from "../investigationEvidenceOptionsSelection";

const input = (): OptionsSelectionMintInput => ({
  root: "SPY", session: "2026-10-15", matrix: { sha256: "a".repeat(64), bytes: 1234 },
  lens: "chain", primary: { expiry: "2026-11-20", side: "call", strikeToken: "600" },
  comparisons: [], view: { metric: "volume", side: "all", expiry: "all", displayMode: "table" },
});

describe("exact Options question request preparation", () => {
  it("carries the incumbent immutable selection without inventing admission", () => {
    const source = input(), prepared = prepareOptionsQuestion(source);
    expect(prepared.state).toBe("prepared");
    if (prepared.state !== "prepared") throw new Error("fixture rejected");
    expect(prepared.reference.schema).toBe("options.selection_question/v1");
    expect(prepared.reference.evidence.object_type).toBe("options_matrix_selection");
    expect(prepared.reference.evidence.version_ref).toBe(`sha256:${"a".repeat(64)}:bytes:1234:session:2026-10-15`);
    expect(JSON.parse(prepared.reference.selection).primary.strike).toBe("600");
    expect(Object.isFrozen(prepared.reference)).toBe(true);
    expect(Object.isFrozen(prepared.reference.evidence)).toBe(true);
    source.primary!.strikeToken = "601";
    source.matrix!.sha256 = "b".repeat(64);
    expect(JSON.parse(prepared.reference.selection).primary.strike).toBe("600");
    expect(prepared.reference.evidence.fingerprint).toBe("a".repeat(64));
    expect(prepared).not.toHaveProperty("admitted");
  });

  it.each([
    ["root", (v: OptionsSelectionMintInput) => { v.root = "QQQ"; }],
    ["session", (v: OptionsSelectionMintInput) => { v.session = "2026-10-16"; }],
    ["bytes", (v: OptionsSelectionMintInput) => { v.matrix!.bytes++; }],
    ["digest", (v: OptionsSelectionMintInput) => { v.matrix!.sha256 = "b".repeat(64); }],
    ["selection", (v: OptionsSelectionMintInput) => { v.primary!.strikeToken = "601"; }],
    ["view", (v: OptionsSelectionMintInput) => { v.view.side = "put"; }],
  ] as const)("withdrawal identity distinguishes changed %s", (_, change) => {
    const first = prepareOptionsQuestion(input()), nextInput = input();
    change(nextInput);
    const next = prepareOptionsQuestion(nextInput);
    if (first.state !== "prepared" || next.state !== "prepared") throw new Error("fixture rejected");
    expect(optionsQuestionIdentity(first.reference)).not.toBe(optionsQuestionIdentity(next.reference));
  });

  it("does not treat an unknown session, non-chain lens or missing primary as a question source", () => {
    for (const patch of [{ session: null }, { lens: "scenario" }, { primary: null }]) {
      const prepared = prepareOptionsQuestion({ ...input(), ...patch });
      const submit = vi.fn();
      expect(prepared.state).toBe("unavailable");
      expect(submitOptionsQuestion(prepared, { MMBrain: { submitOptionsQuestion: submit } })).toBe(false);
      expect(submit).not.toHaveBeenCalled();
    }
  });

  it("does not open a generic or company Brain when typed consumption is absent", () => {
    expect(submitOptionsQuestion(prepareOptionsQuestion(input()), {})).toBe(false);
    expect(submitOptionsQuestion(prepareOptionsQuestion(input()), null)).toBe(false);
  });

  it("passes exact reference once per explicit submission and reports only strict acceptance", () => {
    const prepared = prepareOptionsQuestion(input()), submit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    if (prepared.state !== "prepared") throw new Error("fixture rejected");
    expect(submitOptionsQuestion(prepared, { MMBrain: { submitOptionsQuestion: submit } })).toBe(false);
    expect(submitOptionsQuestion(prepared, { MMBrain: { submitOptionsQuestion: submit } })).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toBe(prepared.reference);
  });
});
