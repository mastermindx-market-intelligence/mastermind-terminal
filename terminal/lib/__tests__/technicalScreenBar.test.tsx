// @vitest-environment jsdom
// The technical-screen strip and cell render what the reader decided — four read states kept
// apart, the coverage populations summing to the requested universe, the not-produced timeframe
// said in words (the E01 falsifier), and a not-evaluated name shown as a status, never a value.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/screener/TechnicalScreenBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import TechnicalScreenBar, { TechnicalCell } from "@/components/screener/TechnicalScreenBar";
import { LangProvider } from "@/lib/i18n";
import { classifyTechnical, parseTechnicalScan, type TechnicalScanSource } from "@/lib/technicalScan";
import { TECH_DEFAULT_CONTROLS, technicalCoverageSummary, type TechControls } from "@/lib/technicalScreenControls";
import type { TechnicalScanState } from "@/lib/useTechnicalScan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-11T12:00:00Z");
const FIXTURE = path.join(__dirname, "fixtures/screenerScan/technical.producer.json");
const ready = (patch: Record<string, unknown> = {}): Extract<TechnicalScanSource, { kind: "ready" }> => {
  const r = parseTechnicalScan({ ...JSON.parse(readFileSync(FIXTURE, "utf8")), ...patch });
  if (!r.ok) throw new Error(r.error);
  return { kind: "ready", scan: r.value };
};
const SYMS = [...ready().scan.rows.keys()];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  document.documentElement.removeAttribute("data-lang");
});

function mount(node: React.ReactNode, lang: "en" | "zh" = "en") {
  document.documentElement.setAttribute("data-lang", lang);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<LangProvider>{node}</LangProvider>));
  return host;
}

function bar(scan: TechnicalScanState, opts: { controls?: Partial<TechControls>; requested?: string[]; hidden?: number; retry?: () => void } = {}) {
  const controls = { ...TECH_DEFAULT_CONTROLS, ...opts.controls };
  const src = scan.phase === "settled" && scan.source.kind === "ready" ? scan.source : null;
  const summary = src ? technicalCoverageSummary(opts.requested ?? SYMS, src, controls.tf, NOW) : null;
  return (
    <TechnicalScreenBar
      open
      onToggle={() => {}}
      scan={{ ...scan, retry: opts.retry ?? (() => {}) }}
      controls={controls}
      onControls={() => {}}
      summary={summary}
      hiddenUnknown={opts.hidden ?? 0}
    />
  );
}
const settledOn = (source: TechnicalScanSource, reason: string | null = "first"): TechnicalScanState => ({
  phase: "settled",
  source,
  decision: reason ? { adopt: reason !== "incomplete_over_complete", reason: reason as never } : null,
  now: NOW,
});
const q = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

