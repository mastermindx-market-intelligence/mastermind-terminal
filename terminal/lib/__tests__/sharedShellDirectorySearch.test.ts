import { expect, it } from "vitest";
import { directoryEntryTitle, searchDirectoryEntries, type DirectoryEntry } from "@/lib/sharedShellDirectorySearch";
import { sharedShellCatalog, sharedShellDirectory } from "@/lib/sharedShellRoutes";
import { LEX } from "@/lib/i18n";
import { SHARED_SHELL_COPY } from "@/lib/sharedShellCopy";
import prospectiveCalculators from "../../docs/pr-crops/shared-search-ss05-20261103/calculator-directory-ebfce2ac.fixture.json";
const t=(key:string,fallback?:string)=>SHARED_SHELL_COPY[key]?.("zh")??LEX[key]?.[1]??fallback??key;
it.each([["今日","Today","/today"],["提醒","Alerts","/alerts"],["期货","Futures","/options/futures"],["终端","Terminal","/terminal"],["学习","Learn","/learn"]])("preserves existing native bilingual label %s and canonical alias %s",(zh,en,href)=>{
 const chinese=searchDirectoryEntries(sharedShellDirectory,sharedShellCatalog.legacyPaths,zh).find(x=>x.href===href);
 const english=searchDirectoryEntries(sharedShellDirectory,sharedShellCatalog.legacyPaths,en).find(x=>x.href===href);
 expect(chinese).toBeTruthy();expect(english?.href).toBe(chinese?.href);expect(directoryEntryTitle(chinese as DirectoryEntry,"zh",t)).toBe(zh);
});
it("never synthesizes unknown, excluded or off-origin tool destinations",()=>{
 for(const q of ["https://evil.example/x","/admin/unpublished123.html","nonexistentzzzz123","expectation_surface"]){
  expect(searchDirectoryEntries(sharedShellDirectory,sharedShellCatalog.legacyPaths,q)).toEqual([]);
 }
 const rows=searchDirectoryEntries(sharedShellDirectory,sharedShellCatalog.legacyPaths,"cagr");expect(rows.map(x=>x.href)).toContain("/tools/calculators/cagr.html");
 expect(rows.every(x=>sharedShellCatalog.legacyPaths.includes(x.href)||sharedShellCatalog.nativePaths.includes(x.href))).toBe(true);
});
it("deduplicates the existing directory and concrete family members without changing their hrefs",()=>{
 const rows=searchDirectoryEntries(sharedShellDirectory,sharedShellCatalog.legacyPaths,"stock");expect(new Set(rows.map(x=>x.href)).size).toBe(rows.length);
 expect(rows.every(x=>sharedShellCatalog.legacyPaths.includes(x.href)||sharedShellCatalog.nativePaths.includes(x.href))).toBe(true);
});
it.each(prospectiveCalculators.directoryOnlyAdditions)("uses the canonical bilingual title for already-admitted $href",row=>{
 expect(sharedShellCatalog.legacyPaths).toContain(row.href);
 const directory=[...sharedShellDirectory,row];
 for(const lang of ["en","zh"] as const){
  const result=searchDirectoryEntries(directory,sharedShellCatalog.legacyPaths,row.title[lang]).find(entry=>entry.href===row.href);
  expect(result?.href).toBe(row.href);
  expect(directoryEntryTitle(result as DirectoryEntry,lang,t)).toBe(row.title[lang]);
  expect(result?.title[lang]).not.toContain("tools / calculators /");
 }
});


// Original intelligence integration must extend the current directory owner,
// not resurrect the removed component-local matcher or admit a second route set.
it.each([
 ["/intelligence", "Overview", "总览"],
 ["/macro.html", "Macro Dashboard", "宏观仪表盘"],
 ["/sector_cycles.html", "Sector Cycles", "行业周期"],
 ["/sectors", "Sector Intelligence", "行业情报"],
])("keeps intelligence title/search parity at the existing directory owner: %s", (href, en, zh) => {
 const canonical = sharedShellDirectory.find(entry => entry.href === href);
 expect(canonical).toBeTruthy();
 expect(directoryEntryTitle(canonical as DirectoryEntry, "en", (key, fallback) => SHARED_SHELL_COPY[key]?.("en") ?? fallback ?? key)).toBe(en);
 expect(directoryEntryTitle(canonical as DirectoryEntry, "zh", t)).toBe(zh);
 for (const query of [en, zh]) expect(searchDirectoryEntries(sharedShellDirectory, sharedShellCatalog.legacyPaths, query).some(entry => entry.href === href)).toBe(true);
 expect(searchDirectoryEntries([], [], zh)).toEqual([]);
});
it("keeps the separately entitled model-plan/options entrance distinct from the primary Prophet stock board", () => {
 const paid = sharedShellDirectory.find(entry => entry.href === "/prophet") as DirectoryEntry;
 const board = sharedShellDirectory.find(entry => entry.href === "/us_stocks.html") as DirectoryEntry;
 expect(paid).toBeTruthy(); expect(board).toBeTruthy();
 expect(directoryEntryTitle(paid, "en", (key, fallback) => SHARED_SHELL_COPY[key]?.("en") ?? fallback ?? key)).toBe("Model plans & options");
 expect(directoryEntryTitle(board, "en", (key, fallback) => fallback ?? key)).toBe("Prophet");
 expect(searchDirectoryEntries(sharedShellDirectory, sharedShellCatalog.legacyPaths, "模型计划").some(entry => entry.href === "/prophet")).toBe(true);
});
