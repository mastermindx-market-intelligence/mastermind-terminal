// ── W2-A revision/CAS law (contract §4/§5/§6), proved against the REAL fixture store ────────────
// `createLayoutFixtureDb` models the same invariants the post-0008 schema gives production
// (`unique(user_id,name)`, atomic conditional UPDATE via JSON-path filters) — see the extended
// matcher in `lib/layoutsFixtureDb.ts`. These are not scripted-response unit tests: the store is a
// real (if in-memory) implementation of the CAS semantics, so a `saveWorkspace` that merely did
// "read current revision, then blindly write" would be caught here, not waved through by a mock.
import { describe, expect, it } from "vitest";
import { deleteLayout, listLayouts, renameWorkspace, saveLayout, saveWorkspace, duplicateWorkspace } from "../layouts";
import { createLayoutFixtureDb, fixtureLayoutUserId, pokeLayoutFixtureRow } from "../layoutsFixtureDb";
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

describe("saveWorkspace — revision law", () => {
  it("a repeated READ never changes revision", async () => {
    const key = "persist-read";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Swing", envelope("AAA"), null);

    await listLayouts(db, user);
    await listLayouts(db, user);
    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Swing")?.revision).toBe(1);
  });

  it("one semantic mutation bumps revision exactly once", async () => {
    const key = "persist-bump";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const created = await saveWorkspace(db, user, "Swing", envelope("AAA"), null);
    expect(created).toEqual({ ok: true, id: expect.any(String), revision: 1 });

    const saved = await saveWorkspace(db, user, "Swing", envelope("BBB"), 1);
    expect(saved).toEqual({ ok: true, id: created.ok ? created.id : "", revision: 2 });

    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Swing")?.revision).toBe(2);
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["BBB"]);
  });

  it("a lost-response retry of the SAME logical write reports SUCCESS, not a conflict (M9 retry idempotency)", async () => {
    // Amendment A3 ruling 4 (completing A2 ruling 8 / M9): a client that retries after a DROPPED
    // response — the write actually landed server-side, but the caller never saw the 200 — must not
    // be told `stale_revision` on the retry. `resolveZeroRowUpdate` reads the row on 0-rows-updated
    // and recognizes ITS OWN prior write (same target revision, byte-identical canonical content) as
    // an already-applied success, distinct from a genuine conflicting write from someone else.
    const key = "persist-retry";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Swing", envelope("AAA"), null); // revision 1

    // Two calls carrying the IDENTICAL logical write (same expectedRevision=1, same envelope bytes)
    // — exactly what an HTTP client retry sends after a dropped response.
    const first = await saveWorkspace(db, user, "Swing", envelope("BBB"), 1);
    const second = await saveWorkspace(db, user, "Swing", envelope("BBB"), 1);

    expect(first).toEqual({ ok: true, id: expect.any(String), revision: 2 });
    // The retry's WHERE clause (`config->>revision = '1'`) no longer matches — the first call
    // already consumed it — but the retry is recognized as ITS OWN write already having landed,
    // not a competing one, and reports the SAME success rather than a false conflict.
    expect(second).toEqual({ ok: true, id: expect.any(String), revision: 2 });

    const listed = await listLayouts(db, user);
    // Never 3 — the retry did not re-apply a SECOND mutation, it only recognized the first's echo.
    expect(configOf(listed, "Swing")?.revision).toBe(2);
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["BBB"]);
  });

  it("a retry carrying DIFFERENT content at the same stale revision is a genuine conflict, never echoed as success", async () => {
    // The content-equality check is what tells a true retry-of-my-own-write apart from a second
    // writer's competing attempt that happens to target the same revision number.
    const key = "persist-retry-conflict";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Swing", envelope("AAA"), null); // revision 1
    await saveWorkspace(db, user, "Swing", envelope("BBB"), 1);    // revision 2 (this succeeded)

    // A second writer, unaware of the above, also attempts expectedRevision=1 but with DIFFERENT
    // content — this is NOT a retry of the same logical write.
    const competing = await saveWorkspace(db, user, "Swing", envelope("COMPETING"), 1);
    expect(competing).toEqual({ ok: false, reason: "stale_revision" });

    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Swing")?.revision).toBe(2);
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["BBB"]); // untouched
  });

  it("a stale expectedRevision is refused; the newer data is left intact", async () => {
    const key = "persist-stale";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Swing", envelope("AAA"), null); // revision 1
    await saveWorkspace(db, user, "Swing", envelope("BBB"), 1);    // revision 2 (the "newer" write)

    const stale = await saveWorkspace(db, user, "Swing", envelope("STALE-ATTEMPT"), 1);
    expect(stale).toEqual({ ok: false, reason: "stale_revision" });

    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Swing")?.revision).toBe(2);
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["BBB"]); // untouched
  });

  it("not_found when the row is gone (0 rows updated, no row on the follow-up read)", async () => {
    const key = "persist-notfound";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const result = await saveWorkspace(db, user, "Ghost", envelope("AAA"), 1);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("CAS refuses a write when a concurrent writer's mutation lands BETWEEN the caller's read and its own write", async () => {
    // This is the read-then-write CHEATING proof: a naive implementation that reads the current
    // revision once and then unconditionally writes "revision+1" would succeed here and silently
    // clobber the concurrent writer's content. `saveWorkspace` must instead refuse, because the
    // actual UPDATE statement re-checks `config->>revision` against the row's CURRENT state at
    // write time, not against what the caller believed it was.
    const key = "persist-interleave";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Swing", envelope("AAA"), null); // revision 1

    // The caller "read" revision 1 (e.g. via an earlier GET) and is about to save expecting 1.
    const callerBelievedRevision = 1;

    // A single-threaded Node process cannot produce a REAL race, so the interleaving is
    // manufactured directly: a concurrent device's write lands between the caller's read and its
    // own write, poking the store directly (bypassing the service, exactly as an out-of-band
    // Postgres row change would).
    pokeLayoutFixtureRow(key, user, "Swing", {
      config: { ...envelope("CONCURRENT-DEVICE"), revision: 2 },
      updated_at: new Date().toISOString(),
    });

    const result = await saveWorkspace(db, user, "Swing", envelope("CALLERS-STALE-WRITE"), callerBelievedRevision);
    expect(result).toEqual({ ok: false, reason: "stale_revision" });

    // The concurrent device's write is untouched — the refused write never applied.
    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Swing")?.revision).toBe(2);
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["CONCURRENT-DEVICE"]);
  });
});

