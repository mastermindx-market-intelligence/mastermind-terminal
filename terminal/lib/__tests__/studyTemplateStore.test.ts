// E07 — the account template store over workspace_settings: isolation, compare-and-swap,
// version guards, limits and write failures (fixture transport models the 0015 table).
import { beforeEach, describe, expect, it } from "vitest";
import {
  createStudyTemplate,
  deleteStudyTemplate,
  listStudyTemplates,
  updateStudyTemplate,
} from "../studyTemplateStore";
import {
  FAULT_SAVED_VIEWS_READ,
  FAULT_WORKSPACE_SETTINGS_WRITE,
  createFixtureDb,
  fixtureStore,
  fixtureUserId,
  resetFixtureStores,
} from "../watchlistsFixtureDb";
import { STUDY_TEMPLATE_LIMITS, STUDY_TEMPLATE_VERSION, studyTemplateSettingsKey } from "../studyTemplateSchema";

const body = {
  indicators: ["rsi", "rsi__abcd1234"],
  indParams: { rsi: { length: 14 }, rsi__abcd1234: { length: 7 } },
  hidden: ["rsi__abcd1234"],
};

let seq = 0;
const mintId = () => (++seq).toString(16).padStart(32, "0");

beforeEach(() => {
  resetFixtureStores();
  seq = 0;
});

