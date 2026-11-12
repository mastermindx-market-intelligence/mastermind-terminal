// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";
import { COMPANY_SEARCH_HISTORY_KEY } from "@/lib/companySearchContext";
import type { SharedSearchOptions } from "@/components/SharedSearchWorkspace";
type PickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchSeed?: string;
  sharedSearch?: SharedSearchOptions;
};
const state = vi.hoisted(() => ({
  push: vi.fn(),
  props: null as PickerProps | null,
  tool: { href: "/tools/calculators/cagr.html", query: "compound" },
}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:state.push})}));
vi.mock("@/lib/activeSymbol",()=>({useActiveSymbol:()=>"BABA",writeActiveSymbol:vi.fn()}));
vi.mock("@/components/SymbolPicker", () => ({
  default: (props: PickerProps) => {
    state.props = props;
    return <section><button onClick={() => props.sharedSearch?.onOpenTool(state.tool.href, state.tool.query)}>open tool</button></section>;
  },
}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;const opened=vi.fn();
beforeEach(()=>{state.push.mockReset();opened.mockReset();state.tool={href:"/tools/calculators/cagr.html",query:"compound"};window.history.replaceState({nextRouter:"retain",other:42},"","/discover?view=tools&q=a%20b&q=a+b#current-position");host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
function MountedSearch() {
  const [open, setOpen] = useState(true);
  return <>
    <ShellSearch open={open} onOpenChange={setOpen} />
    <button data-programmatic-open onClick={() => setOpen(true)}>open companies</button>
  </>;
}
async function traverse(direction: "back" | "forward") {
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener("popstate", () => resolve(), { once: true });
      window.history[direction]();
    });
  });
}

it("returns from a finite tool to exact origin/query/scope/selection without rewriting Next history fields",async()=>{
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));const origin=window.location.href;
 await act(async()=>(host.querySelector("button") as HTMLButtonElement).click());
 expect(state.push).toHaveBeenCalledWith("/tools/calculators/cagr.html");expect(window.location.href).toBe(origin);
 const previous=window.history.state;expect(previous.nextRouter).toBe("retain");expect(previous.other).toBe(42);
 expect(previous[COMPANY_SEARCH_HISTORY_KEY]).toEqual({scope:"tools",query:"compound",selected:"/tools/calculators/cagr.html",href:origin});
 window.history.replaceState(null,"","/tools/calculators/cagr.html");window.history.replaceState(previous,"",origin);
 await act(async()=>window.dispatchEvent(new PopStateEvent("popstate")));
 expect(opened).toHaveBeenLastCalledWith(true);expect(state.props?.searchSeed).toBe("compound");expect(state.props?.sharedSearch?.scope).toBe("tools");expect(state.props?.sharedSearch?.selectedTool).toBe("/tools/calculators/cagr.html");expect(window.location.href).toBe(origin);
});
it("refuses off-origin and protocol-relative destinations even at the host callback boundary",async()=>{
 await act(async()=>root.render(<ShellSearch open onOpenChange={opened}/>));const origin=window.location.href;
 await act(async()=>{state.props?.sharedSearch?.onOpenTool("https://evil.example/x","x");state.props?.sharedSearch?.onOpenTool("//evil.example/x","x");});expect(state.push).not.toHaveBeenCalled();expect(window.location.href).toBe(origin);
});
it("keeps an AppShell-controlled company opening after explicitly closing a restored Tools search", async () => {
  const href = window.location.href;
  const originState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["discover"] } };
  window.history.replaceState({
    ...originState,
    [COMPANY_SEARCH_HISTORY_KEY]: { scope: "tools", query: "learn", selected: "/learn.html", href },
  }, "", href);
  await act(async () => root.render(<MountedSearch />));
  expect(state.props?.sharedSearch?.scope).toBe("tools");

  await act(async () => state.props?.onOpenChange(false));
  expect(state.props?.open).toBe(false);
  expect(window.history.state).toEqual(originState);
  await act(async () => host.querySelector<HTMLButtonElement>("[data-programmatic-open]")?.click());
  expect(state.props?.sharedSearch?.scope).toBe("companies");
  expect(state.props?.searchSeed).toBe("learn");
  expect(window.location.href).toBe(href);

  const unrelated = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["monitor"] } };
  window.history.pushState(unrelated, "", "/monitor");
  await traverse("back");
  expect(state.props?.open).toBe(true);
  expect(window.history.state).toEqual(originState);
});

it("closes a restored Tools search on a nonmatching Forward entry and restores the same result on Back", async () => {
  state.tool = { href: "/learn.html", query: "learn" };
  const originState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["discover"] }, nextRouter: "retain", other: 42 };
  window.history.replaceState(originState, "", window.location.href);
  await act(async () => root.render(<MountedSearch />));
  const origin = window.location.href;
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(state.push).toHaveBeenCalledWith(state.tool.href);
  const marker = { scope: "tools", query: "learn", selected: "/learn.html", href: origin };
  const returnState = { ...originState, [COMPANY_SEARCH_HISTORY_KEY]: marker };
  expect(window.history.state).toEqual(returnState);

  // A well-shaped copy of the marker belongs to the old URL and must not reopen Search.
  const forwardState = {
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["legacy-learn"] },
    [COMPANY_SEARCH_HISTORY_KEY]: marker,
  };
  window.history.pushState(forwardState, "", state.tool.href);
  const expectRestored = () => {
    expect(window.location.href).toBe(origin);
    expect(window.history.state).toEqual(returnState);
    expect(state.props?.open).toBe(true);
    expect(state.props?.sharedSearch?.scope).toBe("tools");
    expect(state.props?.searchSeed).toBe("learn");
    expect(state.props?.sharedSearch?.selectedTool).toBe("/learn.html");
  };
  await traverse("back");
  expectRestored();

  await traverse("forward");
  expect(window.location.pathname).toBe(state.tool.href);
  expect(state.props?.open).toBe(false);
  expect(window.history.state).toEqual(forwardState);

  await traverse("back");
  expectRestored();
});
