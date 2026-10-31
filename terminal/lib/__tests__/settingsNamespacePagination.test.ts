import { beforeEach, expect, it } from "vitest";
import { createFixtureDb, fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import { createScreen, listScreens } from "@/lib/smartScreen/store";
import { MAX_SCREENS, screenKey } from "@/lib/smartScreen/record";
import { createSavedView, listSavedViews, MAX_SAVED_VIEWS, savedViewSettingsKey } from "@/lib/savedViews";
import record from "./fixtures/investigation_screen_record.json";

const key = "settings-namespace-cap";
const actor = fixtureUserId(key);
const id = (n: number) => n.toString(16).padStart(32, "0");
const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const view = (n: number) => ({ id: uuid(n), name: `View ${n}`, filter: { lifecycle: "active" as const },
  createdAt: record.createdAt, updatedAt: record.updatedAt });
const row = (name: string, value: unknown, owner = actor, scope = "user") => ({
  id: name, key: name, value, scope, user_id: owner, updated_at: record.updatedAt,
});

function cappedDb() {
  const db = createFixtureDb(key);
  // Model the response cap after database predicates, before application parsing.
  return { from: (table: string) => db.from(table).limit(1000) };
}

beforeEach(() => {
  resetFixtureStores();
  const rows = fixtureStore(key).workspaceSettings;
  for (let i = 0; i < 2000; i++) rows.push(row(`scr_def.${id(i)}`, record));
  // A SQL LIKE underscore is a wildcard unless escaped. These must not consume the page.
  for (let i = 0; i < 1000; i++) {
    rows.push(row(`scrxscreen.${id(i)}`, record));
    rows.push(row(`rmsxsavedxview.${id(i)}`, view(i)));
    rows.push(row(screenKey(id(i)), record, "another-owner"));
    rows.push(row(savedViewSettingsKey(uuid(i)), view(i), actor, "workspace"));
  }
});

it("lists every owned screen and preserves cap/retry behavior behind 2000 retained archives", async () => {
  for (let n = 1; n <= MAX_SCREENS; n++) {
    fixtureStore(key).workspaceSettings.push(row(screenKey(id(n)), { ...record, id: id(n), rev: 1 }));
  }
  const db = cappedDb();
  const listed = await listScreens(db, actor);
  expect(listed.ok && listed.screens.map((screen) => screen.id)).toEqual(
    Array.from({ length: MAX_SCREENS }, (_, n) => id(n + 1)),
  );
  expect(await createScreen(db, actor, { ...record, id: id(999) })).toMatchObject({ ok: false, error: "limit_reached" });
  expect(await createScreen(db, actor, { ...record, id: id(1) })).toMatchObject({ ok: true, replay: true });
});

it("keeps saved views visible and enforces their cap without counting screen archives", async () => {
  for (let n = 1; n <= MAX_SAVED_VIEWS; n++) {
    fixtureStore(key).workspaceSettings.push(row(savedViewSettingsKey(uuid(n)), view(n)));
  }
  const db = cappedDb();
  const listed = await listSavedViews(db, actor);
  expect(listed.ok && listed.views.map((item) => item.id)).toEqual(
    Array.from({ length: MAX_SAVED_VIEWS }, (_, n) => uuid(n + 1)),
  );
  expect(await createSavedView(db, actor, { ...view(999) })).toMatchObject({ ok: false, status: "limit_reached" });
});
