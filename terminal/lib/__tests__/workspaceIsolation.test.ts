// ── Cross-account isolation (reviewer ruling M7, committing the hostile review's P11 scenario) ──
// Every W2-A workspace op filters by `user_id` (contract §4/§5/§6's owner-scoped statements), so an
// attacker who guesses (or is handed, e.g. via a shared link) a victim's workspace NAME and/or the
// victim's row `id` must never be able to touch it: `save_workspace`/`rename`/`duplicate` (the three
// ops `app/api/layouts/route.ts` dispatches) all answer `not_found`, the victim's row survives byte-
// for-byte, and the attacker's own workspace list never surfaces the victim's row. Both accounts
// share ONE fixture store (same `key`) so this is a real same-table cross-user probe, not two
// isolated stores that could never collide in the first place.
import { describe, expect, it } from "vitest";
import { duplicateWorkspace, listLayouts, renameWorkspace, saveWorkspace } from "../layouts";
import { createLayoutFixtureDb, fixtureLayoutUserId } from "../layoutsFixtureDb";
import { SCHEMA, type WorkspaceEnvelope } from "../workspaceLayout";

function envelope(marker: string): WorkspaceEnvelope {
  return {
    schema: SCHEMA, requires: { floor: 1 }, revision: 1, name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [{
      id: "chart-main", type: "chart", semantic_lane: "primary",
      context_in: ["primary_security"], context_out: ["primary_security"],
      config: { panes: [marker] },
    }],
    migration: { source: "none", source_revision: null },
  };
}

const configOf = (result: { ok: boolean; layouts?: Array<{ name: string; config: unknown }> }, name: string) =>
  (result.ok ? result.layouts?.find((l) => l.name === name)?.config : undefined) as
    { revision: number; widgets: Array<{ config: { panes: string[] } }> } | undefined;

describe("Cross-account isolation — an attacker cannot reach a victim's workspace by name or by guessed id", () => {
  it("save_workspace / rename / duplicate all answer not_found; the victim's row is untouched; the attacker's list stays empty", async () => {
    const key = "isolation-victim-attacker";
    const db = createLayoutFixtureDb(key); // ONE shared store — both accounts' rows live in it.
    const victim = fixtureLayoutUserId(key);
    const attacker = "attacker-" + fixtureLayoutUserId(key); // a different user_id, same store.

    const created = await saveWorkspace(db, victim, "Victim Workspace", envelope("VICTIM-ORIGINAL"), null);
    expect(created.ok).toBe(true);
    const victimId = created.ok ? created.id : "";

    // The attacker knows (or guesses) both the victim's workspace NAME and its row id — the
    // strongest case, since the id-scoped ABA fence is exactly what would otherwise let an id-aware
    // caller bypass a name check.
    const attackerSave = await saveWorkspace(db, attacker, "Victim Workspace", envelope("ATTACKER-OVERWRITE"), 1, victimId);
    expect(attackerSave).toEqual({ ok: false, reason: "not_found" });

    const attackerRename = await renameWorkspace(db, attacker, "Victim Workspace", "Stolen Name", 1, victimId);
    expect(attackerRename).toEqual({ ok: false, reason: "not_found" });

    const attackerDuplicate = await duplicateWorkspace(db, attacker, "Victim Workspace", "Stolen Copy", victimId);
    expect(attackerDuplicate).toEqual({ ok: false, reason: "not_found" });

    // The victim's row survived every attempt, byte-for-byte, still at revision 1.
    const victimListing = await listLayouts(db, victim);
    expect(victimListing.ok && victimListing.layouts).toHaveLength(1);
    expect(configOf(victimListing, "Victim Workspace")?.revision).toBe(1);
    expect(configOf(victimListing, "Victim Workspace")?.widgets[0].config.panes).toEqual(["VICTIM-ORIGINAL"]);

    // The attacker's own view of the store never surfaces the victim's row — not as itself, not as
    // a rename target, not as a duplicate.
    const attackerListing = await listLayouts(db, attacker);
    expect(attackerListing.ok && attackerListing.layouts).toHaveLength(0);
  });

  it("the same three ops answer not_found even without a guessed id — name alone cannot cross accounts", async () => {
    const key = "isolation-victim-attacker-name-only";
    const db = createLayoutFixtureDb(key);
    const victim = fixtureLayoutUserId(key);
    const attacker = "attacker-" + fixtureLayoutUserId(key);

    await saveWorkspace(db, victim, "Victim Workspace", envelope("VICTIM-ORIGINAL"), null);

    expect(await saveWorkspace(db, attacker, "Victim Workspace", envelope("ATTACKER-OVERWRITE"), 1)).toEqual({ ok: false, reason: "not_found" });
    expect(await renameWorkspace(db, attacker, "Victim Workspace", "Stolen Name", 1)).toEqual({ ok: false, reason: "not_found" });
    expect(await duplicateWorkspace(db, attacker, "Victim Workspace", "Stolen Copy")).toEqual({ ok: false, reason: "not_found" });

    const victimListing = await listLayouts(db, victim);
    expect(configOf(victimListing, "Victim Workspace")?.widgets[0].config.panes).toEqual(["VICTIM-ORIGINAL"]);
    const attackerListing = await listLayouts(db, attacker);
    expect(attackerListing.ok && attackerListing.layouts).toHaveLength(0);
  });
});
