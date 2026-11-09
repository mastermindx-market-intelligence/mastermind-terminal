import { LEX } from "@/lib/i18n";
import { futuresTextFor } from "@/lib/futuresUiCopy";
import { SHARED_SHELL_COPY } from "@/lib/sharedShellCopy";
import { SHARED_SHELL_NAV } from "@/lib/sharedShellNavigation";
import { INTELLIGENCE_DESTINATIONS } from "@/lib/shared-shell/intelligenceNavigation";
export type DirectoryEntry = { href: string; kind: string; title: { en: string; zh: string }; group: string };
export function directorySection(entry: DirectoryEntry): string {
  if (entry.kind === "native") return "workspaces";
  if (/^\/learn(?:[/.]|$)|^\/reference/.test(entry.href)) return "learn";
  if (/^\/(?:research|blog|stocks\/earnings)/.test(entry.href)) return "research";
  if (/^\/tools\//.test(entry.href) || entry.href.includes("calc")) return "tools";
  if (/^(public_nav|footer)\./.test(entry.group)) return "about";
  return "markets";
}
export const normalizeDirectoryQuery = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();
// These native tools already use these keys in AppShell's title owner. Keep
// directory presentation on those keys; the projection still owns admission.
const nativeTitle = (entry: DirectoryEntry): { k?: string; label: string; copy?: DirectoryEntry["title"] } | undefined => {
  const intelligence = INTELLIGENCE_DESTINATIONS.find(item => item.href === entry.href);
  if (intelligence) return { label: intelligence.label[0], copy: { en: intelligence.label[0], zh: intelligence.label[1] } };
  if (entry.kind !== "native") return undefined;
  if (entry.href === "/prophet") return { k: "shellProphet", label: "Model plans & options" };
  const job = SHARED_SHELL_NAV.find(job => job.href === entry.href);
  if (job) return job;
  if (entry.href === "/options/futures") return {
    label: futuresTextFor("en").navTitle,
    copy: { en: futuresTextFor("en").navTitle, zh: futuresTextFor("zh").navTitle },
  };
  const k = entry.href === "/terminal" ? "setTerminal"
    : entry.href === "/learn" ? "shellSection_learn"
    : entry.href === "/alerts" ? "alerts"
    : entry.href === "/options" ? "options"
    : entry.href === "/scripts" ? "scripts"
    : entry.href === "/dislocations" ? "pageDislocations" : undefined;
  return k ? { k, label: entry.title.en } : undefined;
};

export function directoryEntryTitle(entry: DirectoryEntry, lang: "en" | "zh", t: (key: string, fallback?: string) => string): string {
  const job = nativeTitle(entry);
  if (!job) return entry.title[lang];
  return job.copy ? job.copy[lang] : job.k ? t(job.k, job.label) : job.label;
}

/** Search only supplied canonical members. This helper cannot admit or synthesize a route. */
export function searchDirectoryEntries(directory: readonly DirectoryEntry[], legacyPaths: readonly string[], query: string,
  category = "all"): DirectoryEntry[] {
  const tokens = normalizeDirectoryQuery(query).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const result: DirectoryEntry[] = [];
  const ranked = [...directory].sort((a, b) => {
    const ai = SHARED_SHELL_NAV.findIndex(n => n.href === a.href);
    const bi = SHARED_SHELL_NAV.findIndex(n => n.href === b.href);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
  });
  for (const entry of ranked) {
    if (seen.has(entry.href) || (category !== "all" && directorySection(entry) !== category)) continue;
    const job = nativeTitle(entry);
    const aliases = job ? [job.label, job.copy?.en, job.copy?.zh,
      ...(job.k ? [SHARED_SHELL_COPY[job.k]?.("en"), SHARED_SHELL_COPY[job.k]?.("zh"), ...(LEX[job.k] ?? [])] : [])] : [];
    if (!tokens.every(token => normalizeDirectoryQuery([entry.title.en, entry.title.zh, entry.href, ...aliases].join(" ")).includes(token))) continue;
    seen.add(entry.href); result.push(entry);
  }
  if (tokens.length && category !== "workspaces" && category !== "about") {
    for (const href of legacyPaths) {
      if (seen.has(href) || !tokens.every(token => normalizeDirectoryQuery(href).includes(token))) continue;
      const label = href.replace(/^\//, "").replace(/\.html$/, "").replace(/[_-]/g, " ").replace(/\//g, " / ");
      const entry: DirectoryEntry = { href, kind: "legacy", title: { en: label, zh: label }, group: "none" };
      if (category !== "all" && directorySection(entry) !== category) continue;
      result.push(entry); seen.add(href);
    }
  }
  return result;
}
