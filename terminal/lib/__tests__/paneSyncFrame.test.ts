import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Time } from "lightweight-charts";
import { broadcastCrosshair, registerPane, setPaneSync } from "@/lib/paneSync";

type MockPeer = {
  peer: Parameters<typeof registerPane>[1];
  setCrosshairPosition: ReturnType<typeof vi.fn>;
  clearCrosshairPosition: ReturnType<typeof vi.fn>;
  onCrosshair: ReturnType<typeof vi.fn>;
};

function mockPeer(value: number, tf = "D"): MockPeer {
  const setCrosshairPosition = vi.fn();
  const clearCrosshairPosition = vi.fn();
  const onCrosshair = vi.fn();
  return {
    setCrosshairPosition,
    clearCrosshairPosition,
    onCrosshair,
    peer: {
      chart: { setCrosshairPosition, clearCrosshairPosition } as unknown as MockPeer["peer"]["chart"],
      series: {} as unknown as MockPeer["peer"]["series"],
      valueAt: () => value,
      tf,
      onCrosshair,
    },
  };
}

describe("paneSync crosshair frame scheduling", () => {
  let frames: FrameRequestCallback[];
  let cancelled: Set<number>;

  beforeEach(() => {
    frames = [];
    cancelled = new Set();
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => cancelled.add(id)));
    setPaneSync(true);
  });

  afterEach(() => {
    setPaneSync(false);
    vi.unstubAllGlobals();
  });

  it("coalesces a same-frame burst and mirrors only the latest crosshair", () => {
    const source = mockPeer(100);
    const target = mockPeer(200);
    const offSource = registerPane(1, source.peer);
    const offTarget = registerPane(2, target.peer);

    for (let i = 0; i < 20; i++) {
      const day = String(i + 1).padStart(2, "0");
      broadcastCrosshair(1, ("2026-09-" + day) as Time);
    }

    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(0);
    expect(frames).toHaveLength(1);

    frames[0](16);
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(target.setCrosshairPosition).toHaveBeenLastCalledWith(
      200,
      "2026-09-20",
      target.peer.series,
    );
    expect(target.onCrosshair).toHaveBeenCalledTimes(1);

    offTarget();
    offSource();
  });

  it("drops a queued sample when its source pane unregisters before paint", () => {
    const source = mockPeer(100);
    const target = mockPeer(200);
    const offSource = registerPane(1, source.peer);
    const offTarget = registerPane(2, target.peer);

    broadcastCrosshair(1, "2026-09-19" as Time);
    expect(frames).toHaveLength(1);

    offSource();
    frames[0](16);
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(0);
    expect(target.onCrosshair).toHaveBeenCalledTimes(0);

    offTarget();
  });
  it("disabling sync clears immediately and cancels a queued mirror", () => {
    const source = mockPeer(100);
    const target = mockPeer(200);
    const offSource = registerPane(1, source.peer);
    const offTarget = registerPane(2, target.peer);

    broadcastCrosshair(1, "2026-09-19" as Time);
    expect(frames).toHaveLength(1);

    setPaneSync(false);
    expect(cancelled).toContain(1);
    expect(target.clearCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(target.onCrosshair).toHaveBeenLastCalledWith(null, null);

    frames[0](16);
    expect(target.setCrosshairPosition).toHaveBeenCalledTimes(0);

    offTarget();
    offSource();
  });
});
