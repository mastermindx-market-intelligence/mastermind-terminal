/** Shared Shell's route and message boundary. No auth or navigation effects live here. */
export const SHARED_SHELL_PROTOCOL = "mmx.shared-shell.v1" as const;
export const SHARED_SHELL_BRIDGE_VERSION = "20261018.1" as const;
export const SHARED_SHELL_DOCUMENT_VERSION = "20261018.1" as const;
export type ShellTheme = "dark" | "light";
export type ShellLocale = "en" | "zh";
export type ShellRouteCatalog = {
  legacyPaths: readonly string[];
  nativePaths: readonly string[];
};
export type ShellTarget =
  | { kind: "legacy" | "native"; href: string }
  | { kind: "external"; href: string }
  | { kind: "blocked"; reason: string };

const MAX_HREF = 8192;
const MAX_GENERATION = 128;
const TRANSPORT_KEYS = new Set(["mmx_shell", "mmx_generation"]);

export function isSharedShellEnabled(value: unknown): boolean {
  return value === "1";
}

function bareOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return /^(http:|https:)$/.test(url.protocol)
      && !url.username && !url.password && url.pathname === "/"
      && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

/** Keep ordinary query bytes, including repeats, while removing bridge transport state. */
function withoutTransport(search: string): string {
  if (!search) return "";
  const parts = search.slice(1).split("&").filter(part => {
    try {
      const key = decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " "));
      return !TRANSPORT_KEYS.has(key);
    } catch { return true; }
  });
  return parts.length ? "?" + parts.join("&") : "";
}

export function resolveShellTarget(
  href: string,
  canonicalPath: string,
  shellOrigin: string,
  legacyOrigin: string,
  catalog: ShellRouteCatalog,
): ShellTarget {
  const blocked = (reason: string): ShellTarget => ({ kind: "blocked", reason });
  if (typeof href !== "string" || !href.trim() || href.length > MAX_HREF)
    return blocked("invalid_link");
  const shell = bareOrigin(shellOrigin);
  const legacy = bareOrigin(legacyOrigin);
  if (!shell || !legacy) return blocked("invalid_origin");
  if (typeof canonicalPath !== "string" || canonicalPath.length > MAX_HREF
    || !canonicalPath.startsWith("/") || canonicalPath.startsWith("//")
    || canonicalPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(canonicalPath))
    return blocked("invalid_base");
  if (!catalog || !Array.isArray(catalog.legacyPaths) || !Array.isArray(catalog.nativePaths))
    return blocked("invalid_catalog");
  const legacyPaths = new Set(catalog.legacyPaths);
  const nativePaths = new Set(catalog.nativePaths);
  if ([...legacyPaths].some(path => nativePaths.has(path)))
    return blocked("route_collision");
  try {
    const base = new URL(canonicalPath, legacy);
    if (base.origin !== legacy) return blocked("invalid_base");
    const url = new URL(href, base);
    if (url.username || url.password) return blocked("credentials");
    if (url.protocol === "mailto:" || url.protocol === "tel:")
      return { kind: "external", href: url.href };
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return blocked("unsupported_scheme");
    if (url.origin !== shell && url.origin !== legacy)
      return { kind: "external", href: url.href };
    const cleanHref = url.pathname + withoutTransport(url.search) + url.hash;
    if (nativePaths.has(url.pathname)) return { kind: "native", href: cleanHref };
    if (legacyPaths.has(url.pathname)) return { kind: "legacy", href: cleanHref };
    return blocked("unknown_route");
  } catch { return blocked("invalid_link"); }
}

type Envelope = {
  protocol: typeof SHARED_SHELL_PROTOCOL;
  frameGeneration: string;
};
export type ShellViewState = { x: number; y: number; focusId?: string };
export type ShellChildMessage =
  | (Envelope & {
      type: "READY"; title: string; href: string; contextRevision: number;
      bridgeVersion: string; documentVersion: string;
    })
  | (Envelope & {
      type: "NAVIGATE"; href: string; mode: "push" | "replace";
      sameDocument: boolean; requestId: string;
    })
  | (Envelope & { type: "VIEW_STATE"; view: ShellViewState })
  | (Envelope & { type: "AUTH_REQUEST"; intent: "signin" | "signup" | "settings" | "billing" })
  | (Envelope & { type: "CONTEXT_REQUEST"; theme?: ShellTheme; locale?: ShellLocale })
  | (Envelope & {
      type: "ERROR";
      code: "initialization_failed" | "unsupported_context" | "navigation_unavailable" | "authentication_navigation";
    });

export type ShellContext = {
  theme: ShellTheme;
  locale: ShellLocale;
  contextRevision: number;
};
export type ShellParentMessage =
  | (Envelope & ShellContext & {
      type: "INIT"; canonicalPath: string; catalog: ShellRouteCatalog;
      restore: ShellViewState | null;
    })
  | (Envelope & ShellContext & { type: "CONTEXT" })
  | (Envelope & { type: "LOCATION_ACCEPTED"; requestId: string; canonicalPath: string })
  | (Envelope & { type: "VISIBILITY"; visible: boolean });

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function boundedString(value: unknown, limit: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= limit;
}
function exactKeys(data: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(["protocol", "type", "frameGeneration", ...keys]);
  return ["protocol", "type", "frameGeneration"].every(key => Object.hasOwn(data, key))
    && Object.keys(data).every(key => expected.has(key));
}
function ownFields(data: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(key => Object.hasOwn(data, key));
}

