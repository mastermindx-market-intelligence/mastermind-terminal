// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/components/ChartFrameBar";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

function render() {
  localStorage.setItem("mm.lang", "en");
  const onSettings = vi.fn();
  const onOpen = vi.fn();
  function Owner() {
    const [settings, setSettings] = useState(DEFAULT_CHART_SETTINGS);
    return <LangProvider>
      <ChartFrameBar timeframe="D" chartApi={null} settings={settings}
        onSettings={(patch: Partial<ChartSettings>) => {
          onSettings(patch);
          setSettings((previous) => ({ ...previous, ...patch }));
        }} onOpenSettingsModal={onOpen} />
      <button type="button" id="outside">Outside</button>
    </LangProvider>;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Owner />));
  const trigger = host.querySelector<HTMLButtonElement>(".cfb-gear")!;
  act(() => { trigger.focus(); trigger.click(); });
  const popup = () => host.querySelector<HTMLElement>(".qsg-menu");
  const item = (label: string) => Array.from(popup()!.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.querySelector(".qsg-lbl")?.textContent === label)!;
  return { host, trigger, popup, item, onSettings, onOpen };
}

describe("chart quick settings", () => {
  it("opens a named disclosure and focuses its first native toggle", () => {
    const { trigger, popup, item, onSettings } = render();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(popup()!.id);
    expect(popup()!.getAttribute("role")).toBe("dialog");
    expect(popup()!.getAttribute("aria-label")).toBe("Quick settings");
    const auto = item("Auto (fits data to screen)");
    expect(document.activeElement).toBe(auto);
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    act(() => auto.click());
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledWith({ autoScale: false });
    expect(auto.getAttribute("aria-pressed")).toBe("false");
    expect(item("Scale price chart only").disabled).toBe(true);
    expect(popup()!.querySelector("button button")).toBeNull();
  });

  it("keeps exclusive scale selection and disclosure state observable", () => {
    const { popup, item, onSettings } = render();
    act(() => item("Percent").click());
    expect(item("Percent").getAttribute("aria-pressed")).toBe("true");
    expect(item("Regular").getAttribute("aria-pressed")).toBe("false");
    act(() => item("Labels").click());
    expect(item("Labels").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(item("Labels").getAttribute("aria-controls")!)).not.toBeNull();
    act(() => item("Last value label").click());
    expect(onSettings).toHaveBeenLastCalledWith({ lastValueVisible: false });
    expect(item("Last value label").getAttribute("aria-pressed")).toBe("false");
    act(() => item("Lines").click());
    expect(item("Labels").getAttribute("aria-expanded")).toBe("false");
    expect(item("Lines").getAttribute("aria-expanded")).toBe("true");
    expect(popup()!.querySelectorAll(".qsg-submenu")).toHaveLength(1);
    act(() => item("Price line").click());
    expect(onSettings).toHaveBeenLastCalledWith({ priceLineVisible: false });
  });

  it("dismisses with Escape and returns focus without changing a setting", () => {
    const { trigger, popup, item, onSettings } = render();
    act(() => item("Lines").click());
    act(() => item("Price line").focus());
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.activeElement!.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(popup()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(onSettings).not.toHaveBeenCalled();
    act(() => trigger.click());
    expect(item("Lines").getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses on focus leaving and preserves the new focus target", () => {
    const { host, popup } = render();
    const outside = host.querySelector<HTMLButtonElement>("#outside")!;
    act(() => outside.focus());
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("hands full settings a persistent opener before removing its popup", () => {
    const { trigger, popup, item, onOpen } = render();
    onOpen.mockImplementation(() => expect(document.activeElement).toBe(trigger));
    act(() => { item("More settings…").focus(); item("More settings…").click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("scales");
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
