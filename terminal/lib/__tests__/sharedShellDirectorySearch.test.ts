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
