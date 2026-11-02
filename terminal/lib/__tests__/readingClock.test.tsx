// @vitest-environment jsdom
// useReadingClock — Today's minute hand. Cover the behaviors that make it safe to mount
// inside the reading workspaces: it crosses real minute boundaries exactly from a
// mid-second start (one self-rearming setTimeout, never an interval), a visible wake
// resamples a wall clock that moved while the document was suspended, a hidden event
// cancels the armed boundary and neither a hidden mount nor a hidden tick ever arms or
// updates, unmount leaves no timer behind and no listener that could rearm one, and the
// clock never reaches for fetch or storage — the wall clock is the only authority. With
// a bucket, the whole consumer holds still across boundaries inside one bucket, moves
// exactly once at the bucket rollover, and a visible wake catches a bucket that changed
// while suspended — the latest callback, never the mount-time one.
import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadingClock } from "@/lib/shared-shell/useReadingClock";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mid-second start: a coarse interval hand would drift off this grid immediately.
const BASE = new Date(2026, 10, 2, 12, 59, 59, 500);
const NOON = new Date(2026, 10, 2, 13, 0, 0, 0);
// Wall clock read after a long suspended period, mid-minute on purpose.
const WAKE = new Date(2026, 10, 2, 13, 7, 23, 456);
// Mid-afternoon start for the bucket probe, mid-second so the first boundary is exact.
const PROBE_START = new Date(2026, 10, 2, 13, 52, 23, 100);
// Bucket-probe mount sample, and the wake sample that lands two minutes later.
const P0 = new Date(2026, 10, 2, 13, 4, 7, 250);
const P_WAKE = new Date(2026, 10, 2, 13, 7, 3, 400);

// Bucket callbacks an owner might pass before/after data lands.
const hourBucket = (now: Date) => `h${now.getHours()}`;
const minuteBucket = (now: Date) => `h${now.getHours()}m${now.getMinutes()}`;

function ClockProbe() {
  const now = useReadingClock();
  return <span data-testid="clock-ms">{now.getTime()}</span>;
}

// Count committed consumer/child updates; a same-bucket sample must not update the UI.
let consumerCommits = 0;
let childCommits = 0;
function BucketLabel({ now, bucket }: { now: Date; bucket: (now: Date) => string }) {
  useLayoutEffect(() => { childCommits += 1; });
  return (
    <span data-testid="bucket-clock" data-ms={now.getTime()}>
      {bucket(now)}
    </span>
  );
}
function BucketProbe({ bucket }: { bucket: (now: Date) => string }) {
  useLayoutEffect(() => { consumerCommits += 1; });
  const now = useReadingClock(bucket);
  return <BucketLabel now={now} bucket={bucket} />;
}

let roots: Root[] = [];
function mountNode(node: ReactNode): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => { root.render(node); });
  return { host, root };
}
function render(): HTMLDivElement {
  return mountNode(<ClockProbe />).host;
}
function renderProbe(bucket: (now: Date) => string): { host: HTMLDivElement; root: Root } {
  return mountNode(<BucketProbe bucket={bucket} />);
}
const shown = (host: HTMLElement) => Number(host.querySelector("[data-testid=clock-ms]")!.textContent);
const bucketLabel = (host: HTMLElement) => host.querySelector("[data-testid=bucket-clock]")!.textContent;
const probeMs = (host: HTMLElement) =>
  Number(host.querySelector("[data-testid=bucket-clock]")!.getAttribute("data-ms"));