describe("account study templates", () => {
  it("creates, lists, reopens on a second connection, renames and deletes", async () => {
    const a = createFixtureDb("tpl::a");
    const userA = fixtureUserId("tpl::a");
    const created = await createStudyTemplate(a, userA, { name: "  Two RSI ", body }, { mintId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.template).toMatchObject({ v: STUDY_TEMPLATE_VERSION, name: "Two RSI", revision: 1, newer: false });

    // A second device is just another connection for the same owner.
    const deviceTwo = createFixtureDb("tpl::a");
    const listed = await listStudyTemplates(deviceTwo, userA);
    expect(listed).toMatchObject({ ok: true, unreadable: 0, truncated: false });
    if (!listed.ok) return;
    expect(listed.templates).toHaveLength(1);
    expect(listed.templates[0]).toMatchObject({ id: created.template.id, indicators: body.indicators, indParams: body.indParams, hidden: body.hidden });

    const renamed = await updateStudyTemplate(deviceTwo, userA, { id: created.template.id, baseRevision: 1, name: "Pair" });
    expect(renamed).toMatchObject({ ok: true, template: { name: "Pair", revision: 2, indicators: body.indicators } });

    const deleted = await deleteStudyTemplate(a, userA, { id: created.template.id, baseRevision: 2 });
    expect(deleted).toEqual({ ok: true });
    expect(await listStudyTemplates(a, userA)).toMatchObject({ ok: true, templates: [] });
  });

  it("keeps two accounts on one database apart", async () => {
    const a = createFixtureDb("tpl::a");
    const b = createFixtureDb("tpl::b");
    const userA = fixtureUserId("tpl::a");
    const userB = fixtureUserId("tpl::b");
    const created = await createStudyTemplate(a, userA, { name: "Mine", body }, { mintId });
    if (!created.ok) throw new Error("create failed");
    expect(await listStudyTemplates(b, userB)).toMatchObject({ ok: true, templates: [] });
    // Another account cannot rename or delete it by guessing the id.
    expect(await updateStudyTemplate(b, userB, { id: created.template.id, baseRevision: 1, name: "Taken" })).toEqual({ ok: false, status: "not_found" });
    expect(await deleteStudyTemplate(b, userB, { id: created.template.id })).toEqual({ ok: false, status: "not_found" });
    // The same name is free for the other account.
    expect((await createStudyTemplate(b, userB, { name: "Mine", body }, { mintId })).ok).toBe(true);
    const listedA = await listStudyTemplates(a, userA);
    expect(listedA.ok && listedA.templates.map((t) => t.name)).toEqual(["Mine"]);
  });

  it("answers conflict, with the current record, when another device changed it first", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const created = await createStudyTemplate(db, user, { name: "Swing", body }, { mintId });
    if (!created.ok) throw new Error("create failed");
    const id = created.template.id;
    const now = new Date("2026-10-11T00:00:00.000Z");
    expect((await updateStudyTemplate(db, user, { id, baseRevision: 1, name: "Swing A" }, { now })).ok).toBe(true);
    // The second device still holds revision 1.
    const stale = await updateStudyTemplate(db, user, { id, baseRevision: 1, name: "Swing B" }, { now });
    expect(stale).toMatchObject({ ok: false, status: "conflict", current: { name: "Swing A", revision: 2 } });
    const staleDelete = await deleteStudyTemplate(db, user, { id, baseRevision: 1 });
    expect(staleDelete).toMatchObject({ ok: false, status: "conflict", current: { revision: 2 } });
    // Two writes inside one millisecond still advance the swap token.
    const third = await updateStudyTemplate(db, user, { id, baseRevision: 2, name: "Swing C" }, { now });
    expect(third).toMatchObject({ ok: true, template: { revision: 3 } });
    const row = fixtureStore("tpl").workspaceSettings.find((r) => r.key === studyTemplateSettingsKey(id));
    expect(Date.parse(String(row?.updated_at))).toBeGreaterThan(now.getTime());
  });

  it("detects a write that lands between the read and the swap", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const created = await createStudyTemplate(db, user, { name: "Race", body }, { mintId });
    if (!created.ok) throw new Error("create failed");
    const store = fixtureStore("tpl");
    // Wrap the update so another writer moves the row after our read but before our swap.
    const racing = {
      from(table: string) {
        const query = db.from(table);
        if (table !== "workspace_settings") return query;
        const original = query.update.bind(query);
        query.update = (patch: Record<string, unknown>) => {
          const row = store.workspaceSettings.find((r) => r.key === studyTemplateSettingsKey(created.template.id));
          if (row) {
            row.updated_at = "2099-01-01T00:00:00.000Z";
            row.value = { ...(row.value as object), name: "Other device", revision: 2 };
          }
          return original(patch);
        };
        return query;
      },
    } as typeof db;
    const result = await updateStudyTemplate(racing, user, { id: created.template.id, baseRevision: 1, name: "Mine" });
    expect(result).toMatchObject({ ok: false, status: "conflict", current: { name: "Other device", revision: 2 } });
  });

  it("refuses a duplicate name and returns the existing template", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const first = await createStudyTemplate(db, user, { name: "Swing", body }, { mintId });
    if (!first.ok) throw new Error("create failed");
    const dup = await createStudyTemplate(db, user, { name: "ＳＷＩＮＧ", body }, { mintId });
    expect(dup).toMatchObject({ ok: false, status: "name_taken", existing: { id: first.template.id, revision: 1 } });
    const other = await createStudyTemplate(db, user, { name: "Other", body }, { mintId });
    if (!other.ok) throw new Error("create failed");
    expect(await updateStudyTemplate(db, user, { id: other.template.id, baseRevision: 1, name: "swing" })).toMatchObject({ ok: false, status: "name_taken" });
  });

  it("validates before writing and never writes an empty or oversized template", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    expect(await createStudyTemplate(db, user, { name: "", body })).toEqual({ ok: false, status: "invalid_name" });
    expect(await createStudyTemplate(db, user, { name: "x".repeat(61), body })).toEqual({ ok: false, status: "name_too_long" });
    expect(await createStudyTemplate(db, user, { name: "Empty", body: { indicators: [] } })).toEqual({ ok: false, status: "empty" });
    const big = { indicators: ["rsi"], indParams: { rsi: { note: "x".repeat(STUDY_TEMPLATE_LIMITS.bodyBytesMax) } } };
    expect(await createStudyTemplate(db, user, { name: "Big", body: big })).toEqual({ ok: false, status: "too_large" });
    const hostile = { ...body, indParams: { ...body.indParams, symbol: { value: "TSLA" } } };
    expect(await createStudyTemplate(db, user, { name: "Hostile", body: hostile })).toEqual({ ok: false, status: "invalid_body" });
    expect(fixtureStore("tpl").workspaceSettings).toHaveLength(0);
  });

  it("caps the template count, counting rows it cannot read", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const store = fixtureStore("tpl");
    store.workspaceSettings.push({
      scope: "user", user_id: user, owner_id: user, key: studyTemplateSettingsKey("f".repeat(32)),
      value: { garbage: true }, updated_at: "2026-01-01T00:00:00.000Z",
    });
    for (let i = 0; i < STUDY_TEMPLATE_LIMITS.templatesMax - 1; i += 1) {
      const result = await createStudyTemplate(db, user, { name: `T${i}`, body }, { mintId });
      expect(result.ok).toBe(true);
    }
    expect(await createStudyTemplate(db, user, { name: "One more", body }, { mintId })).toEqual({ ok: false, status: "limit_reached" });
    const listed = await listStudyTemplates(db, user);
    expect(listed).toMatchObject({ ok: true, unreadable: 1, truncated: false });
    // The unreadable row is still there: nothing deleted it to make room.
    expect(store.workspaceSettings.some((r) => r.key === studyTemplateSettingsKey("f".repeat(32)))).toBe(true);
  });

  it("ignores other workspace_settings keys and never touches them", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const store = fixtureStore("tpl");
    store.workspaceSettings.push({ scope: "user", user_id: user, owner_id: user, key: "thesis.saved_view.abc", value: { name: "View" }, updated_at: "2026-01-01T00:00:00.000Z" });
    const created = await createStudyTemplate(db, user, { name: "Swing", body }, { mintId });
    expect(created.ok).toBe(true);
    const listed = await listStudyTemplates(db, user);
    expect(listed).toMatchObject({ ok: true, unreadable: 0 });
    expect(listed.ok && listed.templates).toHaveLength(1);
    expect(store.workspaceSettings.find((r) => r.key === "thesis.saved_view.abc")?.value).toEqual({ name: "View" });
  });

  it("reads a newer build's record but refuses to rewrite it", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    const id = "e".repeat(32);
    fixtureStore("tpl").workspaceSettings.push({
      scope: "user", user_id: user, owner_id: user, key: studyTemplateSettingsKey(id),
      value: { v: STUDY_TEMPLATE_VERSION + 1, id, name: "Future", indicators: ["rsi"], revision: 3, extra: { kept: true } },
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const listed = await listStudyTemplates(db, user);
    expect(listed.ok && listed.templates[0]).toMatchObject({ id, newer: true, revision: 3 });
    expect(await updateStudyTemplate(db, user, { id, baseRevision: 3, name: "Downgraded" })).toMatchObject({ ok: false, status: "newer_version" });
    const row = fixtureStore("tpl").workspaceSettings.find((r) => r.key === studyTemplateSettingsKey(id));
    expect((row?.value as { extra?: unknown }).extra).toEqual({ kept: true });
    expect(await deleteStudyTemplate(db, user, { id })).toEqual({ ok: true });
  });

  it("reports an unavailable store instead of an empty library or a saved template", async () => {
    const user = fixtureUserId("tpl::a");
    const readDown = createFixtureDb("tpl::a", [FAULT_SAVED_VIEWS_READ]);
    expect(await listStudyTemplates(readDown, user)).toMatchObject({ ok: false });
    expect(await createStudyTemplate(readDown, user, { name: "X", body }, { mintId })).toMatchObject({ ok: false, status: "unavailable" });

    const writeDown = createFixtureDb("tpl::a", [FAULT_WORKSPACE_SETTINGS_WRITE]);
    expect(await createStudyTemplate(writeDown, user, { name: "X", body }, { mintId })).toMatchObject({ ok: false, status: "unavailable" });
    expect(fixtureStore("tpl").workspaceSettings).toHaveLength(0);

    const up = createFixtureDb("tpl::a");
    const created = await createStudyTemplate(up, user, { name: "Y", body }, { mintId });
    if (!created.ok) throw new Error("create failed");
    expect(await updateStudyTemplate(writeDown, user, { id: created.template.id, baseRevision: 1, name: "Z" })).toMatchObject({ ok: false, status: "unavailable" });
    expect(await deleteStudyTemplate(writeDown, user, { id: created.template.id })).toMatchObject({ ok: false, status: "unavailable" });
    const listed = await listStudyTemplates(up, user);
    expect(listed.ok && listed.templates.map((t) => [t.name, t.revision])).toEqual([["Y", 1]]);
  });

  it("refuses malformed ids", async () => {
    const db = createFixtureDb("tpl::a");
    const user = fixtureUserId("tpl::a");
    expect(await updateStudyTemplate(db, user, { id: "../x", baseRevision: 1 })).toEqual({ ok: false, status: "invalid_id" });
    expect(await deleteStudyTemplate(db, user, { id: 4 })).toEqual({ ok: false, status: "invalid_id" });
    expect(await createStudyTemplate(db, user, { name: "X", body }, { mintId: () => "nope" })).toEqual({ ok: false, status: "invalid_id" });
  });
});
