import {describe,expect,it} from "vitest";
import {listLayouts,saveLayout,saveWorkspace,renameWorkspace,duplicateWorkspace,type LayoutDbResult} from "../layouts";
import {createLayoutFixtureDb,fixtureLayoutUserId,pokeLayoutFixtureRow} from "../layoutsFixtureDb";
const v1=()=>({schema:"workspace_layout.v1",requires:{floor:1},revision:1,name:null,link_groups:{},widgets:[],migration:{source:"none",source_revision:null}});
describe("old workspace writers preserve unsupported stored formats",()=>{
 for(const format of ["schema","floor"] as const)for(const mode of ["numbered","conversion","legacy","rename","duplicate"] as const){
  it(`${mode} cannot replace a future ${format}`,async()=>{
   const key=`version-fence-${format}-${mode}`,db=createLayoutFixtureDb(key),user=fixtureLayoutUserId(key);
   const created=await saveWorkspace(db,user,"Future",v1(),null);expect(created.ok).toBe(true);
   const future={...v1(),...(format==="schema"?{schema:"workspace_layout.v2"}:{requires:{floor:2}}),future_owner_state:{retain:"exact"}};
   pokeLayoutFixtureRow(key,user,"Future",{config:future});
   const result=mode==="rename"?await renameWorkspace(db,user,"Future","Renamed",1,created.ok?created.id:undefined):mode==="duplicate"?await duplicateWorkspace(db,user,"Future","Copy",created.ok?created.id:undefined):mode==="legacy"?await saveLayout(db,user,{name:"Future",config:{panes:["AAPL"]},mode:"overwrite"}):await saveWorkspace(db,user,"Future",v1(),mode==="numbered"?1:null,created.ok?created.id:undefined);
   expect(result.ok).toBe(false);
   const listed=await listLayouts(db,user);expect(listed.ok).toBe(true);expect(listed.ok&&listed.layouts).toHaveLength(1);
   expect(listed.ok&&listed.layouts.find(row=>row.name==="Future")?.config).toEqual(future);
  });
 }
});

