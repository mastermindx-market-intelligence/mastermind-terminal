// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import projection from "../sharedShellRoutes.generated.json";
import SharedShellRuntime from "@/components/chrome/shared-shell/SharedShellRuntime";

const state = vi.hoisted(() => ({ pathname: "/today", hostRenders: 0, directoryRenders: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
// Replace only the Next dynamic chunk boundary; the actual Runtime conditional
// mounts and retained-state effects execute under React.
vi.mock("next/dynamic", () => ({
  default: (loader: unknown) => {
    const name = String(loader);
    if (name.includes("LegacyPageHost")) return function FakeLegacyPageHost() {
      state.hostRenders++;
      return null;
    };
    if (name.includes("ShellDirectory")) return function FakeShellDirectory() {
      state.directoryRenders++;
      return null;
    };
    throw new Error("unexpected dynamic import in SharedShellRuntime");
  },
}));
vi.mock("@/components/chrome/AppShell", () => ({
  useShellIdentity: () => ({ userId: "", email: "" }),
}));
vi.mock("@/lib/accountIdentity", () => ({ identityOwnerKey: () => "guest" }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({
  useSharedShellPresentation: () => ({
    context: { theme: "dark", locale: "en", contextRevision: 0 },
    requestContext: () => undefined,
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const noop = () => undefined;
async function render(pathname: string, directoryOpen = false) {
  state.pathname = pathname;
  await act(async () => {
    root.render(<SharedShellRuntime legacyOrigin="https://www.mastermind-x.com"
      directoryOpen={directoryOpen} onCloseDirectory={noop}
      onOpenDirectory={noop} onSearchCompanies={noop} onTitle={noop} />);
  });
}
beforeEach(() => {
  state.pathname = "/today";
  state.hostRenders = 0;
  state.directoryRenders = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("Shared Shell native first-frame cost", () => {
  it("does not mount the 13k-route consumers while switching native workspaces", async () => {
    await render("/today");
    await render("/research");
    await render("/monitor");
    expect(state.hostRenders).toBe(0);
    expect(state.directoryRenders).toBe(0);
  });
  it("keeps the legacy host mounted after first use for history/view restoration", async () => {
    await render("/macro.html");
    expect(state.hostRenders).toBeGreaterThan(0);
    const first = state.hostRenders;
    await render("/today");
    expect(state.hostRenders).toBeGreaterThan(first);
  });
  it("keeps directory state mounted after its first open", async () => {
    await render("/today");
    expect(state.directoryRenders).toBe(0);
    await render("/today", true);
    expect(state.directoryRenders).toBeGreaterThan(0);
    const first = state.directoryRenders;
    await render("/research");
    expect(state.directoryRenders).toBeGreaterThan(first);
  });
  it("defers both heavy consumers with separate dynamic import boundaries", () => {
    const src = readFileSync(path.resolve(__dirname, "../../components/chrome/shared-shell/SharedShellRuntime.tsx"), "utf8");
    expect(src).toContain('dynamic(() => import("./LegacyPageHost"), { ssr: false })');
    expect(src).toContain('dynamic(() => import("./ShellDirectory"), { ssr: false })');
    expect(src).not.toMatch(/import\s+(?:LegacyPageHost|ShellDirectory)\s+from/);
  });
  it("enforces the light .html hint against every generated admitted legacy route", () => {
    expect(projection.legacyPaths.length).toBeGreaterThan(10_000);
    expect(projection.legacyPaths.filter(route => !route.endsWith(".html"))).toEqual([]);
  });
});
