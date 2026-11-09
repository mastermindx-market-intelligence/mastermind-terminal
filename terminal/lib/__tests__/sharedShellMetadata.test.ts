import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applicationMetadata, applicationViewport, workspaceMetadata } from "@/lib/shared-shell/metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
beforeEach(() => vi.stubEnv("MMX_SHARED_SHELL", ""));
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, null, "", "0", "true", "enabled", 1, true])("preserves legacy identity and chart gestures without exact opt-in: %s", flag => {
 expect(applicationMetadata(flag).title).toBe("Mastermind Terminal");
 expect(workspaceMetadata("Today", undefined, flag).title).toBe("Today · Mastermind Terminal");
 expect(applicationViewport(flag)).toEqual({ width: "device-width", initialScale: 1, viewportFit: "cover", maximumScale: 1, userScalable: false });
});
it("restores browser magnification without imposing a second zoom ceiling", () => {
 expect(applicationViewport("1")).toEqual({ width: "device-width", initialScale: 1, viewportFit: "cover" });
 expect(applicationViewport("1")).not.toHaveProperty("maximumScale");
 expect(applicationViewport("1")).not.toHaveProperty("userScalable");
});
it.each(["Today", "Discover", "Analysis", "Monitor", "Research", "Portfolio", "Terminal"])("uses one product identity with exact workspace title: %s", name => {
 expect(workspaceMetadata(name, undefined, "1").title).toBe(`${name} · Mastermind`);
});
it("preserves the inherited Portfolio and Terminal title outside beta", () => {
 for (const name of ["Portfolio", "Terminal"]) expect(workspaceMetadata(name, "Mastermind Terminal").title).toBe("Mastermind Terminal");
});
it("uses the current server flag by default without client state or cookies", () => {
 vi.stubEnv("MMX_SHARED_SHELL", "1");
 expect(applicationMetadata().title).toBe("Mastermind");
 expect(workspaceMetadata("Research").title).toBe("Research · Mastermind");
 expect(applicationViewport()).not.toHaveProperty("userScalable");
});
it("wires the actual root and native pages without a competing metadata owner", () => {
 const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
 const root = source("app/layout.tsx");
 expect(root).toContain("export const viewport: Viewport = applicationViewport();");
 expect(root).toContain("export const metadata: Metadata = applicationMetadata();");
 for (const name of ["today", "discover", "analysis", "monitor", "research", "portfolio", "options", "alerts", "scripts", "research-assistant"]) {
  expect(source(`app/(shell)/${name}/page.tsx`)).toContain('import { workspaceMetadata } from "@/lib/shared-shell/metadata";');
  expect(source(`app/(shell)/${name}/page.tsx`)).toMatch(/export const metadata(?:: Metadata)? = workspaceMetadata\(/);
 }
 expect(source("app/terminal/layout.tsx")).toContain('workspaceMetadata("Terminal", "Mastermind Terminal")');
});
