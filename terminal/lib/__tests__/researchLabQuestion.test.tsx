// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsResearchLab } from "@/components/researchlab/OptionsResearchLab";
import type { MastermindBrainHost } from "../mastermindBrain";
import type { OptionsQuestionReference } from "../optionsQuestionContext";
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
const matrix = () => ({ schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-11-04T01:00:00Z", _build_meta: { asof_date: "2026-11-03" },
  _matrix_source_identity: { schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY", session: "2026-11-03", sha256: "a".repeat(64), byte_length: 1234 },
  cells: [{ strike: 600.5, expiry: "2026-11-20", gex: 100, call_vol: 20, call_oi: 0, put_vol: 1, put_oi: null }] });
let node: HTMLDivElement, root: Root;
const host = window as unknown as MastermindBrainHost;
const submit = vi.fn<(ref: OptionsQuestionReference) => boolean>(), clear = vi.fn(), request = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); submit.mockReset().mockReturnValue(true); clear.mockReset(); request.mockReset(); vi.stubGlobal("fetch", request);
  host.MM_BRAIN_CFG = { principal: "one" };
  host.MMBrain = { submitOptionsQuestion: submit, clearOptionsQuestion: clear };
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); delete host.MMBrain; delete host.MM_BRAIN_CFG; vi.unstubAllGlobals(); });
const render = async (props: Partial<React.ComponentProps<typeof OptionsResearchLab>> = {}) => act(async () => {
  root.render(<OptionsResearchLab root="SPY" matrix={matrix()} questionOwnerKey="account:one" lang="en" onClose={() => {}} {...props} />);
});
const question = () => node.querySelector('[data-testid="research-question-action"] button') as HTMLButtonElement;
async function click(text: string) { const button = [...node.querySelectorAll("button")].find(x => x.textContent === text); expect(button, text).toBeDefined(); await act(async () => button!.click()); }
const pin = () => click("600.5 Call · 2026-11-20");
const stage = () => act(async () => question().click());
it("requires an exact pin and stages the immutable reference without a request", async () => {
  await render(); expect(question().disabled).toBe(true); await pin(); expect(question().disabled).toBe(false); await stage(); expect(submit).toHaveBeenCalledTimes(1);
  const ref = submit.mock.calls[0][0]; expect(ref.evidence.version_ref).toBe(`sha256:${"a".repeat(64)}:bytes:1234:session:2026-11-03`);
  expect(JSON.parse(ref.selection).primary).toEqual({ expiry: "2026-11-20", side: "call", strike: "600.5" });
  expect(Object.isFrozen(ref)).toBe(true); expect(request).not.toHaveBeenCalled(); expect(node.textContent).toContain("Selection staged in Brain");
});
it.each(["missing", "stale", "wrong-root", "wrong-session", "bad-date"])("leaves %s source identity unavailable", async state => {
  const data: Record<string, unknown> = matrix();
  if (state === "missing") delete data._matrix_source_identity;
  if (state === "stale") data.stale = true;
  if (state === "wrong-root") data._matrix_source_identity = { ...matrix()._matrix_source_identity, root: "QQQ" };
  if (state === "wrong-session") data._matrix_source_identity = { ...matrix()._matrix_source_identity, session: "2026-11-04" };
  if (state === "bad-date") data._build_meta = { asof_date: "2026-02-30" };
  await render({ matrix: data }); if (state !== "bad-date") await pin(); expect(question().disabled).toBe(true); await stage(); expect(submit).not.toHaveBeenCalled();
});
it.each(["lens", "filter", "pin", "digest", "owner", "failure"])("withdraws exact staged source on %s change", async change => {
  await render(); await pin(); await stage(); const ref = submit.mock.calls[0][0];
  if (change === "lens") await click("Flow & packages"); if (change === "filter") await click("Open interest"); if (change === "pin") await click("Dismiss selection");
  if (change === "digest") { const data = matrix(); data._matrix_source_identity.sha256 = "b".repeat(64); await render({ matrix: data }); }
  if (change === "owner") await render({ questionOwnerKey: "account:two" }); if (change === "failure") await render({ matrixReadStatus: "unavailable" });
  expect(clear).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledWith(ref); expect(node.textContent).not.toContain("Selection staged in Brain"); expect(request).not.toHaveBeenCalled();
});
it("withdraws on unmount but not unchanged snapshot or language rerender", async () => {
  await render(); await pin(); await stage(); const ref = submit.mock.calls[0][0]; await render({ lang: "zh" }); expect(clear).not.toHaveBeenCalled();
  await act(async () => root.render(null)); expect(clear).toHaveBeenCalledWith(ref);
});
it("has no generic fallback without exact withdrawal", async () => {
  const open = vi.fn(); host.MMBrain = { open, submitOptionsQuestion: submit }; await render(); await pin(); await stage();
  expect(open).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(node.textContent).toContain("Nothing was sent");
});
it("does not clear an unaccepted selector or stage for guest", async () => {
  submit.mockReturnValue(false); await render(); await pin(); await stage(); await render({ questionOwnerKey: "guest" });
  expect(clear).not.toHaveBeenCalled(); expect(question().disabled).toBe(true); expect(request).not.toHaveBeenCalled();
});
it("carries comparisons and view while leaving Save disabled", async () => {
  await render(); await pin(); await click("Compare selection"); await click("Open interest"); await click("Table"); await stage();
  const selection = JSON.parse(submit.mock.calls[0][0].selection); expect(selection.comparisons).toEqual([selection.primary]);
  expect(selection.view).toMatchObject({ metric: "openInterest", display_mode: "table" });
  expect([...node.querySelectorAll("button")].find(x => x.textContent === "Save investigation")!.disabled).toBe(true); expect(request).not.toHaveBeenCalled();
});

it("refuses staging into another or unresolved widget principal", async () => {
  await render(); await pin(); host.MM_BRAIN_CFG = { principal: "two" }; await stage();
  host.MM_BRAIN_CFG = { principal: null }; await stage();
  expect(submit).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
