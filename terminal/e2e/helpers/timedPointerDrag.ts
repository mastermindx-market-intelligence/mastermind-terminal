export type TimedPointerDrag = {
  from: { x: number; y: number };
  dy: number;
  dx?: number;
  durationMs: number;
};

/** Serializable for locator.evaluate: gesture speed must not depend on RPC latency. */
export function dispatchTimedPointerDrag(target: Element, gesture: TimedPointerDrag): void {
  const { from, dy, dx = 0, durationMs } = gesture;
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("A timed drag needs a positive duration");
  const startedAt = Math.max(1, performance.now());
  const send = (type: string, fraction: number, elapsed: number) => {
    const event = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 11, pointerType: "touch", isPrimary: true, button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: from.x + dx * fraction,
      clientY: from.y + dy * fraction,
    });
    Object.defineProperty(event, "timeStamp", { value: startedAt + elapsed });
    target.dispatchEvent(event);
  };
  send("pointerdown", 0, 0);
  for (const fraction of [0.35, 0.7, 1]) send("pointermove", fraction, durationMs * fraction);
  send("pointerup", 1, durationMs + 1);
}