describe("saveWorkspace — concurrent create cannot mint a duplicate (user, name)", () => {
  it("two simultaneous creates of the same brand-new name: exactly one wins", async () => {
    const key = "persist-concurrent-create";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);

    const [a, b] = await Promise.all([
      saveWorkspace(db, user, "Swing", envelope("FROM-A"), null),
      saveWorkspace(db, user, "Swing", envelope("FROM-B"), null),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ reason: "name_conflict" });

    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.filter((l) => l.name === "Swing")).toHaveLength(1);
  });
});

describe("saveWorkspace — concurrent migrate-on-write conversion of the SAME legacy row", () => {
  it("only one writer converts the row; the other sees stale_revision, never a duplicate row", async () => {
    const key = "persist-migrate-race";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    // Seed a legacy (non-workspace) row under this name via the EXISTING legacy save path.
    await saveLayout(db, user, { name: "Legacy", config: { schemaVersion: 2, panes: ["AAPL"] } });

    const [a, b] = await Promise.all([
      saveWorkspace(db, user, "Legacy", envelope("CONVERTED-BY-A"), null),
      saveWorkspace(db, user, "Legacy", envelope("CONVERTED-BY-B"), null),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok);
    expect(loser).toMatchObject({ reason: "stale_revision" });

    const listed = await listLayouts(db, user);
    const rows = listed.ok ? listed.layouts.filter((l) => l.name === "Legacy") : [];
    expect(rows).toHaveLength(1); // never a duplicate row under the same name
    const config = rows[0]?.config as { widgets: Array<{ config: { panes: string[] } }> };
    // Whichever writer won, its content is what survived — never a blend, never both.
    const winnerMarker = a.ok ? "CONVERTED-BY-A" : "CONVERTED-BY-B";
    expect(config.widgets[0].config.panes).toEqual([winnerMarker]);
  });
});

describe("renameWorkspace", () => {
  it("atomically renames and bumps revision, fenced by expectedRevision", async () => {
    const key = "persist-rename";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Old Name", envelope("AAA"), null); // revision 1

    const renamed = await renameWorkspace(db, user, "Old Name", "New Name", 1);
    expect(renamed).toEqual({ ok: true, revision: 2 });

    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.some((l) => l.name === "Old Name")).toBe(false);
    expect(configOf(listed, "New Name")?.revision).toBe(2);
  });

  it("name_conflict when the target name is already taken", async () => {
    const key = "persist-rename-conflict";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "A", envelope("AAA"), null);
    await saveWorkspace(db, user, "B", envelope("BBB"), null);

    const result = await renameWorkspace(db, user, "A", "B", 1);
    expect(result).toEqual({ ok: false, reason: "name_conflict" });

    // Neither row was mutated by the refused rename.
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.some((l) => l.name === "A")).toBe(true);
    expect(configOf(listed, "B")?.widgets[0].config.panes).toEqual(["BBB"]);
  });

  it("stale_revision when the row moved under the caller", async () => {
    const key = "persist-rename-stale";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "A", envelope("AAA"), null); // revision 1
    await saveWorkspace(db, user, "A", envelope("BBB"), 1);    // revision 2

    const result = await renameWorkspace(db, user, "A", "A2", 1);
    expect(result).toEqual({ ok: false, reason: "stale_revision" });
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.some((l) => l.name === "A")).toBe(true);
  });

  it("not_found when the source row does not exist", async () => {
    const key = "persist-rename-notfound";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const result = await renameWorkspace(db, user, "Ghost", "New", 1);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("duplicateWorkspace — independence", () => {
  it("resets revision to 1 and copies the payload", async () => {
    const key = "persist-duplicate";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Source", envelope("ORIGINAL"), null);
    await saveWorkspace(db, user, "Source", envelope("ORIGINAL-V2"), 1); // revision 2

    const dup = await duplicateWorkspace(db, user, "Source", "Source copy");
    expect(dup).toEqual({ ok: true, id: expect.any(String), name: "Source copy" });

    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Source copy")?.revision).toBe(1);
    expect(configOf(listed, "Source copy")?.widgets[0].config.panes).toEqual(["ORIGINAL-V2"]);
  });

  it("editing the source AFTER duplicating leaves the duplicate unchanged", async () => {
    const key = "persist-duplicate-independence";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Source", envelope("BEFORE-DUP"), null);
    const dup = await duplicateWorkspace(db, user, "Source", "Copy");
    expect(dup.ok).toBe(true);

    await saveWorkspace(db, user, "Source", envelope("AFTER-DUP"), 1);

    const listed = await listLayouts(db, user);
    expect(configOf(listed, "Source")?.widgets[0].config.panes).toEqual(["AFTER-DUP"]);
    expect(configOf(listed, "Copy")?.widgets[0].config.panes).toEqual(["BEFORE-DUP"]);
  });

  it("mints a collision-free name when none is supplied", async () => {
    const key = "persist-duplicate-autoname";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveWorkspace(db, user, "Source", envelope("AAA"), null);
    const dup = await duplicateWorkspace(db, user, "Source");
    expect(dup.ok).toBe(true);
    expect(dup.ok && dup.name).not.toBe("Source");
  });

  it("not_found when the source does not exist", async () => {
    const key = "persist-duplicate-notfound";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const result = await duplicateWorkspace(db, user, "Ghost");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

// ── ABA fence (Amendment A3 ruling 5, completing A2 ruling 9 / M10) ─────────────────────────────
// A device that loaded a row, then sees that SAME NAME deleted and recreated as a DIFFERENT row
// (a new uuid) before it writes, must never have its write silently applied to the new object. The
// CAS predicate carries the loaded row's `id`; the delete-recreate is manufactured directly (the
// same "poke the store" technique the interleave proof above uses) since single-threaded Node
// cannot produce a real race.
describe("ABA fence — delete-recreate under the same name is never silently clobbered", () => {
  it("saveWorkspace: a stale device's save-over is refused after a delete-recreate, and the new row survives untouched", async () => {
    const key = "persist-aba-save";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const created = await saveWorkspace(db, user, "Swing", envelope("ORIGINAL"), null); // revision 1
    expect(created.ok).toBe(true);
    const originalId = created.ok ? created.id : "";

    // The name is deleted, then RECREATED as a brand-new row (a different uuid) — exactly what a
    // user re-creating a workspace they just deleted (or a race with another tab) produces.
    expect(await deleteLayout(db, user, originalId)).toEqual({ ok: true });
    const recreated = await saveWorkspace(db, user, "Swing", envelope("RECREATED"), null); // revision 1, NEW id
    expect(recreated.ok).toBe(true);
    const recreatedId = recreated.ok ? recreated.id : "";
    expect(recreatedId).not.toBe(originalId);

    // The stale device still believes it owns `originalId` at revision 1 and attempts to save over
    // it — the id-fenced predicate must refuse rather than silently landing on the NEW row.
    const staleWrite = await saveWorkspace(db, user, "Swing", envelope("STALE-DEVICE-WRITE"), 1, originalId);
    expect(staleWrite).toEqual({ ok: false, reason: "stale_revision" });

    const listed = await listLayouts(db, user);
    const rows = listed.ok ? listed.layouts.filter((l) => l.name === "Swing") : [];
    expect(rows).toHaveLength(1); // never a duplicate row
    expect(configOf(listed, "Swing")?.widgets[0].config.panes).toEqual(["RECREATED"]); // untouched
  });

  it("renameWorkspace: a stale device's rename is refused after a delete-recreate", async () => {
    const key = "persist-aba-rename";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const created = await saveWorkspace(db, user, "A", envelope("ORIGINAL"), null);
    expect(created.ok).toBe(true);
    const originalId = created.ok ? created.id : "";

    expect(await deleteLayout(db, user, originalId)).toEqual({ ok: true });
    const recreated = await saveWorkspace(db, user, "A", envelope("RECREATED"), null);
    expect(recreated.ok).toBe(true);

    const staleRename = await renameWorkspace(db, user, "A", "A renamed", 1, originalId);
    expect(staleRename).toEqual({ ok: false, reason: "stale_revision" });

    // The recreated row is untouched — still named "A", still holding its own content.
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.some((l) => l.name === "A")).toBe(true);
    expect(listed.ok && listed.layouts.some((l) => l.name === "A renamed")).toBe(false);
    expect(configOf(listed, "A")?.widgets[0].config.panes).toEqual(["RECREATED"]);
  });

  it("duplicateWorkspace: a stale device's duplicate-source read is refused after a delete-recreate", async () => {
    const key = "persist-aba-duplicate";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const created = await saveWorkspace(db, user, "Source", envelope("ORIGINAL"), null);
    expect(created.ok).toBe(true);
    const originalId = created.ok ? created.id : "";

    expect(await deleteLayout(db, user, originalId)).toEqual({ ok: true });
    await saveWorkspace(db, user, "Source", envelope("RECREATED"), null);

    const staleDuplicate = await duplicateWorkspace(db, user, "Source", "Source copy", originalId);
    expect(staleDuplicate).toEqual({ ok: false, reason: "stale_revision" });

    // Nothing was duplicated from the (wrong) new row.
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts.some((l) => l.name === "Source copy")).toBe(false);
  });

  it("a rename that only moved (not deleted) still answers stale_revision by id, not not_found (A3 ruling 4)", async () => {
    // A concurrent RENAME of the same physical row is a DIFFERENT failure shape than a genuine
    // deletion — the id-keyed follow-up read finds the row still alive (just under a new name),
    // so the caller is told its belief is stale, never that the object vanished.
    const key = "persist-aba-concurrent-rename";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const created = await saveWorkspace(db, user, "Swing", envelope("ORIGINAL"), null);
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : "";

    // Someone else renames the SAME row (by id) — the object is still alive, just relabeled.
    await renameWorkspace(db, user, "Swing", "Swing (renamed)", 1, id);

    const staleWrite = await saveWorkspace(db, user, "Swing", envelope("STALE"), 1, id);
    expect(staleWrite).toEqual({ ok: false, reason: "stale_revision" });
  });
});
