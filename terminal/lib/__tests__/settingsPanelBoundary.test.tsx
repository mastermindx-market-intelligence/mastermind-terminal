// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsPanelBoundary from "@/components/settings/SettingsPanelBoundary";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  consoleSpy.mockRestore();
});

function FragilePanel({ broken }: { broken: boolean }) {
  if (broken) throw new Error("Synthetic settings render failure");
  return <div role="dialog" aria-label="Account settings">Your settings</div>;
}

function Shell({ initiallyBroken = true }: { initiallyBroken?: boolean }) {
  const [open, setOpen] = useState(true);
  const [attempt, setAttempt] = useState(1);
  return <LangProvider>
    <main data-testid="chart">Your chart remains mounted</main>
    <SettingsPanelBoundary key={attempt} visible={open} onClose={() => setOpen(false)} onRetry={() => setAttempt(n => n + 1)}>
      <FragilePanel broken={initiallyBroken && attempt === 1} />
    </SettingsPanelBoundary>
  </LangProvider>;
}

it("contains a profile render failure without replacing the chart and retries a fresh panel", async () => {
  await act(async () => root.render(<Shell />));
  expect(host.textContent).toContain("Your chart remains mounted");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Account settings couldn't open");
  expect(consoleSpy).toHaveBeenCalled();
  const retry = [...document.querySelectorAll('button')].find(b => b.textContent === 'Try again');
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(host.textContent).toContain("Your chart remains mounted");
  expect(host.querySelector('[role="dialog"]')?.textContent).toBe("Your settings");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("closing a failed settings panel dismisses only the error dialog", async () => {
  await act(async () => root.render(<Shell />));
  const close = [...document.querySelectorAll('button')].find(b => b.textContent === 'Close');
  await act(async () => close!.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(host.textContent).toContain("Your chart remains mounted");
});
