import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateInvestigationManifest, type InvestigationEvidenceRef } from "../investigationContracts";
import { INVESTIGATION_ADMISSION } from "../investigations";
import {
  OPTIONS_MATRIX_SOURCE_MAX_BYTES, mintOptionsSelectionEvidence, selectionFromObjectId,
  type OptionsSelectionMint, type OptionsSelectionMintInput,
} from "../investigationEvidenceOptionsSelection";

const SHA = "a".repeat(64);
const ANCHOR_INPUT: OptionsSelectionMintInput = {
  root: "SPY",
  session: "2026-10-12",
  lens: "chain",
  matrix: { sha256: SHA, bytes: 1000 },
  primary: { expiry: "2026-10-16", side: "call", strikeToken: "600" },
  comparisons: [],
  view: { metric: "volume", side: "all", expiry: "all", displayMode: "table" },
};
const ANCHOR_REF = {
  owner: "terminal.options_exposure",
  object_type: "options_matrix_selection",
  object_id: "v1/SPY/2026-10-12/2026-10-16,call,600//volume,all,all,table",
  mode: "pinned",
  version_ref: `sha256:${SHA}:bytes:1000:session:2026-10-12`,
  fingerprint: SHA,
};
const ANCHOR_SELECTION = '{"comparisons":[],"primary":{"expiry":"2026-10-16","side":"call","strike":"600"},"schema":"options_matrix_selection.v1","view":{"display_mode":"table","expiry":"all","lens":"chain","metric":"volume","side":"all"}}';

const attempt = (overrides: Partial<OptionsSelectionMintInput>): OptionsSelectionMint =>
  mintOptionsSelectionEvidence({ ...ANCHOR_INPUT, ...overrides });

const manifestOk = (ref: InvestigationEvidenceRef): boolean =>
  validateInvestigationManifest(
    {
      schema: "investigation_manifest.v2",
      intent: { title: "XLK gamma at 450", question: "Does the matched change hold?", subjects: [] },
      layout_refs: [],
      thesis_refs: [],
      evidence_refs: [ref],
      continuation: {},
      argument_relations: [],
    },
    INVESTIGATION_ADMISSION,
  ).ok;

