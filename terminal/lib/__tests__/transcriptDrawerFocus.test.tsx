// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TranscriptDrawer from "../../components/fin/TranscriptDrawer";
import type { Transcript } from "../fund";

const getTx = vi.hoisted(() => vi.fn());
vi.mock("../fund", () => ({ getTx, transcriptBodyUrl: () => null }));
vi.mock("../i18n", () => ({ useLang: () => ({ lang: "en" }) }));

const transcript: Transcript = {
  schema: "mastermind.tx/v1", ticker: "NVDA", id: "2026Q3",
  period: "Q3 FY2026", date: "2026-11-01", title: "NVIDIA earnings call",
  segments: [
    { speaker: "Operator", role: "Operator", text: "Welcome to the call." },
    { speaker: "Finance lead", role: "CFO", text: "Revenue increased this quarter." },
    { speaker: "Operator", role: "Operator", text: "We will now take your questions." },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("TranscriptDrawer source focus across portal readiness", () => {
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: Root;
  let frameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let scrollDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = new Map(); frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback); return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    getTx.mockReset();
    opener = document.createElement("button"); opener.textContent = "Source result";
    host = document.createElement("div"); document.body.append(opener, host);
    opener.focus(); root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); opener.remove();
    if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  async function mountPortal() {
    await act(async () => {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); }
    });
  }

  it.each(["before portal", "after portal"] as const)("focuses the exact source when the transcript arrives %s", async order => {
    const pending = deferred<Transcript>();
    getTx.mockReturnValue(pending.promise);
    await act(async () => root.render(
      <TranscriptDrawer sym="NVDA" id="2026Q3" focus={{ segment_index: 1 }} onClose={vi.fn()} />,
    ));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    if (order === "before portal") {
      await act(async () => { pending.resolve(transcript); });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await mountPortal();
    } else {
      await mountPortal();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Close transcript");
      await act(async () => { pending.resolve(transcript); });
    }
    const target = document.querySelector<HTMLElement>('.fin-tx-seg[data-segment="2"]');
    expect(target?.textContent).toContain("Revenue increased this quarter.");
    expect(document.activeElement).toBe(target);
    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    await act(async () => root.render(null));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute("inert")).toBe(false);
  });
});
