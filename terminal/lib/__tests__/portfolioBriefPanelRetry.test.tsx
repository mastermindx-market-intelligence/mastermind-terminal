// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import PortfolioBriefPanel from "@/components/PortfolioBriefPanel";
import { LangProvider, LEX, type Lang } from "@/lib/i18n";
import fixture from "./fixtures/portfolio_brief/concentrated_semis.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type RequestRead = ReturnType<typeof deferred<Response>> & { signal?: AbortSignal | null };
let requests: RequestRead[];
let container: HTMLDivElement;
let root: Root | null;
let lang: Lang;

function copy(key: string) { return LEX[key][lang === "zh" ? 1 : 0]; }
function bodyText() { return container.textContent ?? ""; }
function retryButton() {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === copy("errTryAgain"));
  expect(button, "a recoverable brief failure offers an in-place retry").toBeDefined();
  return button!;
}
function response(status = 200, body: unknown = fixture) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function answer(index: number, status = 200, body: unknown = fixture) {
  await act(async () => { requests[index].resolve(response(status, body)); });
}
async function fail(index: number) {
  await act(async () => { requests[index].reject(new TypeError("network unavailable")); });
}
async function mount(locale: Lang = "en", strict = false) {
  lang = locale;
  document.documentElement.setAttribute("data-lang", locale);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const panel = <LangProvider><PortfolioBriefPanel population={{ kind: "positions", count: 9 }} /></LangProvider>;
  await act(async () => { root!.render(strict ? <StrictMode>{panel}</StrictMode> : panel); });
}
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
}
function assertLoading() {
  expect(container.querySelector('[aria-busy="true"]')?.getAttribute("aria-label")).toBe(copy("briefLoading"));
  expect(bodyText()).not.toContain(copy("briefUnavailable"));
  expect(container.querySelector("button")).toBeNull();
}
function assertReady() {
  expect(bodyText()).toContain(fixture.headline[lang]);
  expect(bodyText()).not.toContain(fixture.headline[lang === "en" ? "zh" : "en"]);
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(bodyText()).toContain("2026-07-23");
  const headings = [...container.querySelectorAll(".pbrief-sec-label")].map((node) => node.textContent);
  expect(headings).toEqual(["exposure", "signals", "earnings", "filings"].map((key) => {
    const section = fixture.sections.find((item) => item.key === key)!;
    return lang === "en" ? section.title_en : section.title_zh;
  }));
}

beforeEach(() => {
  requests = [];
  root = null;
  lang = "en";
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe("/api/portfolio-brief");
    expect(init?.headers).toEqual({ Accept: "application/json" });
    const pending = { ...deferred<Response>(), signal: init?.signal };
    requests.push(pending);
    return pending.promise;
  }));
});
afterEach(() => {
  unmount();
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
});

