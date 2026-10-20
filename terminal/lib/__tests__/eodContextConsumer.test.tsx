// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEodContext } from "@/components/eodcontext/useEodContext";
const transport = vi.hoisted(() => ({ get: vi.fn(), getResult: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/flowClientCache", () => ({
  flowGet: transport.get,
  flowGetResult: transport.getResult,
  flowInvalidate: transport.invalidate,
}));
let node: HTMLDivElement, root: Root;
const frames: string[] = [];
function Consumer({ instrument, active = true, lens = "chain", status = false }: {
  instrument: string; active?: boolean; lens?: string; status?: boolean;
}) {
  const data = useEodContext(instrument, active);
  frames.push(instrument + ":" + (data.vol?.root ?? "none"));
  return <><output>{lens}:{data.vol?.root ?? "none"}{status ? ":" + data.volStatus : ""}</output>
    <button onClick={data.retryVol}>Retry IV</button></>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); frames.length = 0;
  transport.get.mockReset().mockResolvedValue(null);
  transport.getResult.mockReset().mockResolvedValue({ status: "absent" });
  transport.invalidate.mockReset();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
it("retains one IV acquisition lifecycle across lens switches and clears archived inputs", async () => {
  transport.getResult.mockImplementation(async (key: string) => key.startsWith("vol:")
    ? { status: "data", data: { root: key.slice(4) } } : { status: "absent" });
  await act(async () => root.render(<Consumer instrument="SPY" />));
  await act(async () => root.render(<Consumer instrument="SPY" lens="volatility" />));
  expect(transport.getResult.mock.calls.filter(([key]) => key === "vol:SPY")).toHaveLength(1);
  expect(node.querySelector("output")?.textContent).toBe("volatility:SPY");
  await act(async () => root.render(<Consumer instrument="SPY" active={false} />));
  expect(node.querySelector("output")?.textContent).toBe("chain:none");
});
it("cannot expose the prior root while a new request waits or an older request completes", async () => {
  let settleOld: (value: unknown) => void = () => {};
  transport.getResult.mockImplementation((key: string) => key === "vol:SPY"
    ? new Promise(resolve => { settleOld = resolve; })
    : Promise.resolve({ status: "data", data: { root: "QQQ" } }));
  await act(async () => root.render(<Consumer instrument="SPY" />));
  await act(async () => root.render(<Consumer instrument="QQQ" />));
  await act(async () => settleOld({ status: "data", data: { root: "SPY" } }));
  expect(node.querySelector("output")?.textContent).toBe("chain:QQQ");
  expect(frames).not.toContain("QQQ:SPY");
});
it("keeps 503 retryable and recovers only the existing root's IV key", async () => {
  let reads = 0;
  transport.getResult.mockImplementation(async () => ++reads === 1
    ? { status: "unavailable" } : { status: "data", data: { root: "SPY" } });
  await act(async () => root.render(<Consumer instrument="SPY" status />));
  expect(node.querySelector("output")?.textContent).toBe("chain:none:unavailable");
  await act(async () => (node.querySelector("button") as HTMLButtonElement).click());
  expect(node.querySelector("output")?.textContent).toBe("chain:SPY:data");
  expect(transport.invalidate).toHaveBeenCalledTimes(1);
  expect(transport.invalidate).toHaveBeenCalledWith("vol:SPY");
  expect(transport.getResult).toHaveBeenCalledTimes(2);
});
it("preserves a verified same-root IV snapshot when a later read becomes unavailable", async () => {
  let reads = 0;
  transport.getResult.mockImplementation(async () => ++reads === 1
    ? { status: "data", data: { root: "SPY" } } : { status: "unavailable" });
  await act(async () => root.render(<Consumer instrument="SPY" status />));
  expect(node.querySelector("output")?.textContent).toBe("chain:SPY:data");
  await act(async () => (node.querySelector("button") as HTMLButtonElement).click());
  expect(node.querySelector("output")?.textContent).toBe("chain:SPY:unavailable");
  expect(transport.invalidate).toHaveBeenCalledTimes(1);
  expect(transport.invalidate).toHaveBeenCalledWith("vol:SPY");
});
it("classifies an unpublished 404 as absent instead of a source failure", async () => {
  await act(async () => root.render(<Consumer instrument="SPY" status />));
  expect(node.querySelector("output")?.textContent).toBe("chain:none:absent");
  expect(transport.invalidate).not.toHaveBeenCalled();
});

it("IV Retry recovers independently of the existing Moves feed, without re-fetching Moves", async () => {
  let movesReads = 0, ivReads = 0;
  transport.get.mockImplementation((key: string) => {
    if (key === "moves:SPY" && ++movesReads > 1) return new Promise(() => {});
    return Promise.resolve(null);
  });
  transport.getResult.mockImplementation(async (key: string) => key === "vol:SPY"
    ? (++ivReads === 1 ? { status: "unavailable" } : { status: "data", data: { root: "SPY" } })
    : { status: "absent" });
  await act(async () => root.render(<Consumer instrument="SPY" status />));
  expect(node.querySelector("output")?.textContent).toBe("chain:none:unavailable");
  await act(async () => (node.querySelector("button") as HTMLButtonElement).click());
  expect(node.querySelector("output")?.textContent).toBe("chain:SPY:data");
  expect(transport.get.mock.calls.filter(([key]) => key === "moves:SPY")).toHaveLength(1);
  expect(transport.getResult.mock.calls.filter(([key]) => key === "vol:SPY")).toHaveLength(2);
  expect(transport.invalidate).toHaveBeenCalledWith("vol:SPY");
});
