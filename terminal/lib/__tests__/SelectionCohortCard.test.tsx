// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SelectionCohortCard } from "@/components/prophet/SelectionCohortCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(__dirname, "..", "..");
const READY = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "nw_selection_cohort_us_fixture.json"), "utf8"),
);
const UNAVAILABLE = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "unavailable.json"), "utf8"),
);
const EMPTY = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "empty.json"), "utf8"),
);

let container: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

async function renderCard(lang: "en" | "zh") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SelectionCohortCard lang={lang} />);
  });
}

async function flushFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(body, ok, status))),
  );
  await renderCard("en");
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  vi.unstubAllGlobals();
});

describe("SelectionCohortCard", () => {
  it("(a) container empty before fetch resolves", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    await renderCard("en");
    expect(container.querySelector("[data-testid=selection-cohort-card]")).toBeNull();
    await act(async () => {
      resolveFetch(jsonResponse(READY));
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid=selection-cohort-card]")).not.toBeNull();
  });

  it("(b) READY en copy and no CJK", async () => {
    await flushFetch(READY, true, 200);
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("ready");
    const text = card.textContent ?? "";
    expect(text).toContain("Some of these picks share at least one theme.");
    expect(text).toContain("context only — not a signal");
    expect(text).toContain("Theme data is incomplete for some picks in this run.");
    const withheld = container.querySelector("[data-testid=selection-cohort-withheld]")!;
    const wText = withheld.textContent ?? "";
    expect(wText).toContain("9 themes withheld from display");
    expect(wText).toContain("5 licensed for internal use only");
    expect(wText).toContain("4 display rights not yet confirmed");
    expect(text).not.toMatch(/[㐀-鿿]/);
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(c) READY zh copy and no Latin letters", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(READY))));
    await renderCard("zh");
    await act(async () => {
      await Promise.resolve();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("部分入选标的至少共享一个主题。");
    expect(text).toContain("仅供背景参考 — 非信号");
    expect(text).not.toMatch(/[A-Za-z]/);
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(d) 503 feed -> unavailable feed why", async () => {
    await flushFetch({ error: "feed unavailable" }, false, 503);
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "It hasn't been published yet — it's built after the nightly U.S. run.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(e) unavailable.json -> source why", async () => {
    await flushFetch(UNAVAILABLE);
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "These picks couldn't be matched to their recorded source, so nothing is shown rather than a guess.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(f) empty.json -> empty state", async () => {
    await flushFetch(EMPTY);
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("empty");
    expect(card.textContent).toContain("No U.S. picks were finalized for this run.");
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(g) can_rank true -> checks unavailable", async () => {
    const bad = { ...READY, can_rank: true };
    await flushFetch(bad);
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "The theme read for these picks didn't pass its checks, so nothing is shown.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });
});
