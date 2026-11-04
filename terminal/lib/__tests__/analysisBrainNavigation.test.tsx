// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiContextClientV1 } from "@/lib/aiContext";

const nav = vi.hoisted(() => ({ path: "/analysis", search: "view=theses&symbol=MU", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ push: nav.push }) }));
vi.mock("next/link", () => ({ default: ({ children, href, prefetch: _prefetch, ...rest }: React.ComponentProps<"a"> & { prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string, fallback?: string) => key === "ai" ? "Mastermind AI" : fallback ?? key }));
vi.mock("@/lib/activeSymbol", () => ({ useActiveSymbol: () => "MU" }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: React.PropsWithChildren) => <>{children}</> }));
vi.mock("@/components/BrandMark", () => ({ BrandLockup: () => <span>Mastermind</span>, BrandMark: () => <span>M</span> }));
vi.mock("@/components/settings/SettingsButton", () => ({ default: () => <button>Settings</button> }));
vi.mock("@/components/DashboardBackButton", () => ({ default: () => <button>Back</button> }));

import { AppNav } from "@/components/AppNav";
import MobileNav from "@/components/MobileNav";
import AnalysisBrainHost from "@/components/chrome/AnalysisBrainHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Host = { MMBrain?: { open: () => void }; MM_BRAIN_CFG?: { getAiContext?: () => AiContextClientV1 | undefined } };
const host = () => window as unknown as Host;
let node: HTMLDivElement;
let root: Root | undefined;
const noop = () => undefined;
function mount(navElement: React.ReactNode, withHost = true) {
  root = createRoot(node);
  act(() => root!.render(<>{withHost && <AnalysisBrainHost active="MU" onCommand={noop} onAnnotate={noop} onAuthRequired={noop} />}{navElement}</>));
}
function clickAI() {
  const button = node.querySelector('button[aria-label="Mastermind AI"]');
  expect(button).not.toBeNull();
  act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
beforeEach(() => {
  nav.path = "/analysis"; nav.push.mockReset();
  node = document.createElement("div"); document.body.append(node);
  delete host().MMBrain; delete host().MM_BRAIN_CFG;
  document.querySelectorAll('script[src="https://www.mastermind-x.com/mm_brain.js"]').forEach(s => s.remove());
});
afterEach(() => {
  if (root) act(() => root!.unmount()); root = undefined;
  node.remove(); vi.useRealTimers();
});

it.each(["desktop", "mobile"])("%s AI opens the real analysis host with thesis context instead of routing to Chart", surface => {
  const readAtOpen = vi.fn(() => host().MM_BRAIN_CFG?.getAiContext?.());
  host().MMBrain = { open: readAtOpen };
  mount(surface === "desktop" ? <AppNav /> : <MobileNav email="" />);
  clickAI();
  expect(readAtOpen).toHaveBeenCalledTimes(1);
  expect(readAtOpen.mock.results[0].value?.ambient).toMatchObject({ page: "analysis", panel: "theses", symbol: "MU" });
  expect(nav.push).not.toHaveBeenCalled();
});
it("first click during widget loading opens once when the existing widget is ready", () => {
  vi.useFakeTimers(); mount(<AppNav />); clickAI();
  const open = vi.fn(); host().MMBrain = { open };
  act(() => vi.advanceTimersByTime(800));
  expect(open).toHaveBeenCalledTimes(1);
  expect(nav.push).not.toHaveBeenCalled();
});
it("leaving Analysis cancels a pending first-click open", () => {
  vi.useFakeTimers(); mount(<AppNav />); clickAI();
  act(() => root!.unmount()); root = undefined;
  const open = vi.fn(); host().MMBrain = { open };
  act(() => vi.advanceTimersByTime(800)); expect(open).not.toHaveBeenCalled();
});
it("other desktop workspaces keep their established Chart AI route", () => {
  nav.path = "/portfolio"; mount(<AppNav />, false); clickAI();
  expect(nav.push).toHaveBeenCalledWith("/terminal?ai=1");
});
it("an explicit mobile copilot owner keeps priority", () => {
  const open = vi.fn(); mount(<MobileNav email="" onOpenCopilot={open} />, false); clickAI();
  expect(open).toHaveBeenCalledTimes(1);
});