// jsdom keeps `visibilityState` as a prototype getter; shadow it with an own property
// per test and drop the shadow in afterEach, so no test leans on spy-restore ordering.
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { get: () => state, configurable: true });
}
const wakeVisible = () => {
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  consumerCommits = 0;
  childCommits = 0;
});
afterEach(() => {
  for (const root of roots) act(() => { root.unmount(); });
  roots = [];
  document.body.innerHTML = "";
  delete (document as { visibilityState?: string }).visibilityState;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReadingClock", () => {
  it("crosses the minute boundary exactly, then the next one, on a single timer", () => {
    const host = render();
    expect(shown(host)).toBe(BASE.getTime());
    expect(vi.getTimerCount()).toBe(1);

    act(() => { vi.advanceTimersByTime(499); }); // 12:59:59.999 — still the same minute
    expect(shown(host)).toBe(BASE.getTime());
    expect(vi.getTimerCount()).toBe(1); // still the one armed boundary, nothing rearmed early

    act(() => { vi.advanceTimersByTime(1); }); // 13:00:00.000
    expect(shown(host)).toBe(NOON.getTime());

    act(() => { vi.advanceTimersByTime(59_999); }); // 13:00:59.999 — no early fire
    expect(shown(host)).toBe(NOON.getTime());
    act(() => { vi.advanceTimersByTime(1); }); // 13:01:00.000 — the timer rearmed itself
    expect(shown(host)).toBe(new Date(2026, 10, 2, 13, 1, 0, 0).getTime());
    expect(vi.getTimerCount()).toBe(1); // the chain keeps exactly one timer alive
  });

  it("a visible wake resamples a wall clock that moved while the document was suspended", () => {
    const host = render();
    vi.setSystemTime(WAKE); // the machine slept through several boundaries; no timer fired
    wakeVisible();
    expect(shown(host)).toBe(WAKE.getTime()); // resynced immediately, not at a stale boundary
    expect(vi.getTimerCount()).toBe(1); // exactly one boundary armed again

    act(() => { vi.advanceTimersByTime(36_543); }); // 13:07:59.999 — armed to the true next minute
    expect(shown(host)).toBe(WAKE.getTime());
    act(() => { vi.advanceTimersByTime(1); }); // 13:08:00.000
    expect(shown(host)).toBe(new Date(2026, 10, 2, 13, 8, 0, 0).getTime());
  });

  it("a hidden event cancels the timer: the reading hand holds while the wall clock is ahead", () => {
    const host = render();
    expect(vi.getTimerCount()).toBe(1);

    setVisibility("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0); // the armed boundary was dropped, nothing updated

    act(() => { vi.advanceTimersByTime(120_000); }); // nothing is armed; hidden cannot update
    expect(shown(host)).toBe(BASE.getTime());
    expect(vi.getTimerCount()).toBe(0); // and a hidden tick cannot have rearmed

    vi.setSystemTime(WAKE); // the wall clock ran on while the reading was hidden
    wakeVisible(); // visible exactly once: one sample, one rearm
    expect(shown(host)).toBe(WAKE.getTime());
    expect(vi.getTimerCount()).toBe(1);

    act(() => { vi.advanceTimersByTime(36_543); }); // 13:07:59.999 — rearmed on the true grid
    expect(shown(host)).toBe(WAKE.getTime());
    act(() => { vi.advanceTimersByTime(1); }); // 13:08:00.000
    expect(shown(host)).toBe(new Date(2026, 10, 2, 13, 8, 0, 0).getTime());
  });

  it("mounts silent while hidden: nothing arms until the document returns", () => {
    setVisibility("hidden");
    const host = render();
    expect(vi.getTimerCount()).toBe(0); // a hidden mount never arms

    act(() => { vi.advanceTimersByTime(120_000); }); // no boundary can fire, none can rearm
    expect(shown(host)).toBe(BASE.getTime());
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(BASE); // the wall clock has not moved since mount
    wakeVisible(); // first visible moment: sample now, arm the grid
    expect(vi.getTimerCount()).toBe(1);
    expect(shown(host)).toBe(BASE.getTime());

    act(() => { vi.advanceTimersByTime(499); }); // 12:59:59.999 — armed from the wake
    expect(shown(host)).toBe(BASE.getTime());
    act(() => { vi.advanceTimersByTime(1); }); // 13:00:00.000
    expect(shown(host)).toBe(NOON.getTime());
  });

  it("unmount leaves no timer behind and no listener that could rearm one", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<ClockProbe />); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0); // the boundary chain did not survive the unmount

    act(() => {
      document.dispatchEvent(new Event("visibilitychange")); // the listener is gone…
      vi.advanceTimersByTime(120_000); // …so the wake cannot rearm, and no stale fire lands
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never reaches for fetch or storage: the wall clock is the only authority", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const storage = vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const host = render();

    act(() => { vi.advanceTimersByTime(500); }); // one minute boundary
    vi.setSystemTime(WAKE);
    wakeVisible();
    expect(shown(host)).toBe(WAKE.getTime());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it("a bucket holds the whole consumer still within the hour, then moves it once at the rollover", () => {
    vi.setSystemTime(PROBE_START); // 13:52:23.100, mid-second, inside hour 13
    const { host } = renderProbe(hourBucket);
    expect(consumerCommits).toBe(1);
    expect(childCommits).toBe(1);
    expect(bucketLabel(host)).toBe("h13");

    for (let minute = 53; minute <= 59; minute++) {
      act(() => { vi.advanceTimersByTime(minute === 53 ? 36_900 : 60_000); }); // 13:53:00.000 … 13:59:00.000
      expect(bucketLabel(host)).toBe("h13"); // same bucket, so…
      expect(probeMs(host)).toBe(PROBE_START.getTime()); // …every sampled Date was dropped, not kept
      expect(consumerCommits).toBe(1); // the tick sampled, the bucket matched, nothing rerendered
      expect(childCommits).toBe(1);
    }

    act(() => { vi.advanceTimersByTime(60_000); }); // 14:00:00.000 — the bucket rolls over
    expect(probeMs(host)).toBe(new Date(2026, 10, 2, 14, 0, 0, 0).getTime());
    expect(bucketLabel(host)).toBe("h14");
    expect(consumerCommits).toBe(2); // exactly one rerender for the rollover
    expect(childCommits).toBe(2);

    act(() => { vi.advanceTimersByTime(60_000); }); // 14:01:00.000 — same new bucket
    expect(probeMs(host)).toBe(new Date(2026, 10, 2, 14, 0, 0, 0).getTime()); // the Date held
    expect(bucketLabel(host)).toBe("h14"); // nothing changed again
    expect(childCommits).toBe(2); // the workspace below the hook stayed put
    expect(consumerCommits).toBe(2); // no second UI update for the same bucket
  });

  it("a visible wake catches a bucket that changed while the reading was suspended", () => {
    vi.setSystemTime(P0); // 13:04:07.250
    const { host, root } = renderProbe(hourBucket);
    expect(consumerCommits).toBe(1);
    expect(bucketLabel(host)).toBe("h13");

    act(() => { vi.advanceTimersByTime(52_750); }); // 13:05:00.000 — same hour bucket
    expect(consumerCommits).toBe(1);
    expect(probeMs(host)).toBe(P0.getTime()); // the sampled Date was dropped, the old one kept

    setVisibility("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(new Date(2026, 10, 2, 13, 5, 33, 400));
    act(() => { vi.advanceTimersByTime(90_000); }); // hidden: the wall clock runs to 13:07:03.400, nothing updates
    expect(consumerCommits).toBe(1);
    expect(probeMs(host)).toBe(P0.getTime());

    // Owner/data results land: the consumer re-renders with a finer bucket callback.
    act(() => { root.render(<BucketProbe bucket={minuteBucket} />); });
    expect(consumerCommits).toBe(2); // the prop change rerendered the consumer…
    expect(probeMs(host)).toBe(P0.getTime()); // …but the clock held its Date
    expect(bucketLabel(host)).toBe("h13m4");

    // Still hidden — even a wake-shaped dispatch cannot move it.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(consumerCommits).toBe(2);
    expect(vi.getTimerCount()).toBe(0);

    wakeVisible(); // the wake reads the LATEST callback and catches the changed bucket
    expect(consumerCommits).toBe(3); // under the old hour bucket this wake would have been silent
    expect(probeMs(host)).toBe(P_WAKE.getTime());
    expect(bucketLabel(host)).toBe("h13m7");
    expect(vi.getTimerCount()).toBe(1); // rearmed exactly once, on the minute grid

    act(() => { vi.advanceTimersByTime(56_599); }); // 13:07:59.999 — armed to the true next minute
    expect(consumerCommits).toBe(3);
    act(() => { vi.advanceTimersByTime(1); }); // 13:08:00.000 — the minute bucket moved once
    expect(probeMs(host)).toBe(new Date(2026, 10, 2, 13, 8, 0, 0).getTime());
    expect(bucketLabel(host)).toBe("h13m8");
    expect(consumerCommits).toBe(4);
  });
});
