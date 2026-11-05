import projection from "./sharedShellRoutes.generated.json";
import { resolveShellTarget, type ShellRouteCatalog, type ShellLocale } from "./sharedShellContracts";

export const SHARED_SHELL_LEGACY_ORIGIN = "https://www.mastermind-x.com";
export const SHARED_SHELL_ORIGIN = "https://beta.mastermind-x.com";
export const sharedShellCatalog: ShellRouteCatalog = {
  legacyPaths: projection.legacyPaths,
  nativePaths: projection.nativePaths,
};
const legacy = new Set(projection.legacyPaths);
const directory = new Map(projection.directory.map(page => [page.href, page]));
export const sharedShellDirectory = projection.directory;
export const sharedShellSource = projection.sources;

export function isLegacyShellPath(path: string): boolean { return legacy.has(path); }
export function shellPageLabel(path: string, locale: ShellLocale): string {
  const page = directory.get(path);
  return page?.title[locale] || path.split("/").pop()?.replace(/\.html$/, "").replace(/[_-]/g, " ") || "Mastermind";
}
export function resolveSharedShellLink(href: string, canonical: string,
  shellOrigin = SHARED_SHELL_ORIGIN, legacyOrigin = SHARED_SHELL_LEGACY_ORIGIN) {
  return resolveShellTarget(href, canonical, shellOrigin, legacyOrigin, sharedShellCatalog);
}

/** Transport is appended without URLSearchParams reserializing market/filter query bytes. */
export function legacyFrameHref(canonical: string, generation: string, origin = SHARED_SHELL_LEGACY_ORIGIN): string {
  const target = resolveSharedShellLink(canonical, canonical, SHARED_SHELL_ORIGIN, origin);
  if (target.kind !== "legacy" || !/^[\w-]{1,128}$/.test(generation))
    throw new Error("Invalid Shared Shell frame target");
  const hashAt = target.href.indexOf("#");
  const path = hashAt < 0 ? target.href : target.href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : target.href.slice(hashAt);
  return origin + path + (path.includes("?") ? "&" : "?")
    + "mmx_shell=1&mmx_generation=" + generation + hash;
}
