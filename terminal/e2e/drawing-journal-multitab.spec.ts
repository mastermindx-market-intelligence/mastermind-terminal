import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import path from "node:path";

// Execute the actual committed persistence module with the browser's own Web
// Locks and shared localStorage; this is not a mock lock implementation.
const bundle = buildSync({
  entryPoints: [path.resolve(process.cwd(), "lib/drawingOutbox.ts")],
  bundle: true, write: false, format: "iife", globalName: "A04Journal",
  platform: "browser", tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
}).outputFiles[0].text;
const line = (id: string) => ({ id, kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 }] });
async function load(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await page.addScriptTag({ content: bundle });
}

test("real browser locks preserve simultaneous tabs and another tab's acknowledged deletion", async ({ page, context }) => {
  const second = await context.newPage();
  try {
    await load(page); await load(second);
    await page.evaluate(() => {
      localStorage.removeItem("mm.drawing.account-outbox.v1");
      (window as any).journal = (window as any).A04Journal.readDrawingJournal(localStorage, "account:multitab");
    });
    await second.evaluate(() => {
      (window as any).journal = (window as any).A04Journal.readDrawingJournal(localStorage, "account:multitab");
    });
    const saved = await Promise.all([
      page.evaluate(async drawing => {
        (window as any).journal.NVDA = { drawings: [drawing], revision: null };
        return (window as any).A04Journal.writeDrawingJournal(localStorage, "account:multitab", (window as any).journal);
      }, line("A")),
      second.evaluate(async drawing => {
        (window as any).journal.AAPL = { drawings: [drawing], revision: null };
        return (window as any).A04Journal.writeDrawingJournal(localStorage, "account:multitab", (window as any).journal);
      }, line("B")),
    ]);
    expect(saved).toEqual([true, true]);
    await page.evaluate(async () => {
      delete (window as any).journal.NVDA;
      await (window as any).A04Journal.writeDrawingJournal(localStorage, "account:multitab", (window as any).journal);
    });
    const recovered = await second.evaluate(() => (window as any).A04Journal.readDrawingJournal(localStorage, "account:multitab"));
    expect(recovered.AAPL.drawings[0].id).toBe("B"); expect(recovered.NVDA).toBeUndefined();
  } finally { await second.close(); }
});

async function readLegacyInBothTabs(first: Page, second: Page, owner: string) {
  await load(first); await load(second);
  await first.evaluate(({ owner, drawing }) => {
    const api = (window as any).A04Journal;
    api.writeDrawingOutbox(localStorage, owner, { NVDA: [drawing] });
    (window as any).journal = api.readDrawingJournal(localStorage, owner);
  }, { owner, drawing: line("legacy") });
  await second.evaluate(owner => {
    (window as any).journal = (window as any).A04Journal.readDrawingJournal(localStorage, owner);
  }, owner);
}

test("two real tabs adopt the same physical legacy import instead of duplicating it", async ({ page, context }) => {
  const second = await context.newPage(), owner = "account:two-importers";
  try {
    await readLegacyInBothTabs(page, second, owner);
    const importedId = await second.evaluate(async owner => {
      const api = (window as any).A04Journal, journal = (window as any).journal;
      if (!await api.writeDrawingJournal(localStorage, owner, journal)) throw new Error("Import was not durable");
      return journal.NVDA.recoveryId;
    }, owner);
    const reconciled = await page.evaluate(async owner => {
      const api = (window as any).A04Journal;
      const journal = api.reconcileDrawingJournal(localStorage, owner, (window as any).journal);
      const durable = await api.writeDrawingJournal(localStorage, owner, journal);
      const recovered = api.readDrawingJournal(localStorage, owner).NVDA;
      return { durable, id: recovered.recoveryId, alternatives: recovered.alternatives ?? [] };
    }, owner);
    expect(reconciled).toEqual({ durable: true, id: importedId, alternatives: [] });
  } finally { await second.close(); }
});

test("a real stale importer acknowledges only its physical preimage and preserves a newer edit", async ({ page, context }) => {
  const second = await context.newPage(), owner = "account:import-ack";
  try {
    await readLegacyInBothTabs(page, second, owner);
    const legacyBytes = await page.evaluate(() => localStorage.getItem("mm.drawing.account-outbox.v1"));
    expect(await second.evaluate(async owner => (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal), owner)).toBe(true);
    expect(await page.evaluate(async owner => {
      delete (window as any).journal.NVDA;
      return (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal);
    }, owner)).toBe(true);
    expect(await page.evaluate(owner => (window as any).A04Journal.readDrawingJournal(localStorage, owner).NVDA, owner)).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem("mm.drawing.account-outbox.v1"))).toBe(legacyBytes);

    const editedOwner = "account:import-ack-edited";
    await readLegacyInBothTabs(page, second, editedOwner);
    expect(await second.evaluate(async ({ owner, drawing }) => {
      const api = (window as any).A04Journal, journal = (window as any).journal;
      if (!await api.writeDrawingJournal(localStorage, owner, journal)) return false;
      journal.NVDA.drawings = [drawing];
      return api.writeDrawingJournal(localStorage, owner, journal);
    }, { owner: editedOwner, drawing: line("newer-edit") })).toBe(true);
    expect(await page.evaluate(async owner => {
      delete (window as any).journal.NVDA;
      return (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal);
    }, editedOwner)).toBe(true);
    const remaining = await page.evaluate(owner => (window as any).A04Journal.readDrawingJournal(localStorage, owner).NVDA, editedOwner);
    expect(remaining.drawings[0].id).toBe("newer-edit");
  } finally { await second.close(); }
});