describe("PortfolioBriefPanel in-place recovery", () => {
  for (const locale of ["en", "zh"] as const) {
    it(`preserves initial loading and valid localized rendering (${locale})`, async () => {
      await mount(locale);
      assertLoading();
      expect(requests).toHaveLength(1);
      await answer(0);
      assertReady();
    });

    for (const failure of ["503", "network"] as const) {
      it(`recovers from ${failure} without remounting (${locale})`, async () => {
        await mount(locale);
        if (failure === "503") await answer(0, 503, {}); else await fail(0);
        expect(bodyText()).toContain(copy("briefUnavailable"));
        await act(async () => { retryButton().click(); });
        expect(requests).toHaveLength(2);
        assertLoading();
        await answer(1);
        assertReady();
      });
    }

    it(`keeps repeated failures recoverable (${locale})`, async () => {
      await mount(locale);
      await answer(0, 503, {});
      await act(async () => { retryButton().click(); });
      await fail(1);
      expect(bodyText()).toContain(copy("briefUnavailable"));
      await act(async () => { retryButton().click(); });
      await answer(2, 503, {});
      expect(bodyText()).toContain(copy("briefUnavailable"));
      await act(async () => { retryButton().click(); });
      await answer(3);
      expect(requests).toHaveLength(4);
      assertReady();
    });

    for (const status of [401, 403]) {
      for (const afterRetry of [false, true]) {
        it(`preserves ${status} ${afterRetry ? "after retry" : "initially"} (${locale})`, async () => {
          await mount(locale);
          if (afterRetry) {
            await answer(0, 503, {});
            await act(async () => { retryButton().click(); });
          }
          await answer(afterRetry ? 1 : 0, status, { error: status === 403 ? "pro_required" : "unauthenticated" });
          expect(container.querySelector("button")).toBeNull();
          if (status === 401) expect(bodyText()).toBe("");
          else {
            expect(bodyText()).toContain(copy("briefTeaserWhat"));
            expect(container.querySelector('.pbrief-sample[aria-hidden="true"]')?.textContent).toBe(copy("briefSample"));
            expect(container.querySelector("a")?.href).toBe("https://mastermind-x.com/#pricing");
            expect(bodyText()).not.toContain(fixture.headline[locale]);
          }
        });
      }
    }
  }

  it("coalesces repeated clicks in the same event turn and while the response body is pending", async () => {
    await mount();
    await answer(0, 503, {});
    const button = retryButton();
    await act(async () => { button.click(); button.click(); button.click(); });
    expect(requests).toHaveLength(2);
    const body = deferred<unknown>();
    await act(async () => { requests[1].resolve({ status: 200, json: () => body.promise } as Response); });
    assertLoading();
    expect(requests).toHaveLength(2);
    await act(async () => { body.resolve(fixture); });
    assertReady();
  });

  it("keeps a non-JSON failure response retryable", async () => {
    await mount();
    await act(async () => { requests[0].resolve({ status: 503, json: async () => { throw new SyntaxError("broken JSON"); } } as unknown as Response); });
    expect(bodyText()).toContain(copy("briefUnavailable"));
    await act(async () => { retryButton().click(); });
    await answer(1);
    assertReady();
  });

  for (const oldOutcome of ["success", "failure", "body"] as const) {
    it(`fences late ${oldOutcome} after unmount and a fresh panel mount`, async () => {
      await mount();
      await answer(0, 503, {});
      await act(async () => { retryButton().click(); });
      const stale = requests[1];
      const oldBody = deferred<unknown>();
      if (oldOutcome === "body") {
        await act(async () => { stale.resolve({ status: 200, json: () => oldBody.promise } as Response); });
      }
      unmount();
      expect(stale.signal?.aborted).toBe(true);
      await mount();
      await answer(2);
      await act(async () => {
        if (oldOutcome === "failure") stale.reject(new TypeError("late network error"));
        else if (oldOutcome === "body") oldBody.resolve({ ...fixture, headline: { en: "OLD BRIEF", zh: "旧简报" } });
        else stale.resolve(response(200, { ...fixture, headline: { en: "OLD BRIEF", zh: "旧简报" } }));
      });
      assertReady();
      expect(bodyText()).not.toContain("OLD BRIEF");
      expect(requests).toHaveLength(3);
    });
  }

  for (const staleOutcome of ["success", "reject"] as const) {
    it(`retains replacement abort ownership after predecessor ${staleOutcome} settles`, async () => {
      await mount("en", true);
      const replacementBody = deferred<unknown>();
      await act(async () => { requests[1].resolve({ status: 200, json: () => replacementBody.promise } as Response); });
      await act(async () => {
        if (staleOutcome === "success") requests[0].resolve(response());
        else requests[0].reject(new TypeError("stale request failed"));
      });
      assertLoading();
      expect(requests[1].signal?.aborted).toBe(false);
      unmount();
      expect(requests[1].signal?.aborted).toBe(true);
      await act(async () => { replacementBody.resolve(fixture); });
      expect(bodyText()).toBe("");
    });
  }

  it("allows the StrictMode replacement load and ignores its late predecessor", async () => {
    await mount("en", true);
    expect(requests).toHaveLength(2);
    expect(requests[0].signal?.aborted).toBe(true);
    await answer(1);
    assertReady();
    await fail(0);
    assertReady();
    expect(requests).toHaveLength(2);
  });
});
