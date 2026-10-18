import { describe, expect, it } from "vitest";
import {
  isSharedShellEnabled, readShellChildMessage, resolveShellTarget, SHARED_SHELL_PROTOCOL,
} from "../sharedShellContracts";

const shell = "https://beta.mastermind-x.com";
const legacy = "https://www.mastermind-x.com";
const catalog = {
  legacyPaths: ["/macro.html", "/china.html", "/sector_central.html", "/stocks/AAPL.html", "/learn/basics/risk.html"],
  nativePaths: ["/analysis", "/terminal", "/portfolio"],
};
const resolve = (href: string, base = "/macro.html") =>
  resolveShellTarget(href, base, shell, legacy, catalog);

describe("Shared Shell route contract", () => {
  it("enables only the exact server flag", () => {
    expect(isSharedShellEnabled("1")).toBe(true);
    for (const value of [undefined, null, true, false, 1, "true", " 1 ", "0"])
      expect(isSharedShellEnabled(value)).toBe(false);
  });
  it("resolves root, relative and nested paths against the canonical Macro document", () => {
    expect(resolve("china.html")).toEqual({ kind: "legacy", href: "/china.html" });
    expect(resolve("../macro.html", "/stocks/AAPL.html")).toEqual({ kind: "legacy", href: "/macro.html" });
    expect(resolve("../../china.html", "/learn/basics/risk.html")).toEqual({ kind: "legacy", href: "/china.html" });
    expect(resolve(legacy + "/stocks/AAPL.html")).toEqual({ kind: "legacy", href: "/stocks/AAPL.html" });
    expect(resolve(shell + "/analysis?symbol=AAPL")).toEqual({ kind: "native", href: "/analysis?symbol=AAPL" });
  });
  it("keeps exact ordinary query bytes and fragments while removing only transport keys", () => {
    expect(resolve("/sector_central.html?q=hello%20world&q=a%2Bb&mmx_shell=1&x=%252F&mmx_generation=g#confluence"))
      .toEqual({ kind: "legacy", href: "/sector_central.html?q=hello%20world&q=a%2Bb&x=%252F#confluence" });
    expect(resolve("?q=one&q=two#chart")).toEqual({ kind: "legacy", href: "/macro.html?q=one&q=two#chart" });
    expect(resolve("?%6dmx_shell=1&theme=light")).toEqual({ kind: "legacy", href: "/macro.html?theme=light" });
  });
  it("leaves external browser destinations external", () => {
    for (const href of ["//example.com/macro.html", "https://example.com/macro.html", "mailto:help@example.com", "tel:+123"])
      expect(resolve(href).kind).toBe("external");
  });
  it("blocks unsupported schemes, credential URLs and unadmitted paths", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/a", "blob:https://beta.mastermind-x.com/x",
      "https://user:pass@www.mastermind-x.com/macro.html", "/admin", "/data/private.json",
      "/stocks/private.json", "/stocks/../admin", "/stocks/%2e%2e/admin", "/stocks/%252e%252e/admin",
      "/api/private", "/macro.html/extra", "/_mockup_ccw_credit_desk.html"])
      expect(resolve(href).kind, href).toBe("blocked");
  });
  it("fails closed for malformed input and configuration", () => {
    for (const href of ["", " ", "x".repeat(8193), null as unknown as string, "https://["])
      expect(resolve(href).kind).toBe("blocked");
    for (const origin of ["https://beta.mastermind-x.com/path", "https://user@beta.mastermind-x.com", "data:x", "https://beta.mastermind-x.com?q=x"])
      expect(resolveShellTarget("/macro.html", "/macro.html", origin, legacy, catalog).kind).toBe("blocked");
    for (const base of ["//evil.example/", "macro.html", "/\\evil.example/", "/macro.html\n"])
      expect(resolve("china.html", base).kind).toBe("blocked");
    expect(resolveShellTarget("/macro.html", "/macro.html", shell, legacy,
      { ...catalog, nativePaths: ["/macro.html"] })).toEqual({ kind: "blocked", reason: "route_collision" });
  });
});

const frame = {};
const expected = { origin: legacy, source: frame, frameGeneration: "frame-a" };
const envelope = { protocol: SHARED_SHELL_PROTOCOL, frameGeneration: "frame-a" };
const read = (data: unknown) => readShellChildMessage({ origin: legacy, source: frame, data }, expected);

describe("Shared Shell child message contract", () => {
  it("constructs only the four allowed variants", () => {
    for (const data of [
      { ...envelope, type: "READY", title: "Market overview", contextRevision: 0 },
      { ...envelope, type: "NAVIGATE", href: "/china.html" },
      { ...envelope, type: "CONTEXT_REQUEST", theme: "light" },
      { ...envelope, type: "CONTEXT_REQUEST", locale: "zh" },
      { ...envelope, type: "CONTEXT_REQUEST", theme: "dark", locale: "en" },
      { ...envelope, type: "ERROR", code: "initialization_failed" },
      { ...envelope, type: "ERROR", code: "unsupported_context" },
      { ...envelope, type: "ERROR", code: "navigation_unavailable" },
    ]) {
      expect(read(data)).toEqual(data);
      expect(read(data)).not.toBe(data);
    }
  });
  it("requires the exact frame window, origin and generation", () => {
    const data = { ...envelope, type: "READY", title: "", contextRevision: 1 };
    expect(readShellChildMessage({ origin: shell, source: frame, data }, expected)).toBeNull();
    expect(readShellChildMessage({ origin: legacy, source: {}, data }, expected)).toBeNull();
    expect(readShellChildMessage({ origin: legacy, source: null, data }, { ...expected, source: null })).toBeNull();
    expect(read({ ...data, frameGeneration: "retired-frame" })).toBeNull();
    expect(readShellChildMessage({ origin: legacy, source: frame, data }, { ...expected, frameGeneration: "" })).toBeNull();
  });
  it("rejects unknown fields and invalid variant values", () => {
    const ready = { ...envelope, type: "READY", title: "Market", contextRevision: 0 };
    for (const data of [null, [], "ready", {}, { ...ready, token: "never accepted" },
      { ...ready, protocol: "mmx.shared-shell.v2" }, { ...ready, type: "RUN_COMMAND" },
      { ...ready, contextRevision: -1 }, { ...ready, contextRevision: 0.5 },
      { ...ready, contextRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...ready, contextRevision: undefined }, { ...ready, title: "x".repeat(241) },
      { ...envelope, type: "NAVIGATE", href: "" },
      { ...envelope, type: "NAVIGATE", href: "x".repeat(8193) },
      { ...envelope, type: "CONTEXT_REQUEST" },
      { ...envelope, type: "CONTEXT_REQUEST", theme: "system" },
      { ...envelope, type: "CONTEXT_REQUEST", locale: "cn" },
      { ...envelope, type: "CONTEXT_REQUEST", theme: undefined },
      { ...envelope, type: "ERROR", code: "execute" }])
      expect(read(data)).toBeNull();
    expect(readShellChildMessage({ origin: legacy, source: frame, data: { ...ready, frameGeneration: "x".repeat(129) } },
      { ...expected, frameGeneration: "x".repeat(129) })).toBeNull();
  });
  it("does not conflate a valid NAVIGATE envelope with route authorization", () => {
    const message = read({ ...envelope, type: "NAVIGATE", href: "/admin" });
    expect(message?.type).toBe("NAVIGATE");
    expect(resolve("/admin").kind).toBe("blocked");
  });
});
