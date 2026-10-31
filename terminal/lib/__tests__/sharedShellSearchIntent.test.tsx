// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ShellSearch from "@/components/chrome/shared-shell/ShellSearch";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  opens: [] as boolean[],
  pickerRenders: 0,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/activeSymbol", () => ({
  useActiveSymbol: () => "NVDA",
  writeActiveSymbol: vi.fn(),
}));
vi.mock("@/lib/sharedShellCopy", () => ({
  useSharedShellT: () => (key: string) => key,
}));
// Mounting this real SymbolPicker starts a manifest read even while its dialog
// is closed. Isolate that child to prove the ShellSearch mount decision itself.
vi.mock("@/components/SymbolPicker", () => ({
  default: (props: { open: boolean; onPick: (value: string) => void }) => {
    state.pickerRenders += 1;
    state.opens.push(props.open);
    return <button data-mounted-picker="" onClick={() => props.onPick("AAPL")}>Live picker</button>;
  },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
const onOpenChange = vi.fn<(open: boolean) => void>();

async function show(open = false) {
  await act(async () => {
    root.render(<ShellSearch open={open} onOpenChange={onOpenChange} />);
  });
}
beforeEach(() => {
  state.pickerRenders = 0;
  state.opens.length = 0;
  state.push.mockReset();
  onOpenChange.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe("Shared Shell company search intent", () => {
  it("presents the same accessible search control without mounting the manifest owner", async () => {
    await show();
    expect(state.pickerRenders).toBe(0);
    const button = host.querySelector<HTMLButtonElement>(".sym-pick.shared-shell-company-search");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    expect(button!.getAttribute("aria-label")).toBe("shellSearchCompanies");
  });
  it("click activates the real picker and keeps canonical symbol navigation", async () => {
    await show();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".shared-shell-company-search")!.click();
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(state.pickerRenders).toBeGreaterThan(0);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-mounted-picker]")!.click();
    });
    expect(state.push).toHaveBeenLastCalledWith("/analysis?symbol=AAPL");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
  it("starts the incumbent picker on pointer intent but does not open it", async () => {
    await show();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".shared-shell-company-search")!
        .dispatchEvent(new Event("pointerover", { bubbles: true }));
    });
    expect(state.pickerRenders).toBeGreaterThan(0);
    expect(state.opens.at(-1)).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("programmatic keyboard open mounts the picker and retains it after closing", async () => {
    await show();
    expect(state.pickerRenders).toBe(0);
    await show(true);
    expect(state.pickerRenders).toBeGreaterThan(0);
    expect(state.opens.at(-1)).toBe(true);
    await show(false);
    expect(host.querySelector("[data-mounted-picker]")).not.toBeNull();
    expect(state.opens.at(-1)).toBe(false);
  });
});
