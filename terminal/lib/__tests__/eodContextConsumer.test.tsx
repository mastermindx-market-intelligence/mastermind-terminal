// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEodContext } from "@/components/eodcontext/useEodContext";
const transport = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({ flowGet: transport.get }));
let node: HTMLDivElement, root: Root;
const frames: string[] = [];
function Consumer({ instrument, active = true, lens = "chain" }: { instrument: string; active?: boolean; lens?: string }) {
  const data = useEodContext(instrument, active);
  frames.push(instrument + ":" + (data.vol?.root ?? "none"));
  return <output>{lens}:{data.vol?.root ?? "none"}</output>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); frames.length = 0;
  transport.get.mockReset().mockResolvedValue(null);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
it("retains one acquisition lifecycle across lens switches and clears archived inputs", async () => {
  transport.get.mockImplementation(async (key: string) => key.startsWith("vol:") ? { root: key.slice(4) } : null);
  await act(async () => root.render(<Consumer instrument="SPY" />));
  await act(async () => root.render(<Consumer instrument="SPY" lens="volatility" />));
  expect(transport.get.mock.calls.filter(([key]) => key === "vol:SPY")).toHaveLength(1);
  expect(node.textContent).toBe("volatility:SPY");
  await act(async () => root.render(<Consumer instrument="SPY" active={false} />));
  expect(node.textContent).toBe("chain:none");
});
it("cannot expose the prior root while a new request waits or an older request completes", async () => {
  let settleOld: (value: unknown) => void = () => {};
  transport.get.mockImplementation((key: string) => key === "vol:SPY" ? new Promise(resolve => { settleOld = resolve; })
    : Promise.resolve(key === "vol:QQQ" ? { root: "QQQ" } : null));
  await act(async () => root.render(<Consumer instrument="SPY" />));
  await act(async () => root.render(<Consumer instrument="QQQ" />));
  await act(async () => settleOld({ root: "SPY" }));
  expect(node.textContent).toBe("chain:QQQ");
  expect(frames).not.toContain("QQQ:SPY");
});
