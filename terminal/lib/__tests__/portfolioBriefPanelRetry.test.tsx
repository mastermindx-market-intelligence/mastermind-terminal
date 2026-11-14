// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, Component, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PortfolioBriefPanel from "@/components/PortfolioBriefPanel";
import { LangProvider, LEX, type Lang } from "@/lib/i18n";
import type { BriefBinding, CanonicalReadPhase } from "@/lib/portfolioBrief";

// ─────────────────────────────────────────────────────────────────────────────
// The bound brief panel: request lifetime against the accepted canonical binding.
//
// The panel renders the desk's facts only for the book the page is showing. This suite
// pins the WHOLE contract, in the order the risks arrive:
//
//   * the opt-in is UNCONDITIONAL — the panel always asks for the snapshot contract, so
//     the entitlement statuses stay observable even with no canonical binding at all;
//   * the facts render only for a context that names the SAME owner and the SAME
//     canonical book key as the accepted binding — a payload with no context, a context
//     for another book and a context for another owner are all NOT the brief;
//   * a failed canonical read is UNAVAILABLE, never a perpetual checking state, and it
//     never becomes a false entitlement result;
//   * the retry is the EXISTING canonical reload followed by ONE new bound read — the
//     panel never reads positions itself and a double click never starts two reloads;
//   * every async continuation is fenced by the COMMITTED request, so a late predecessor
//     cannot paint, release or revive its replacement.
// ─────────────────────────────────────────────────────────────────────────────

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
let retries: number;

const OWNER = "3f0d4a5e-6c21-4f8a-9b77-2c9a1d5e7f30";
const OTHER_OWNER = "00000000-0000-4000-8000-000000000000";
const BOOK_KEY = "a".repeat(64);
const OTHER_BOOK_KEY = "b".repeat(64);

/** The public brief of the shared synthetic witness, without the witness itself. */
type BriefFixture = {
  schema: string;
  asof: string;
  headline: { en: string; zh: string };
  [key: string]: unknown;
};

function briefFixture(): BriefFixture {
  const body = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "portfolio-brief-context", "witness_book.json"), "utf8"),
  ) as BriefFixture & { portfolio_context?: unknown };
  delete body.portfolio_context;
  return body;
}

/** A bound response: the public brief plus the context that binds it to a book. */
function boundResponse(context: Record<string, unknown> = {}): unknown {
  return {
    ...briefFixture(),
    context: {
      version: "snapshot-v1",
      owner: OWNER,
      bookKey: BOOK_KEY,
      population: "positions",
      ...context,
    },
  };
}

const BINDING: BriefBinding = { owner: OWNER, bookKey: BOOK_KEY, read: 1 };

class BriefErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div data-testid="brief-render-failed">Brief render failed</div> : this.props.children;
  }
}

function copy(key: string) { return LEX[key][lang === "zh" ? 1 : 0]; }
function bodyText() { return container.textContent ?? ""; }
function retryButton() {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === copy("errTryAgain"));
  expect(button, "a recoverable brief failure offers an in-place retry").toBeDefined();
  return button!;
}
function response(status = 200, body: unknown = boundResponse()) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function answer(index: number, status = 200, body: unknown = boundResponse()) {
  await act(async () => { requests[index].resolve(response(status, body)); });
}
async function fail(index: number) {
  await act(async () => { requests[index].reject(new TypeError("network unavailable")); });
}
async function mount(
  options: {
    locale?: Lang;
    strict?: boolean;
    boundary?: boolean;
    binding?: BriefBinding | null;
    phase?: CanonicalReadPhase;
  } = {},
) {
  lang = options.locale ?? "en";
  document.documentElement.setAttribute("data-lang", lang);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const content = (
    <LangProvider>
      <PortfolioBriefPanel
        population={{ kind: "positions", count: 2 }}
        binding={options.binding === undefined ? BINDING : options.binding}
        phase={options.phase ?? "qualified"}
        onRetry={() => { retries += 1; }}
      />
    </LangProvider>
  );
  const panel = options.boundary ? <BriefErrorBoundary>{content}</BriefErrorBoundary> : content;
  await act(async () => { root!.render(options.strict ? <StrictMode>{panel}</StrictMode> : panel); });
}
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
}
function assertLoading() {
  expect(container.querySelector('[aria-busy="true"]')?.getAttribute("aria-label")).toBe(copy("briefLoading"));
  expect(bodyText()).not.toContain(copy("briefUnavailable"));
}
function assertUnavailable() {
  expect(bodyText()).toContain(copy("briefUnavailable"));
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
}
function assertReady() {
  const brief = briefFixture();
  expect(bodyText()).toContain(brief.headline[lang]);
  expect(bodyText()).not.toContain(brief.headline[lang === "en" ? "zh" : "en"]);
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(bodyText()).toContain("2026-11-02");
  // The population disclosure states the POSITION records the page renders, and the
  // desk's own NAME count beside it — the two are different numbers and are not
  // presented as equal.
  const disclosure = container.querySelector('[data-testid="brief-population"]')?.textContent ?? "";
  expect(disclosure).toContain("2");
  expect(disclosure).toContain("1");
}

