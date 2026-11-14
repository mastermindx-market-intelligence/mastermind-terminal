// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CallLayout, { type CompanyIntelligenceCallExchange } from "../../components/fin/CompanyIntelligenceCallLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | undefined;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); });

it.each([false, true])("opens questions beyond the initial eight without changing source identity (zh=%s)", async zh => {
  const exchanges: CompanyIntelligenceCallExchange[] = Array.from({ length: 10 }, (_, i) => ({
    id: `exchange-${i}`, ordinal: i, analyst: `Analyst ${i + 1}`, question: `Question ${i + 1}`,
    respondents: ["Chief executive"], segmentIndex: i === 9 ? null : i * 3,
  }));
  const open = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (eventId: string) => act(async () => root!.render(
    <CallLayout zh={zh} periodLabel="Q3 FY2026" eventDate="2026-07-30" eventId={eventId}
      transcriptId="2026Q3" transcriptAvailable exchanges={exchanges} onOpenExchange={open} />,
  ));
  await render("event-a");
  expect(host.querySelectorAll(".ci-paper-call-exchanges > button")).toHaveLength(8);
  const expand = host.querySelector<HTMLButtonElement>(".ci-paper-call-expand button")!;
  expect(expand.textContent).toBe(zh ? "显示全部问题" : "Show all questions");
  expect(document.getElementById(expand.getAttribute("aria-controls")!)).not.toBeNull();
  await act(async () => expand.click());
  expect(expand.getAttribute("aria-expanded")).toBe("true");
  const buttons = host.querySelectorAll<HTMLButtonElement>(".ci-paper-call-exchanges > button");
  expect(buttons).toHaveLength(10);
  await act(async () => buttons[8].click());
  expect(open).toHaveBeenCalledExactlyOnceWith(exchanges[8]);
  expect(buttons[9].disabled).toBe(true);
  expect(host.querySelector("[data-ci-call-transcript-id]")?.getAttribute("data-ci-call-transcript-id")).toBe("2026Q3");
  await render("event-b");
  expect(host.querySelectorAll(".ci-paper-call-exchanges > button")).toHaveLength(8);
  expect(host.querySelector(".ci-paper-call-expand button")?.getAttribute("aria-expanded")).toBe("false");
});