/** URLs carrying authentication material must never become bridge messages. */
export function isPresentationHref(href: unknown): href is string {
  if (!boundedString(href, MAX_HREF)) return false;
  try {
    const url = new URL(href, "https://www.mastermind-x.com");
    const sensitive = /^(access_token|refresh_token|token_hash|id_token|code_verifier|authorization)$/i;
    for (const segment of [url.search, url.hash.replace(/^#/, "?")]) {
      const params = new URLSearchParams(segment);
      for (const key of params.keys()) if (sensitive.test(key)) return false;
      if (params.get("type") === "recovery" || params.get("type") === "signup") return false;
      if (params.has("code") && (/^\/(auth|login|reset-password)(\/|$)/.test(url.pathname)
        || params.has("onboard"))) return false;
    }
    return true;
  } catch { return false; }
}

export function readShellViewState(value: unknown): ShellViewState | null {
  if (!plainObject(value) || !ownFields(value, ["x", "y"])
    || Object.keys(value).some(key => !["x", "y", "focusId"].includes(key))
    || typeof value.x !== "number" || typeof value.y !== "number"
    || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || value.x < 0 || value.y < 0 || value.x > 10_000_000 || value.y > 10_000_000
    || (Object.hasOwn(value, "focusId") && (!boundedString(value.focusId, 128)
      || !/^[\w:.-]+$/.test(value.focusId)))) return null;
  return { x: value.x, y: value.y, ...(value.focusId ? { focusId: value.focusId as string } : {}) };
}

/** Schema validation alone never authorizes NAVIGATE or establishes version compatibility. */
export function readShellChildMessage(
  event: { origin: string; source: unknown; data: unknown },
  expected: { origin: string; source: unknown; frameGeneration: string },
): ShellChildMessage | null {
  try {
    if (!event || !expected || expected.source == null
      || (typeof expected.source !== "object" && typeof expected.source !== "function")
      || event.source !== expected.source || event.origin !== expected.origin
      || !bareOrigin(expected.origin)
      || !boundedString(expected.frameGeneration, MAX_GENERATION)) return null;
    const data = event.data;
    if (!plainObject(data) || data.protocol !== SHARED_SHELL_PROTOCOL
      || data.frameGeneration !== expected.frameGeneration) return null;
    const common: Envelope = { protocol: SHARED_SHELL_PROTOCOL, frameGeneration: expected.frameGeneration };
    switch (data.type) {
      case "READY":
        if (!exactKeys(data, ["title", "href", "contextRevision", "bridgeVersion", "documentVersion"])
          || !ownFields(data, ["title", "href", "contextRevision", "bridgeVersion", "documentVersion"])
          || !boundedString(data.title, 240, true) || !isPresentationHref(data.href)
          || !boundedString(data.bridgeVersion, 64) || !boundedString(data.documentVersion, 64)
          || !Number.isSafeInteger(data.contextRevision) || (data.contextRevision as number) < 0) return null;
        return { ...common, type: "READY", title: data.title, href: data.href,
          contextRevision: data.contextRevision as number, bridgeVersion: data.bridgeVersion,
          documentVersion: data.documentVersion };
      case "NAVIGATE":
        return exactKeys(data, ["href", "mode", "sameDocument", "requestId"])
          && ownFields(data, ["href", "mode", "sameDocument", "requestId"])
          && isPresentationHref(data.href) && (data.mode === "push" || data.mode === "replace")
          && typeof data.sameDocument === "boolean" && boundedString(data.requestId, 128)
          ? { ...common, type: "NAVIGATE", href: data.href, mode: data.mode,
            sameDocument: data.sameDocument, requestId: data.requestId } : null;
      case "VIEW_STATE": {
        const view = exactKeys(data, ["view"]) && ownFields(data, ["view"]) ? readShellViewState(data.view) : null;
        return view ? { ...common, type: "VIEW_STATE", view } : null;
      }
      case "AUTH_REQUEST":
        return exactKeys(data, ["intent"]) && ownFields(data, ["intent"])
          && ["signin", "signup", "settings", "billing"].includes(data.intent as string)
          ? { ...common, type: "AUTH_REQUEST", intent: data.intent as "signin" | "signup" | "settings" | "billing" } : null;
      case "CONTEXT_REQUEST": {
        if (!exactKeys(data, ["theme", "locale"])
          || !(Object.hasOwn(data, "theme") || Object.hasOwn(data, "locale"))
          || (Object.hasOwn(data, "theme") && data.theme !== "dark" && data.theme !== "light")
          || (Object.hasOwn(data, "locale") && data.locale !== "en" && data.locale !== "zh")) return null;
        return { ...common, type: "CONTEXT_REQUEST",
          ...(data.theme ? { theme: data.theme as ShellTheme } : {}),
          ...(data.locale ? { locale: data.locale as ShellLocale } : {}) };
      }
      case "ERROR":
        return exactKeys(data, ["code"]) && ownFields(data, ["code"])
          && ["initialization_failed", "unsupported_context", "navigation_unavailable",
              "authentication_navigation"].includes(data.code as string)
          ? { ...common, type: "ERROR", code: data.code as "initialization_failed" | "unsupported_context" | "navigation_unavailable" | "authentication_navigation" } : null;
      default: return null;
    }
  } catch { return null; }
}

/** Actual build identity supplied by the existing release owner. */
export const SHARED_SHELL_BUILD = process.env.NEXT_PUBLIC_SHARED_SHELL_BUILD || "unversioned";
