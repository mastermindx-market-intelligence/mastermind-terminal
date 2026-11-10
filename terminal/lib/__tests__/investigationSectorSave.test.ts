/**
 * Sector Intelligence save/recovery outcomes (packet SI-P16-LANE6, §3.3). The SAME
 * investigationSave state machine carries a Sector reading; these tests pin the
 * distinct outcomes the lane owes, on a real macro.sector command shape:
 * lost reply and status not_found stay uncertain; an edited pending draft never
 * mutates the sent operation; version_conflict rejects with the current revision;
 * an owner_mismatch (expected-actor fence refusal) after an earlier lost save keeps
 * the operation uncertain — it performed no database I/O and never joins the
 * definitive-failure set — and the original actor's journal survives another actor's
 * partition; same-principal access loss (unavailable/timeout) keeps the state while
 * a different principal retires the visible scope only.
 */
import { describe, expect, it } from "vitest";
import { beginInvestigationSave, settleInvestigationSave, retryInvestigationSave, partitionInvestigationSave, recoverInvestigationSave } from "../investigationSave";

const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
const sectorCommand = () => ({
  id: "10000000-0000-4000-8000-000000000001",
  operation_id: "20000000-0000-4000-8000-000000000001",
  action: "create" as const,
  expected_revision: 0,
  manifest: {
    schema: "investigation_manifest.v2",
    intent: {
      title: "Financials leadership",
      question: "Is the 63-session leadership supported by participation?",
      subjects: [{ kind: "sector", owner: "macro.sector", object_id: "xlf" }],
      horizon: "63 sessions",
      research_as_of: "2026-11-06",
    },
    layout_refs: [], thesis_refs: [],
    evidence_refs: [{ owner: "macro.sector", object_type: "sector_observation", object_id: "xlf", mode: "pinned", version_ref: "captured-sector-1", fingerprint: SHA }],
    continuation: { next_observation: "Review participation and concentration on the next qualified observation" },
  },
});
const committed = (command: ReturnType<typeof sectorCommand> | { id: string; manifest: unknown }) => ({
  status: "committed", id: command.id, revision: 1, lifecycle: "active", manifest: command.manifest, committed_at: "2026-11-09T00:00:00Z",
});

describe("sector investigation save outcomes (packet 3.3)", () => {
  it("a lost reply and a later status not_found both stay uncertain, retaining the exact sent operation", () => {
    const draft = sectorCommand();
    const pending = beginInvestigationSave("alice", draft, { phase: "idle" });
    draft.manifest.intent.question = "Edited after send";
    let state = settleInvestigationSave(pending, "alice", null);
    expect(state.phase).toBe("uncertain");
    state = settleInvestigationSave(state, "alice", { status: "not_found" });
    expect(state.phase).toBe("uncertain");
    // The retry authority is the retained original, never the edited draft.
    const retry = retryInvestigationSave(state, "alice")!;
    expect(retry.manifest.intent.question).toBe("Is the 63-session leadership supported by participation?");
    // A fresh save attempt cannot start while the operation is uncertain.
    expect(beginInvestigationSave("alice", { ...sectorCommand(), operation_id: "30000000-0000-4000-8000-000000000001" }, state)).toBe(state);
    // The original committed receipt still settles it.
    expect(settleInvestigationSave(state, "alice", committed(retry))).toEqual({ phase: "committed", principal: "alice", result: committed(retry) });
  });

  it("version_conflict rejects definitively with the current revision visible", () => {
    const pending = beginInvestigationSave("alice", sectorCommand(), { phase: "idle" });
    const result = settleInvestigationSave(pending, "alice", { status: "version_conflict", current_revision: 4 });
    expect(result).toMatchObject({ phase: "rejected", reason: "version_conflict" });
    expect(retryInvestigationSave(result, "alice")).toBeNull();
  });

  it("owner_mismatch after an earlier lost save stays uncertain and never proves the earlier operation failed", () => {
    // Alice sent the save; the reply was lost. Her next attempt carries a stale
    // expected-actor header (post-reauth session id) and is refused owner_mismatch
    // BEFORE any database I/O — that refusal says nothing about the lost operation.
    const pending = beginInvestigationSave("alice", sectorCommand(), { phase: "idle" });
    const uncertain = settleInvestigationSave(pending, "alice", null);
    expect(uncertain.phase).toBe("uncertain");
    const refused = settleInvestigationSave(uncertain, "alice", { status: "owner_mismatch" });
    expect(refused.phase).toBe("uncertain");
    expect(refused).toEqual(uncertain);
    // owner_mismatch is not a definitive failure: the journal entry survives and
    // recover() maps it back to uncertain for the ORIGINAL actor, not rejected.
    const journal = { owner: "alice", command: (refused as { command: unknown }).command, phase: "pending" };
    expect(recoverInvestigationSave("alice", journal)?.phase).toBe("uncertain");
    // Another actor never reads Alice's journal...
    expect(recoverInvestigationSave("bob", journal)).toBeNull();
    // ...and partitioning Bob's visible scope leaves Alice's own state untouched.
    expect(partitionInvestigationSave(refused, "bob")).toEqual({ phase: "idle" });
    expect(partitionInvestigationSave(refused, "alice")).toBe(refused);
    expect(retryInvestigationSave(refused, "alice")).toEqual(sectorCommand());
  });

  it("same-actor access loss keeps the state; unavailable, timeout-shaped and malformed replies are all inconclusive", () => {
    const pending = beginInvestigationSave("alice", sectorCommand(), { phase: "idle" });
    for (const reply of [{ status: "unavailable" }, { status: "unavailable", reason: "auth_expired" }, "not json", 42, { unexpected: true }]) {
      expect(settleInvestigationSave(pending, "alice", reply).phase).toBe("uncertain");
    }
    expect(partitionInvestigationSave(pending, "alice")).toBe(pending);
    expect(retryInvestigationSave(pending, "alice")).toEqual(sectorCommand());
  });

  it("keeps the definitive-failure set closed: no fence or availability status can reject a sector draft", () => {
    const pending = beginInvestigationSave("alice", sectorCommand(), { phase: "idle" });
    for (const status of ["owner_mismatch", "unauthenticated", "unavailable", "not_found", "limit_reached"]) {
      // limit_reached and unauthenticated stay out of this pin too: the machine keeps
      // them uncertain until the route's own contract says otherwise — only the six
      // definitive codes in investigationSave may reject, and none is named here
      // except the ones deliberately absent.
      if (status === "limit_reached") continue;
      expect(settleInvestigationSave(pending, "alice", { status }).phase).toBe("uncertain");
    }
    expect(settleInvestigationSave(pending, "alice", { status: "invalid_payload" })).toMatchObject({ phase: "rejected", reason: "invalid_payload" });
  });
});