describe("TechnicalScreenBar", () => {
  it("closed: only the toggle, and no read state is shown", () => {
    const el = mount(<TechnicalScreenBar open={false} onToggle={() => {}} scan={{ phase: "idle", retry: () => {} }} controls={TECH_DEFAULT_CONTROLS} onControls={() => {}} summary={null} hiddenUnknown={0} />);
    expect(q(el, "[data-tech-toggle]")!.getAttribute("aria-expanded")).toBe("false");
    expect(q(el, "[data-tech-tf]")).toBeNull();
    expect(q(el, "[data-tech-coverage]")).toBeNull();
  });

  it("loading, absent and error are three different states; controls stay disabled until ready", () => {
    let el = mount(bar({ phase: "loading" }));
    expect(q(el, '[data-tech-state="loading"]')).not.toBeNull();
    expect((q(el, "[data-tech-tf]") as HTMLSelectElement).disabled).toBe(true);
    act(() => root!.unmount()); host!.remove();

    const retry = vi.fn();
    el = mount(bar(settledOn({ kind: "absent" }, null), { retry }));
    expect(q(el, '[data-tech-fault="absent"]')!.textContent).toContain("No technical scan is published yet");
    expect(q(el, "[data-tech-coverage]")).toBeNull();
    act(() => (q(el, '[data-tech-fault="absent"] button') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => root!.unmount()); host!.remove();

    el = mount(bar(settledOn({ kind: "error", error: "http_500" }, null)));
    expect(q(el, '[data-tech-fault="error"]')!.textContent).toContain("could not be read");
  });

  it("AC-E01-02: the four populations shown sum to the requested count", () => {
    const requested = [...SYMS, "MISSING_A", "MISSING_B"];
    const el = mount(bar(settledOn(ready()), { requested }));
    const n = (k: string) => Number(q(el, `[data-tech-count="${k}"] b`)!.textContent!.replace(/,/g, ""));
    expect(n("requested")).toBe(requested.length);
    expect(n("evaluated") + n("stale") + n("unsupported") + n("unavailable")).toBe(requested.length);
    expect(q(el, '[data-tech-reason="unavailable:not_in_scan"]')!.textContent).toContain("not in the scan");
    expect(q(el, "[data-tech-forming]")!.textContent).toContain("1 on a forming bar");
    expect(q(el, '[data-tech-complete="true"]')).not.toBeNull();
    expect(q(el, '[data-tech-handover="exact"]')!.textContent).toContain("3D");
  });

  it("falsifier: a timeframe the scan did not produce is said to be unsupported — every name, in words", () => {
    const el = mount(bar(settledOn(ready()), { controls: { tf: "W" } }));
    expect(q(el, '[data-tech-tf-not-produced="W"]')).not.toBeNull();
    const opt = [...(q(el, "[data-tech-tf]") as HTMLSelectElement).options].find((o) => o.value === "W")!;
    expect(opt.textContent).toBe("W · not scanned");
    expect(Number(q(el, '[data-tech-count="unsupported"] b')!.textContent)).toBe(SYMS.length);
    expect(Number(q(el, '[data-tech-count="evaluated"] b')!.textContent)).toBe(0);
  });

  it("AC-E01-03: an incomplete generation is labelled; a held complete one says a newer incomplete was refused", () => {
    let el = mount(bar(settledOn(ready({ complete: false }))));
    expect(q(el, '[data-tech-complete="false"]')!.textContent).toContain("not full coverage");
    act(() => root!.unmount()); host!.remove();

    el = mount(bar(settledOn({ ...ready(), refreshFailed: true }, "incomplete_over_complete")));
    expect(q(el, '[data-tech-complete="true"]')).not.toBeNull();
    expect(q(el, "[data-tech-held-complete]")).not.toBeNull();
    expect(q(el, "[data-tech-refresh-failed]")).not.toBeNull();
  });

  it("ZH: the strip renders Chinese copy for every line", () => {
    const el = mount(bar(settledOn(ready()), { controls: { tf: "W" }, hidden: 4 }), "zh");
    expect(q(el, "[data-tech-toggle]")!.textContent).toBe("技术筛选");
    expect(q(el, "[data-tech-coverage]")!.textContent).toContain("W 技术覆盖");
    expect(q(el, '[data-tech-tf-not-produced="W"]')!.textContent).toContain("未生成 W 结果");
    expect(q(el, "[data-tech-hidden-unknown]")!.textContent).toContain("4 个已隐藏");
    expect(q(el, '[data-tech-handover="exact"]')!.textContent).toContain("W");
  });
});

describe("TechnicalCell", () => {
  const cell = (sym: string, tf = "3D", lang: "en" | "zh" = "en") => {
    const el = mount(<table><tbody><tr><TechnicalCell c={classifyTechnical(ready(), sym, tf, NOW)} /></tr></tbody></table>, lang);
    return q(el, "td")!;
  };

  it("evaluated: the source state verbatim — position, last signal, bars since", () => {
    const td = cell("NVDA");
    expect(td.dataset.techStatus).toBe("evaluated");
    expect(td.textContent).toContain("Long");
    expect(td.textContent).toContain("3 bars");
    expect(td.title).toBe("Bar of 2026-10-08");
  });

  it("an evaluated name on a forming bar says so", () => {
    expect(cell("0700.HK").textContent).toContain("forming");
  });

  it("stale: labelled stale, with its reason and bar date", () => {
    const td = cell("OLDERA");
    expect(td.dataset.techStatus).toBe("stale");
    expect(td.dataset.techReason).toBe("engine_mismatch");
    expect(td.textContent!.startsWith("stale")).toBe(true);
    expect(td.title).toContain("older engine version");
  });

  it("unsupported / unavailable: only the status word, never a value or a dash that reads as 'no signal'", () => {
    const u = cell("^TNX");
    expect(u.dataset.techStatus).toBe("unsupported");
    expect(u.textContent).toBe("unsupported");
    expect(u.title).toBe("rate series");
    const a = cell("GHOST", "3D", "zh");
    expect(a.textContent).toBe("不可用");
    expect(a.title).toBe("无价格历史");
    const w = cell("NVDA", "W");
    expect(w.dataset.techReason).toBe("timeframe_not_produced");
    expect(w.textContent).toBe("unsupported");
  });
});
