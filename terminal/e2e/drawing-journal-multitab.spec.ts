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
