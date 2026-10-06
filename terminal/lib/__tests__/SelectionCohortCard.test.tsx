// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SelectionCohortCard } from "@/components/prophet/SelectionCohortCard";
import { parseSelectionCohort } from "@/lib/selectionCohort";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(__dirname, "..", "..");
const READY = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "ready.json"), "utf8"),
);
const UNAVAILABLE = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "unavailable.json"), "utf8"),
);
const EMPTY = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "empty.json"), "utf8"),
);

let container: HTMLDivElement;
let root: Root;

async function renderCard(lang: "en" | "zh", view: ReturnType<typeof parseSelectionCohort> | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SelectionCohortCard lang={lang} view={view} />);
  });
}

beforeEach(() => {
  // no fetch — view is passed from parent
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

describe("SelectionCohortCard", () => {
  it("(a) null view renders nothing", async () => {
    await renderCard("en", null);
    expect(container.querySelector("[data-testid=selection-cohort-card]")).toBeNull();
  });

  it("(b) READY en copy and no CJK", async () => {
    await renderCard("en", parseSelectionCohort(READY));
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
    await renderCard("zh", parseSelectionCohort(READY));
    const text = container.textContent ?? "";
    expect(text).toContain("部分入选标的至少共享一个主题。");
    expect(text).toContain("仅供背景参考 — 非信号");
    expect(text).not.toMatch(/[A-Za-z]/);
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(d) 503 feed -> unavailable feed why", async () => {
    await renderCard("en", parseSelectionCohort({ error: "feed unavailable" }));
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "It hasn't been published yet — it's built after the nightly U.S. run.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(e) unavailable.json -> source why", async () => {
    await renderCard("en", parseSelectionCohort(UNAVAILABLE));
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "These picks couldn't be matched to their recorded source, so nothing is shown rather than a guess.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(f) empty.json -> empty state", async () => {
    await renderCard("en", parseSelectionCohort(EMPTY));
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("empty");
    expect(card.textContent).toContain("No U.S. picks were finalized for this run.");
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });

  it("(g) can_rank true -> checks unavailable", async () => {
    const bad = { ...READY, can_rank: true };
    await renderCard("en", parseSelectionCohort(bad));
    const card = container.querySelector("[data-testid=selection-cohort-card]")!;
    expect(card.getAttribute("data-state")).toBe("unavailable");
    expect(card.textContent).toContain(
      "The theme read for these picks didn't pass its checks, so nothing is shown.",
    );
    expect(container.querySelectorAll("[title]").length).toBe(0);
  });
});
