// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PositionModal, { type PositionDraft } from "@/components/PositionModal";
import { portfolioCopy } from "@/lib/portfolioWorkspace";
import type { PositionMutationResult } from "@/lib/portfolioMutation";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({
  useT: () => (key: string) => key,
  useLang: () => ({ lang: language.lang }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Submit = ComponentProps<typeof PositionModal>["onSubmit"];
type DraftField = Exclude<keyof PositionDraft, "clientPositionId">;
type FailureReason = Exclude<Extract<PositionMutationResult, { ok: false }>["reason"], null>;
const createId = "11111111-1111-4111-8111-111111111111";
const completeDraft: Record<DraftField, string> = {
  ticker: "NVDA", shares: "12.5", entryPrice: "101.25", entryCurrency: "USD",
  entryDate: "2026-10-17", notes: "Review after the next earnings report.",
};
const fieldRefusals: ReadonlyArray<readonly [DraftField, FailureReason]> = [
  ["ticker", "invalidPositionTicker"],
  ["shares", "invalidPositionShares"],
  ["entryPrice", "invalidPositionPrice"],
  ["entryCurrency", "invalidPositionCurrency"],
  ["entryDate", "invalidPositionDate"],
  ["notes", "invalidPositionNotes"],
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("real position modal refusal recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let randomUUID: ReturnType<typeof vi.fn>;
  let dialogDescriptors: ReadonlyArray<readonly ["showModal" | "close", PropertyDescriptor | undefined]>;

  beforeEach(() => {
    language.lang = "en";
    vi.useFakeTimers();
    randomUUID = vi.fn(() => createId);
    vi.stubGlobal("crypto", { randomUUID });
    // Keep deferred focus deferred: focusing a still-disabled field would hide
    // the bug these checks are intended to detect.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    dialogDescriptors = (["showModal", "close"] as const).map(name =>
      [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    for (const [name, original] of dialogDescriptors) {
      if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function element<T extends Element>(selector: string): T {
    const found = container.querySelector<T>(selector);
    if (!found) throw new Error(`Missing modal element: ${selector}`);
    return found;
  }

  function field(name: DraftField) {
    return element<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  }

  async function renderModal(onSubmit: Submit) {
    const onCancel = vi.fn();
    await act(async () => root.render(
      <PositionModal mode="add" position={null} initialTicker="NVDA"
        onCancel={onCancel} onSubmit={onSubmit} />,
    ));
    return { onCancel };
  }

  async function change(name: DraftField, value: string) {
    const control = field(name);
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error(`Missing native value setter for ${name}`);
    await act(async () => {
      setter.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function fill(values: Record<DraftField, string> = completeDraft) {
    for (const name of Object.keys(values) as DraftField[]) await change(name, values[name]);
  }

  function expectDraft(values: Record<DraftField, string> = completeDraft) {
    for (const name of Object.keys(values) as DraftField[]) expect(field(name).value).toBe(values[name]);
  }

  async function submit() {
    await act(async () => {
      // Model a user activating Save so retained initial field focus cannot
      // accidentally satisfy the refusal focus assertion.
      element<HTMLButtonElement>('button[type="submit"]').focus();
      element<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function flushFocus() {
    // First commit the promise result and re-enable the fieldset, then allow
    // a scheduled focus callback to observe the committed DOM.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.runOnlyPendingTimers(); });
  }

  async function finish(pending: ReturnType<typeof deferred<PositionMutationResult>>, result: PositionMutationResult) {
    await act(async () => { pending.resolve(result); });
    await flushFocus();
  }

  it.each(fieldRefusals)("describes and focuses %s after an actionable %s refusal", async (name, reason) => {
    const pending = deferred<PositionMutationResult>();
    const onSubmit = vi.fn<Submit>().mockReturnValue(pending.promise);
    const { onCancel } = await renderModal(onSubmit);
    await fill();
    await submit();
    expect(element<HTMLFieldSetElement>("fieldset").disabled).toBe(true);
    expect(field(name).matches(":disabled")).toBe(true);

    await finish(pending, { ok: false, reason });

    const alert = element<HTMLElement>('[role="alert"]');
    expect(alert.textContent).toBe(portfolioCopy("en")(reason));
    expect(alert.id).not.toBe("");
    expect(document.getElementById(alert.id)).toBe(alert);
    expect(field(name).getAttribute("aria-invalid")).toBe("true");
    expect((field(name).getAttribute("aria-describedby") ?? "").split(/\s+/)).toContain(alert.id);
    expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(element<HTMLFieldSetElement>("fieldset").disabled).toBe(false);
    expect(field(name).matches(":disabled")).toBe(false);
    expect(document.activeElement).toBe(field(name));
    expect(element<HTMLDialogElement>("dialog").open).toBe(true);
    expectDraft();
    expect(onSubmit.mock.calls[0][0]).toEqual({ ...completeDraft, clientPositionId: createId });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clears only the corrected field error and retains the draft and create UUID on retry", async () => {
    const first = deferred<PositionMutationResult>();
    const retry = deferred<PositionMutationResult>();
    const onSubmit = vi.fn<Submit>().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { onCancel } = await renderModal(onSubmit);
    const original = { ...completeDraft, shares: "ten" };
    await fill(original);
    await submit();
    await submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await finish(first, { ok: false, reason: "invalidPositionShares" });
    expectDraft(original);

    const notes = "Keep this note while correcting the share count.";
    await change("notes", notes);
    expect(element<HTMLElement>('[role="alert"]').textContent)
      .toBe(portfolioCopy("en")("invalidPositionShares"));
    expect(field("shares").getAttribute("aria-invalid")).toBe("true");

    await change("shares", "10");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(field("shares").getAttribute("aria-invalid")).not.toBe("true");
    const corrected = { ...original, shares: "10", notes };
    expectDraft(corrected);
    await submit();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0][0]).toEqual({ ...original, clientPositionId: createId });
    expect(onSubmit.mock.calls[1][0]).toEqual({ ...corrected, clientPositionId: createId });
    expect(randomUUID).toHaveBeenCalledTimes(1);
    await finish(retry, { ok: true });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(["en", "zh"] as const)("keeps an uncertain %s save editable with the same draft and UUID", async lang => {
    language.lang = lang;
    const onSubmit = vi.fn<Submit>().mockResolvedValue({ ok: false, reason: null });
    const { onCancel } = await renderModal(onSubmit);
    await fill();
    await submit();
    await flushFocus();

    expect(element<HTMLElement>('[role="alert"]').textContent).toBe(portfolioCopy(lang)("saveUnconfirmed"));
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(element<HTMLDialogElement>("dialog").open).toBe(true);
    expect(element<HTMLFieldSetElement>("fieldset").disabled).toBe(false);
    expectDraft();
    await submit();
    await flushFocus();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0][0]).toEqual({ ...completeDraft, clientPositionId: createId });
    expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("uses safe uncertainty copy after a thrown request and retains the same create intent", async () => {
    const rawError = "fixture transport detail that must not appear in the dialog";
    const onSubmit = vi.fn<Submit>()
      .mockRejectedValueOnce(new Error(rawError))
      .mockResolvedValueOnce({ ok: true });
    const { onCancel } = await renderModal(onSubmit);
    await fill();
    await submit();
    await flushFocus();

    expect(element<HTMLElement>('[role="alert"]').textContent).toBe(portfolioCopy("en")("saveUnconfirmed"));
    expect(container.textContent).not.toContain(rawError);
    expect(element<HTMLDialogElement>("dialog").open).toBe(true);
    expect(element<HTMLFieldSetElement>("fieldset").disabled).toBe(false);
    expectDraft();
    await submit();
    await flushFocus();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual({ ...completeDraft, clientPositionId: createId });
    expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