describe("supported format fences remain atomic and preserve old readers", () => {
  const malformedRequirements = [null, [], "1", { floor: null }, { floor: "1" }, { floor: 1, future: true }, { future: true }];
  for (const [index, requires] of malformedRequirements.entries()) {
    for (const mode of ["numbered", "rename", "duplicate"] as const) {
      it(`${mode} preserves malformed requirements ${index}`, async () => {
        const key = `malformed-requires-${index}-${mode}`, db = createLayoutFixtureDb(key), user = fixtureLayoutUserId(key);
        const created = await saveWorkspace(db, user, "Preserve", v1(), null);
        expect(created.ok).toBe(true);
        const stored = { ...v1(), requires };
        pokeLayoutFixtureRow(key, user, "Preserve", { config: stored });
        const id = created.ok ? created.id : undefined;
        const result = mode === "numbered" ? await saveWorkspace(db, user, "Preserve", v1(), 1, id)
          : mode === "rename" ? await renameWorkspace(db, user, "Preserve", "Renamed", 1, id)
          : await duplicateWorkspace(db, user, "Preserve", "Copy", id);
        expect(result.ok).toBe(false);
        const listed = await listLayouts(db, user);
        expect(listed.ok && listed.layouts).toHaveLength(1);
        expect(listed.ok && listed.layouts[0].name).toBe("Preserve");
        expect(listed.ok && listed.layouts[0].config).toEqual(stored);
      });
    }
    it(`rename rejects requirements ${index} arriving after its read`, async () => {
      const key = `rename-requires-race-${index}`, db = createLayoutFixtureDb(key), user = fixtureLayoutUserId(key);
      const created = await saveWorkspace(db, user, "Preserve", v1(), null);
      const stored = { ...v1(), requires };
      const racingDb = { from(table: string) {
        const query = db.from(table);
        return new Proxy(query, { get(target, property) {
          if (property === "update") return (values: Record<string, unknown>) => {
            pokeLayoutFixtureRow(key, user, "Preserve", { config: stored });
            return target.update(values);
          };
          return Reflect.get(target, property);
        } });
      } };
      expect((await renameWorkspace(racingDb, user, "Preserve", "Renamed", 1, created.ok ? created.id : undefined)).ok).toBe(false);
      const listed = await listLayouts(db, user);
      expect(listed.ok && listed.layouts[0].name).toBe("Preserve");
      expect(listed.ok && listed.layouts[0].config).toEqual(stored);
    });
  }
  for (const omitted of ["requires", "floor"] as const) {
    it(`saves an omitted ${omitted} without reading or consulting unapplied team columns`, async () => {
      const key = `supported-omitted-${omitted}`, db = createLayoutFixtureDb(key), user = fixtureLayoutUserId(key);
      const created = await saveWorkspace(db, user, "Compatible", v1(), null);
      expect(created.ok).toBe(true);
      const stored: Record<string, unknown> = { ...v1() };
      if (omitted === "requires") delete stored.requires;
      else stored.requires = {};
      pokeLayoutFixtureRow(key, user, "Compatible", { config: stored });
      const failingReads = createLayoutFixtureDb(key, "list");
      const oldSchemaDb = {
        from(table: string) {
          const target = failingReads.from(table);
          let missingColumn = false;
          const proxy = new Proxy(target, {
            get(object, property) {
              if (property === "then") return (resolve: (value: LayoutDbResult) => unknown) =>
                (missingColumn ? Promise.resolve({ error: { code: "42703", message: "visibility column absent" } }) : Promise.resolve(target)).then(resolve);
              const member = Reflect.get(object, property);
              if (typeof member !== "function") return member;
              return (...args: unknown[]) => {
                if (property === "eq" && args[0] === "visibility") missingColumn = true;
                const result = member.apply(target, args);
                return result === target ? proxy : result;
              };
            },
          });
          return proxy;
        },
      };
      expect(await saveWorkspace(oldSchemaDb, user, "Compatible", v1(), 1, created.ok ? created.id : undefined))
        .toEqual({ ok: true, id: created.ok ? created.id : "", revision: 2 });
    });
  }
  for (const format of ["schema", "floor"] as const) {
    it(`refuses a rename if a future ${format} arrives after its source read`, async () => {
      const key = `rename-upgrade-${format}`, db = createLayoutFixtureDb(key), user = fixtureLayoutUserId(key);
      const created = await saveWorkspace(db, user, "Future", v1(), null);
      expect(created.ok).toBe(true);
      const future = { ...v1(), ...(format === "schema" ? { schema: "workspace_layout.v2" } : { requires: { floor: 2 } }), future_owner_state: { retain: "exact" } };
      const concurrentDb = {
        from(table: string) {
          const target = db.from(table);
          return new Proxy(target, {
            get(object, property) {
              if (property === "update") return (values: Record<string, unknown>) => {
                pokeLayoutFixtureRow(key, user, "Future", { config: future });
                return target.update(values);
              };
              return Reflect.get(object, property);
            },
          });
        },
      };
      expect((await renameWorkspace(concurrentDb, user, "Future", "Renamed", 1, created.ok ? created.id : undefined)).ok).toBe(false);
      const listed = await listLayouts(db, user);
      expect(listed.ok && listed.layouts).toHaveLength(1);
      expect(listed.ok && listed.layouts[0].name).toBe("Future");
      expect(listed.ok && listed.layouts[0].config).toEqual(future);
    });
  }
});


describe("workspace rename never stamps identity onto legacy configuration", () => {
  for (const schema of [undefined, null]) {
    it(`preserves a legacy row with ${String(schema)} schema and an overlapping revision`, async () => {
      const key = `rename-legacy-identity-${String(schema)}`;
      const db = createLayoutFixtureDb(key), user = fixtureLayoutUserId(key);
      const created = await saveWorkspace(db, user, "Legacy", v1(), null);
      expect(created.ok).toBe(true);
      const legacy = { ...(schema === undefined ? {} : { schema }), name: "owner-native-name", revision: 1, panes: [{ symbol: "AAPL" }], custom: { retain: "exact" } };
      pokeLayoutFixtureRow(key, user, "Legacy", { config: legacy });
      expect(await renameWorkspace(db, user, "Legacy", "Renamed", 1, created.ok ? created.id : undefined))
        .toEqual({ ok: false, reason: "stale_revision" });
      const listed = await listLayouts(db, user);
      expect(listed.ok && listed.layouts).toHaveLength(1);
      expect(listed.ok && listed.layouts[0].name).toBe("Legacy");
      expect(listed.ok && listed.layouts[0].config).toEqual(legacy);
    });
  }
});
