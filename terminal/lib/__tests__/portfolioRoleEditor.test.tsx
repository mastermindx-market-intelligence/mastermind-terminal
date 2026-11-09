// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import PortfolioRoleEditor from "@/components/PortfolioRoleEditor";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const edit=(value:string) => act(() => { const input=host.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); });
it("requires explicit save, preserves failed draft, and never claims success on an uncertain response", async () => {
  const save=vi.fn().mockRejectedValue(new Error("unconfirmed"));
  act(()=>root.render(<PortfolioRoleEditor ticker="AAA" roleLabel="Old" available lang="en" onSave={save}/>));
  edit("New label"); expect(save).not.toHaveBeenCalled();
  await act(async()=>host.querySelector("button")!.click());
  expect(save).toHaveBeenCalledWith("New label");
  expect(host.querySelector("input")!.value).toBe("New label");
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("not confirmed");
  expect(host.textContent).not.toContain("saved and confirmed");
});
it("clears explicitly and renders text as text in both languages", async () => {
  const save=vi.fn().mockResolvedValue(undefined);
  act(()=>root.render(<PortfolioRoleEditor ticker="AAA" roleLabel="<img src=x>" available lang="zh" onSave={save}/>));
  expect(host.querySelector("img")).toBeNull();
  edit(""); await act(async()=>host.querySelector("button")!.click());
  expect(save).toHaveBeenCalledWith(null);
  expect(host.textContent).toContain("角色标签已确认保存");
});
it("does not offer a write when the additive schema is unavailable", () => {
  const save=vi.fn();
  act(()=>root.render(<PortfolioRoleEditor ticker="AAA" available={false} lang="en" onSave={save}/>));
  expect(host.querySelector("input")).toBeNull(); expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toContain("Weight targets remain usable");
});