beforeEach(() => {
  requests = [];
  root = null;
  lang = "en";
  retries = 0;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe("/api/portfolio-brief");
    // The opt-in is unconditional: the panel always asks for the snapshot contract.
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "X-Mastermind-Portfolio-Context": "snapshot-v1",
    });
    const pending = { ...deferred<Response>(), signal: init?.signal };
    requests.push(pending);
    return pending.promise;
  }));
});
afterEach(() => {
  unmount();
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PortfolioBriefPanel — the bound read", () => {
  for (const locale of ["en", "zh"] as const) {
    it(`preserves initial loading and valid localized rendering (${locale})`, async () => {
      await mount({ locale });
      assertLoading();
      expect(requests).toHaveLength(1);
      await answer(0);
      assertReady();
    });

    it(`refuses a payload with no context — an old producer is not a brief (${locale})`, async () => {
      await mount({ locale });
      await answer(0, 200, briefFixture());
      assertUnavailable();
      expect(bodyText()).not.toContain(briefFixture().headline[locale]);
    });

    it(`refuses a context for another book (${locale})`, async () => {
      await mount({ locale });
      await answer(0, 200, boundResponse({ bookKey: OTHER_BOOK_KEY }));
      assertUnavailable();
      expect(bodyText()).not.toContain(briefFixture().headline[locale]);
    });

    it(`refuses a context for another owner (${locale})`, async () => {
      await mount({ locale });
      await answer(0, 200, boundResponse({ owner: OTHER_OWNER }));
      assertUnavailable();
      expect(bodyText()).not.toContain(briefFixture().headline[locale]);
    });

    for (const status of [401, 403]) {
      it(`keeps ${status} observable with NO canonical binding (${locale})`, async () => {
        await mount({ locale, binding: null, phase: "checking" });
        await answer(0, status, status === 403 ? { error: "pro_required", tier: "free" } : {});
        expect(container.querySelector("button")).toBeNull();
        if (status === 401) expect(bodyText()).toBe("");
        else {
          expect(bodyText()).toContain(copy("briefTeaserWhat"));
          expect(bodyText()).not.toContain(briefFixture().headline[locale]);
        }
      });
    }

    it(`never turns a failed canonical read into a false entitlement result (${locale})`, async () => {
      // The canonical read failed (phase unavailable, no binding). A 403 is still the
      // desk's own entitlement answer and must still be shown as a teaser.
      await mount({ locale, binding: null, phase: "unavailable" });
      await answer(0, 403, { error: "pro_required", tier: "free" });
      expect(bodyText()).toContain(copy("briefTeaserWhat"));
    });

    it(`shows checking while the canonical read is pending and the payload cannot bind (${locale})`, async () => {
      await mount({ locale, binding: null, phase: "checking" });
      await answer(0, 200, boundResponse());
      // The payload is fine but there is no accepted book to bind it to yet.
      assertLoading();
      expect(bodyText()).not.toContain(briefFixture().headline[locale]);
    });
  }

  it("a failed canonical read is unavailable, not a perpetual checking state", async () => {
    await mount({ binding: null, phase: "unavailable" });
    await answer(0, 200, boundResponse());
    assertUnavailable();
  });
});

