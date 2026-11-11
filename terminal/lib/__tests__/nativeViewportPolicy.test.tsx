// @vitest-environment jsdom
import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/terminal", query: "", pathnameReads: 0, queryReads: 0 }));
vi.mock("next/navigation", () => ({
  usePathname: () => { route.pathnameReads++; return route.pathname; },
  useSearchParams: () => { route.queryReads++; return new URLSearchParams(route.query); },
}));
import NativeViewportPolicy from "@/components/NativeViewportPolicy";
import { applicationViewport } from "@/lib/shared-shell/metadata";

const ordinary = "width=device-width, initial-scale=1, viewport-fit=cover";
const viewport = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
let root: Root | undefined;
async function paint() {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => { root!.render(<NativeViewportPolicy />); });
}
async function unmount() {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  route.pathname = "/terminal"; route.query = ""; route.pathnameReads = 0; route.queryReads = 0;
  document.head.innerHTML = '<meta name="viewport" content="' + ordinary + '">';
  document.body.innerHTML = "";
  delete (window as Window & { webkit?: unknown }).webkit;
});
afterEach(async () => {
  await unmount();
  delete (window as Window & { webkit?: unknown }).webkit;
});

describe("native viewport policy without a server streaming boundary", () => {
  it("renders null on the server without evaluating Next URL hooks", () => {
    expect(renderToString(<NativeViewportPolicy />)).toBe("");
    expect(route.pathnameReads).toBe(0);
    expect(route.queryReads).toBe(0);
    expect(viewport().content).toBe(ordinary);
  });

  it.each(["0", "1"])("retains server zoom metadata and restores it on a same-path query change, flag %s", async (flag) => {
    const policy = applicationViewport(flag);
    expect(policy).not.toHaveProperty("maximumScale");
    expect(policy).not.toHaveProperty("userScalable");
    const serverContent = Object.entries(policy).map(([key, value]) =>
      `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}=${value}`,
    ).join(", ");
    viewport().content = serverContent;
    await paint();
    expect(route.queryReads).toBeGreaterThan(0);
    expect(viewport().content).toBe(serverContent);
    route.query = "shell=app";
    await paint();
    expect(viewport().content).toContain("user-scalable=no");
    expect(document.querySelectorAll('meta[name="viewport"]')).toHaveLength(1);
    route.query = "";
    await paint();
    expect(viewport().content).toBe(serverContent);
  });

  it("retains the actual-handler branch across path changes and releases only its own value", async () => {
    Object.assign(window, { webkit: { messageHandlers: { mm: { postMessage() {} } } } });
    await paint();
    expect(viewport().content).toContain("maximum-scale=1");
    route.pathname = "/embed/chart";
    await paint();
    expect(viewport().content).toContain("user-scalable=no");
    delete (window as Window & { webkit?: unknown }).webkit;
    route.pathname = "/terminal";
    await paint();
    expect(viewport().content).toBe(ordinary);
  });

  it("does not overwrite newer route metadata during cleanup", async () => {
    route.query = "shell=app";
    await paint();
    expect(viewport().content).toContain("user-scalable=no");
    const newer = "width=device-width, initial-scale=1.25, viewport-fit=cover";
    viewport().content = newer;
    await unmount();
    expect(viewport().content).toBe(newer);
  });
});
