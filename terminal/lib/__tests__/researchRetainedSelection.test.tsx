// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OptionsResearchLab } from "@/components/researchlab/OptionsResearchLab";
import type { RetainedInput } from "@/lib/retainedOptionsWire";
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
const context = { root: "SPY", session: "2026-10-19", ownerKey: "account:one" };
const raw = (kind: string) => readFileSync(`lib/__tests__/fixtures/retained-options/${kind}-wire.json`, "utf8");
const input = (kind = "matrix"): RetainedInput => ({ ...context, wire: raw(kind) });
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", _build_meta: { asof_date: context.session }, cells: [{ strike: 100, expiry: "2026-10-30", call_oi: 1, call_vol: 0 }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected acquisition"); })); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Props = Partial<React.ComponentProps<typeof OptionsResearchLab>>;
async function mount(props: Props = {}) { await act(async () => root.render(<OptionsResearchLab root="SPY" matrix={matrix} lang="en" onClose={() => {}} questionOwnerKey={context.ownerKey} retainedSelection={input()} {...props} />)); }
const panel = () => host.querySelector('[data-testid="research-retained"]');
async function ready() { for (let i = 0; i < 40 && !panel()?.textContent?.includes("9007199254740993"); i++) await act(async () => new Promise(r => setTimeout(r, 5))); expect(panel()?.textContent).toContain("9007199254740993"); }
it.each(["en", "zh"] as const)("mounts exact supplied matrix in actual Lab (%s), without activating replay or staging", async lang => {
  await mount({ lang }); await ready();
  expect(panel()!.textContent).toContain("123456789012.12345678");
  expect(panel()!.textContent).toContain(lang === "en" ? "history order" : "历史顺序");
  expect(host.querySelector('button[aria-pressed="true"]')!.textContent).toBe(lang === "en" ? "Chain landscape" : "期权链分布");
  expect(panel()!.querySelectorAll('tbody button')).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});
it("mounts supplied individual events, retaining distinct availability and event clocks", async () => {
  await mount({ retainedSelection: input("events") }); await ready();
  expect(panel()!.textContent).toContain("2026-10-19T14:33:00.123456789+00:00");
  expect(panel()!.textContent).toContain("no sourced package membership"); expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ["root", { root: "QQQ" }], ["session", { matrix: { ...matrix, _build_meta: { asof_date: "2026-10-20" } } }],
  ["matrix withdrawal", { matrix: null }], ["owner", { questionOwnerKey: "account:two" }],
  ["owner withdrawal", { questionOwnerKey: null }], ["read refusal", { matrixReadStatus: "unavailable" }],
  ["input withdrawal", { retainedSelection: null }], ["changed wire", { retainedSelection: { ...input(), wire: "{}" } }],
] as [string, Props][])("withdraws immediately on %s without old values", async (_name, props) => {
  await mount(); await ready(); await mount(props);
  expect(panel()?.textContent ?? "").not.toContain("9007199254740993");
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["root", "owner", "source"])("fences a late original hash completion after %s withdrawal", async change => {
  let finish!: (value: ArrayBuffer) => void;
  const original = webcrypto.subtle.digest.bind(webcrypto.subtle);
  let calls = 0;
  vi.stubGlobal("crypto", { subtle: { digest: (...args: Parameters<typeof original>) => ++calls === 1 ? new Promise<ArrayBuffer>(resolve => { finish = resolve; }) : original(...args) } });
  await mount(); expect(finish).toBeTypeOf("function");
  await mount(change === "root" ? { root: "QQQ" } : change === "owner" ? { questionOwnerKey: "account:two" } : { retainedSelection: null });
  const bytes = Buffer.from(JSON.parse(raw("matrix")).capture.body_base64, "base64");
  await act(async () => finish(await original("SHA-256", bytes)));
  expect(panel()?.textContent ?? "").not.toContain("9007199254740993"); expect(fetch).not.toHaveBeenCalled();
});
it("revalidates after A -> withdrawn -> A instead of resurrecting a settled view", async () => {
  await mount(); await ready(); await mount({ questionOwnerKey: null });
  let finish!: (value: ArrayBuffer) => void;
  vi.stubGlobal("crypto", { subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } });
  await mount(); expect(panel()!.textContent).not.toContain("9007199254740993");
  const bytes = Buffer.from(JSON.parse(raw("matrix")).capture.body_base64, "base64");
  await act(async () => finish(await webcrypto.subtle.digest("SHA-256", bytes))); await ready();
});
it("keeps a valid selection on language-only changes without another digest", async () => {
  const digest = vi.fn(webcrypto.subtle.digest.bind(webcrypto.subtle)); vi.stubGlobal("crypto", { subtle: { digest } });
  await mount(); await ready(); const count = digest.mock.calls.length;
  await mount({ lang: "zh" }); expect(panel()!.textContent).toContain("9007199254740993"); expect(digest).toHaveBeenCalledTimes(count);
});

it.each(["en", "zh"] as const)("renders the original event exp under the expiry label (%s)", async lang => {
  const supplied = input("events");
  const sourceEvent = JSON.parse(supplied.wire).records[0].event.object;
  expect(sourceEvent.exp).toBe("2026-10-30");
  expect(sourceEvent).not.toHaveProperty("expiry");
  await mount({ retainedSelection: supplied, lang }); await ready();
  const headers = [...panel()!.querySelectorAll("thead th")].map(th => th.textContent);
  const expiryColumn = headers.indexOf(lang === "zh" ? "到期日" : "expiry");
  expect(expiryColumn).toBeGreaterThan(-1);
  expect(panel()!.querySelector("tbody tr")!.children[expiryColumn].textContent).toBe(sourceEvent.exp);
  expect(JSON.parse(supplied.wire).records[0].event.object).toEqual(sourceEvent);
});