test("a real stale importer cannot resurrect the snapshot another tab acknowledged", async ({ page, context }) => {
  const second = await context.newPage(), owner = "account:retired-import";
  try {
    await readLegacyInBothTabs(page, second, owner);
    expect(await second.evaluate(async owner => {
      const api = (window as any).A04Journal, journal = (window as any).journal;
      if (!await api.writeDrawingJournal(localStorage, owner, journal)) return false;
      delete journal.NVDA;
      return api.writeDrawingJournal(localStorage, owner, journal);
    }, owner)).toBe(true);
    expect(await page.evaluate(async owner => (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal), owner)).toBe(true);
    const result = await page.evaluate(owner => ({
      memory: (window as any).journal.NVDA,
      durable: (window as any).A04Journal.readDrawingJournal(localStorage, owner).NVDA,
    }), owner);
    expect(result).toEqual({ memory: undefined, durable: undefined });
  } finally { await second.close(); }
});

for (const legacy of [true, false]) {
test(`two hydrated real tabs keep an observed ${legacy ? "import" : "modern copy"} retired after one acknowledges it`, async ({ page, context }) => {
  const second = await context.newPage(), owner = "account:hydrated-retirement";
  try {
    if (legacy) await readLegacyInBothTabs(page, second, owner);
    else {
      await load(page); await load(second);
      await page.evaluate(async ({owner, drawing}) => {
        const api = (window as any).A04Journal;
        if (!await api.writeDrawingJournal(localStorage, owner, {NVDA:{drawings:[drawing],revision:null}})) throw new Error("Copy was not durable");
        (window as any).journal = api.readDrawingJournal(localStorage, owner);
      }, {owner, drawing:line("modern")});
      await second.evaluate(owner => { (window as any).journal = (window as any).A04Journal.readDrawingJournal(localStorage, owner); }, owner);
    }
    expect(await page.evaluate(async owner => (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal), owner)).toBe(true);
    expect(await second.evaluate(async owner => {
      const api = (window as any).A04Journal, journal = (window as any).journal;
      if (!await api.writeDrawingJournal(localStorage, owner, journal)) return false;
      delete journal.NVDA; return api.writeDrawingJournal(localStorage, owner, journal);
    }, owner)).toBe(true);
    expect(await page.evaluate(async owner => (window as any).A04Journal.writeDrawingJournal(localStorage, owner, (window as any).journal), owner)).toBe(true);
    expect(await page.evaluate(owner => ({
      memory: (window as any).journal.NVDA,
      durable: (window as any).A04Journal.readDrawingJournal(localStorage, owner).NVDA,
    }), owner)).toEqual({ memory: undefined, durable: undefined });
  } finally { await second.close(); }
});
}

test("real same-origin tabs retain distinct same-symbol copies including a clear tombstone", async ({ page, context }) => {
  const second = await context.newPage();
  try {
    await load(page); await load(second);
    await page.evaluate(() => localStorage.removeItem("mm.drawing.account-outbox.v1"));
    const saved = await Promise.all([
      page.evaluate(async drawing => (window as any).A04Journal.writeDrawingJournal(localStorage, "account:multitab", { NVDA: { drawings: [drawing], revision: null } }), line("A")),
      second.evaluate(async () => (window as any).A04Journal.writeDrawingJournal(localStorage, "account:multitab", { NVDA: { drawings: [], revision: null } })),
    ]);
    expect(saved).toEqual([true, true]);
    const recovered = await page.evaluate(() => (window as any).A04Journal.readDrawingJournal(localStorage, "account:multitab").NVDA);
    expect([recovered, ...recovered.alternatives].map(copy => copy.drawings.map((d: any) => d.id)))
      .toEqual(expect.arrayContaining([["A"], []]));
  } finally { await second.close(); }
});

test("an already-open legacy writer cannot erase a modern exact retry or resurrect an acknowledged clear",async({page,context})=>{
 const old=await context.newPage();
 try{
  await load(page);await load(old);
  const owner="account:legacy-tab",operationId="11111111-1111-4111-8111-111111111111";
  const saved=await page.evaluate(async({owner,operationId,drawing})=>(window as any).A04Journal.writeDrawingJournal(localStorage,owner,{NVDA:{drawings:[drawing],revision:null,attempt:{operationId,expectedRevision:null,drawings:[drawing]}}}),{owner,operationId,drawing:line("modern")});
  expect(saved).toBe(true);
  expect(await old.evaluate(owner=>(window as any).A04Journal.writeDrawingOutbox(localStorage,owner,{AAPL:[]}),owner)).toBe(true);
  const recovered=await page.evaluate(owner=>(window as any).A04Journal.readDrawingJournal(localStorage,owner),owner);
  expect(recovered.NVDA.attempt.operationId).toBe(operationId);expect(recovered.NVDA.drawings[0].id).toBe("modern");
  expect(recovered.AAPL).toMatchObject({drawings:[],blocked:"legacy"});
  expect(await page.evaluate(async owner=>{
   const journal=(window as any).A04Journal.readDrawingJournal(localStorage,owner);
   delete journal.AAPL;return (window as any).A04Journal.writeDrawingJournal(localStorage,owner,journal);
  },owner)).toBe(true);
  await page.reload();await page.addScriptTag({content:bundle});
  const reloaded=await page.evaluate(owner=>(window as any).A04Journal.readDrawingJournal(localStorage,owner),owner);
  expect(reloaded.AAPL).toBeUndefined();expect(reloaded.NVDA.attempt.operationId).toBe(operationId);
 }finally{await old.close();}
});