describe("PortfolioBriefPanel — the deliberate retry", () => {
  it("uses the existing canonical reload, not a second positions reader", async () => {
    await mount();
    await answer(0, 503, {});
    assertUnavailable();
    await act(async () => { retryButton().click(); });
    // The panel asked the PAGE to reload the canonical book; it did not fetch again
    // itself and it never reads positions.
    expect(retries).toBe(1);
  });

  it("a double click starts one reload, not two", async () => {
    await mount();
    await answer(0, 503, {});
    const button = retryButton();
    await act(async () => { button.click(); button.click(); button.click(); });
    expect(retries).toBe(1);
  });

  it("a new accepted BOOK starts a fresh bound read", async () => {
    await mount();
    await answer(0);
    assertReady();
    // The page accepted a different canonical book: the brief on screen would be about
    // another book, so the panel reads again.
    await act(async () => {
      root!.render(
        <LangProvider>
          <PortfolioBriefPanel
            population={{ kind: "positions", count: 2 }}
            binding={{ owner: OWNER, bookKey: OTHER_BOOK_KEY, read: 2 }}
            phase="qualified"
            onRetry={() => { retries += 1; }}
          />
        </LangProvider>,
      );
    });
    expect(requests).toHaveLength(2);
    await answer(1, 200, boundResponse({ bookKey: OTHER_BOOK_KEY }));
    assertReady();
  });

  it("a deliberate retry reads again once the canonical reload lands", async () => {
    await mount();
    await answer(0, 503, {});
    assertUnavailable();
    await act(async () => { retryButton().click(); });
    // The reload was asked for; the brief is read again for the NEWLY accepted binding,
    // so nothing is read until the page publishes that read.
    expect(retries).toBe(1);
    expect(requests).toHaveLength(1);
    await act(async () => {
      root!.render(
        <LangProvider>
          <PortfolioBriefPanel
            population={{ kind: "positions", count: 2 }}
            binding={{ owner: OWNER, bookKey: BOOK_KEY, read: 2 }}
            phase="qualified"
            onRetry={() => { retries += 1; }}
          />
        </LangProvider>,
      );
    });
    expect(requests).toHaveLength(2);
    await answer(1);
    assertReady();
  });

  it("the same accepted binding keeps the identity and starts no new read", async () => {
    await mount();
    await answer(0);
    assertReady();
    await act(async () => {
      root!.render(
        <LangProvider>
          <PortfolioBriefPanel
            population={{ kind: "positions", count: 2 }}
            binding={BINDING}
            phase="qualified"
            onRetry={() => { retries += 1; }}
          />
        </LangProvider>,
      );
    });
    expect(requests).toHaveLength(1);
    assertReady();
  });
});

describe("PortfolioBriefPanel — request ownership", () => {
  for (const oldOutcome of ["success", "failure", "body"] as const) {
    it(`fences a late ${oldOutcome} after unmount and a fresh panel mount`, async () => {
      await mount();
      await answer(0, 503, {});
      // A new accepted book starts a fresh bound read; the one in flight behind it is
      // the predecessor whose late answer must never paint.
      await act(async () => {
        root!.render(
          <LangProvider>
            <PortfolioBriefPanel
              population={{ kind: "positions", count: 2 }}
              binding={{ owner: OWNER, bookKey: OTHER_BOOK_KEY, read: 2 }}
              phase="qualified"
              onRetry={() => { retries += 1; }}
            />
          </LangProvider>,
        );
      });
      expect(requests).toHaveLength(2);
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
        else if (oldOutcome === "body") oldBody.resolve({ ...briefFixture(), headline: { en: "OLD BRIEF", zh: "旧简报" } });
        else stale.resolve(response(200, { ...briefFixture(), headline: { en: "OLD BRIEF", zh: "旧简报" } }));
      });
      assertReady();
      expect(bodyText()).not.toContain("OLD BRIEF");
      expect(requests).toHaveLength(3);
    });
  }

  for (const staleOutcome of ["success", "reject"] as const) {
    it(`retains replacement abort ownership after a predecessor ${staleOutcome} settles`, async () => {
      await mount({ strict: true });
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
      await act(async () => { replacementBody.resolve(boundResponse()); });
      expect(bodyText()).toBe("");
    });
  }

  it("allows the StrictMode replacement load and ignores its late predecessor", async () => {
    await mount({ strict: true });
    expect(requests).toHaveLength(2);
    expect(requests[0].signal?.aborted).toBe(true);
    await answer(1);
    assertReady();
    await fail(0);
    assertReady();
    expect(requests).toHaveLength(2);
  });

  it("keeps a non-JSON failure response retryable", async () => {
    await mount();
    await act(async () => {
      requests[0].resolve({ status: 503, json: async () => { throw new SyntaxError("broken JSON"); } } as unknown as Response);
    });
    assertUnavailable();
    await act(async () => { retryButton().click(); });
    expect(retries).toBe(1);
  });
});
