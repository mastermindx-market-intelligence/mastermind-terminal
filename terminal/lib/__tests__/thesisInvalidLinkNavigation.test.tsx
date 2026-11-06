// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  prefetch?: boolean;
  onNavigate?: (event: { preventDefault: () => void }) => void;
};
const link = vi.hoisted(() => ({ current: null as LinkProps | null }));
// Exercise the real invalid-route component and its navigation callback against
// Next's documented Link interface. This is not browser navigation evidence.
vi.mock("next/link", () => ({ default: (props: LinkProps) => {
  link.current = props;
  const { children, href, className } = props;
  return <a href={href} className={className}>{children}</a>;
} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  link.current = null;
});

it("returns from an invalid thesis link with a non-prefetched full-document Analysis navigation", async () => {
  window.history.replaceState(null, "", "/analysis?view=theses&thesis=invalid");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<ThesisWorkspace ownerKey="owner-invalid" invalidLink />); });
  const anchor = container.querySelector('[data-testid="thesis-invalid-link"] a');
  expect(anchor?.getAttribute("href")).toBe("/analysis?view=theses");
  expect(anchor?.textContent).toBe("Thesis workspace");
  expect(fetch).not.toHaveBeenCalled();
  expect(link.current, "use the canonical Next Link interface").not.toBeNull();
  expect(link.current!.prefetch).toBe(false);
  expect(link.current!.onNavigate).toBeTypeOf("function");
  const events: string[] = [];
  const assign = vi.fn((href: string) => { events.push(`document:${href}`); });
  const realWindow = window;
  // Replace only the callback's browser boundary; no jsdom navigation is attempted.
  vi.stubGlobal("window", { location: { assign } });
  try {
    link.current!.onNavigate!({ preventDefault: () => { events.push("cancel-soft-route"); } });
  } finally {
    vi.stubGlobal("window", realWindow);
  }
  expect(events).toEqual(["cancel-soft-route", "document:/analysis?view=theses"]);
  expect(assign).toHaveBeenCalledTimes(1);
});