describe("mintOptionsSelectionEvidence", () => {
  it("mints the anchor pinned reference, keeps the selection beside it and rebuilds it from the object_id", () => {
    const minted = mintOptionsSelectionEvidence(ANCHOR_INPUT);
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.ref).toEqual(ANCHOR_REF);
    expect(minted.selection).toBe(ANCHOR_SELECTION);
    expect("selection" in minted.ref).toBe(false);
    expect(selectionFromObjectId(ANCHOR_REF.object_id)).toBe(ANCHOR_SELECTION);
    expect(manifestOk(minted.ref)).toBe(true);
    expect(selectionFromObjectId("v2/SPY/2026-10-12/2026-10-16,call,600//volume,all,all,table")).toBeNull();
    expect(selectionFromObjectId("v1/SPY/2026-10-12/2026-10-16,call,600/volume,all,all,table")).toBeNull();
  });

  it("keeps comparison order, caps comparisons at three and mints the 216-character worst case", () => {
    const ordered = attempt({
      primary: { expiry: "2026-01-16", side: "call", strikeToken: "450" },
      comparisons: [
        { expiry: "2026-03-20", side: "call", strikeToken: "500" },
        { expiry: "2026-02-20", side: "put", strikeToken: "430" },
        { expiry: "2026-01-16", side: "call", strikeToken: "470" },
      ],
      view: { metric: "volume", side: "all", expiry: "all", displayMode: "3d" },
    });
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.ref.object_id)
      .toBe("v1/SPY/2026-10-12/2026-01-16,call,450/2026-03-20,call,500;2026-02-20,put,430;2026-01-16,call,470/volume,all,all,3d");
    const overLimit = attempt({
      comparisons: [
        { expiry: "2026-03-20", side: "call", strikeToken: "500" },
        { expiry: "2026-02-20", side: "put", strikeToken: "430" },
        { expiry: "2026-01-16", side: "call", strikeToken: "470" },
        { expiry: "2026-01-16", side: "put", strikeToken: "460" },
      ],
    });
    expect(overLimit).toEqual({ ok: false, reason: "comparisons_over_limit" });
    const worst = attempt({
      root: "ABCDEFGHIJKLMNO",
      primary: { expiry: "2026-10-16", side: "call", strikeToken: "999999999999.99999999" },
      comparisons: [
        { expiry: "2026-10-17", side: "call", strikeToken: "999999999999.99999999" },
        { expiry: "2026-10-18", side: "call", strikeToken: "999999999999.99999999" },
        { expiry: "2026-10-19", side: "call", strikeToken: "999999999999.99999999" },
      ],
      view: { metric: "openInterest", side: "call", expiry: "2026-10-16", displayMode: "table" },
    });
    expect(worst.ok).toBe(true);
    if (!worst.ok) return;
    expect(worst.ref.object_id.length).toBe(216);
    expect(manifestOk(worst.ref)).toBe(true);
  });

  it("refuses two equal comparisons regardless of property order and allows the primary repeated once", () => {
    const duplicate = attempt({
      comparisons: [
        { side: "call", expiry: "2026-03-20", strikeToken: "500" },
        { expiry: "2026-03-20", strikeToken: "500", side: "call" },
      ],
    });
    expect(duplicate).toEqual({ ok: false, reason: "comparison_duplicate" });
    const repeatedPrimary = attempt({
      comparisons: [{ expiry: "2026-10-16", side: "call", strikeToken: "600" }],
    });
    expect(repeatedPrimary.ok).toBe(true);
  });

  it("refuses an unknown or malformed source session and a missing matrix", () => {
    expect(attempt({ session: null })).toEqual({ ok: false, reason: "source_session_unavailable" });
    expect(attempt({ session: "2026-10-12\n" })).toEqual({ ok: false, reason: "source_session_unavailable" });
    expect(attempt({ matrix: null })).toEqual({ ok: false, reason: "matrix_unavailable" });
  });

  it("keeps the strike token exact: canonical positive decimals only", () => {
    for (const strikeToken of ["600.50", "-0", "0", "600\n", "1e3", "0600", null]) {
      expect(attempt({ primary: { expiry: "2026-10-16", side: "call", strikeToken } }))
        .toEqual({ ok: false, reason: "strike_not_exact" });
    }
    expect(attempt({ primary: { expiry: "2026-10-16", side: "call", strikeToken: "0.00000001" } }).ok).toBe(true);
    expect(attempt({ primary: { expiry: "2026-10-16", side: "call", strikeToken: "999999999999.99999999" } }).ok).toBe(true);
  });

  it("carries the root spelling as given and refuses anything outside the carried grammar", () => {
    for (const root of ["spy", "A..B", "-SPY", "SPY-", "ABCDEFGHIJKLMNOP"]) {
      expect(attempt({ root })).toEqual({ ok: false, reason: "root_not_carried" });
    }
    expect(attempt({ root: "BRK.B" }).ok).toBe(true);
  });

  it("requires a real Gregorian primary expiry and a call or put side", () => {
    for (const expiry of ["2026-1-16", "1900-02-29", "0000-01-01"]) {
      expect(attempt({ primary: { expiry, side: "call", strikeToken: "600" } }))
        .toEqual({ ok: false, reason: "expiry_invalid" });
    }
    expect(attempt({ primary: { expiry: "2000-02-29", side: "call", strikeToken: "600" } }).ok).toBe(true);
    expect(attempt({ primary: { expiry: "2026-10-16", side: "CALL", strikeToken: "600" } }))
      .toEqual({ ok: false, reason: "side_invalid" });
  });

  it("pins the chain lens and the stored view enums", () => {
    expect(attempt({ lens: "week" })).toEqual({ ok: false, reason: "lens_not_chain" });
    expect(attempt({ view: { metric: "gamma", side: "all", expiry: "all", displayMode: "table" } }))
      .toEqual({ ok: false, reason: "view_invalid" });
    expect(attempt({ view: { metric: "volume", side: "both", expiry: "all", displayMode: "table" } }))
      .toEqual({ ok: false, reason: "view_invalid" });
    expect(attempt({ view: { metric: "volume", side: "all", expiry: "2026-02-29", displayMode: "table" } }))
      .toEqual({ ok: false, reason: "view_invalid" });
    expect(attempt({ view: { metric: "volume", side: "all", expiry: "all", displayMode: "2d" } }))
      .toEqual({ ok: false, reason: "view_invalid" });
  });

  it("binds the producer byte ceiling and refuses an unavailable matrix source", () => {
    expect(attempt({ matrix: { sha256: SHA, bytes: 0 } })).toEqual({ ok: false, reason: "matrix_unavailable" });
    expect(attempt({ matrix: { sha256: "A".repeat(64), bytes: 1000 } })).toEqual({ ok: false, reason: "matrix_unavailable" });
    expect(attempt({ matrix: { sha256: SHA, bytes: 16777217 } })).toEqual({ ok: false, reason: "version_ref_invalid" });
    expect(attempt({ matrix: { sha256: SHA, bytes: 16777216 } }).ok).toBe(true);
    expect(OPTIONS_MATRIX_SOURCE_MAX_BYTES).toBe(16777216);
  });

  it("refuses malformed input shapes without throwing and carries no forecast vocabulary", () => {
    for (const value of [undefined, 7, [], {}]) {
      expect(mintOptionsSelectionEvidence(value as unknown as OptionsSelectionMintInput))
        .toEqual({ ok: false, reason: "input_invalid" });
    }
    expect(attempt({ session: 7 as unknown as string })).toEqual({ ok: false, reason: "input_invalid" });
    expect(attempt({ matrix: { sha256: SHA, bytes: "1000" as unknown as number } })).toEqual({ ok: false, reason: "input_invalid" });
    const text = readFileSync(new URL("../investigationEvidenceOptionsSelection.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/follow_head|forecast|predict|Date\.now|new Date|fetch\(/);
  });
});
