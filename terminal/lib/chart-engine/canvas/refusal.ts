// Mastermind Chart Engine — canvas refusal types (P3).
//
// EngineRefusalError is the single typed refusal the native renderer throws when
// construction, applyOptions, or attachPrimitive cannot honour the request.
// This module must stay free of index.ts / model.ts imports so both the engine
// and the option gate can share it without a cycle.

import type { EnginePrimitive, PrimitiveZOrder } from "../primitive";

export class EngineRefusalError extends Error {
  readonly reason: string;
  readonly unsupported: string[];
  constructor(reason: string, unsupported: string[]) {
    super(reason);
    this.name = "EngineRefusalError";
    this.reason = reason;
    this.unsupported = unsupported;
  }
}

const Z_ORDERS: readonly PrimitiveZOrder[] = ["bottom", "normal", "top"];

/**
 * Shape-guard an attachPrimitive argument. Throws EngineRefusalError naming
 * every missing/invalid member; never imports renderer state.
 */
export function assertEnginePrimitive(value: unknown): asserts value is EnginePrimitive {
  if (value == null || typeof value !== "object") {
    throw new EngineRefusalError("attachPrimitive: not an EnginePrimitive", ["object"]);
  }
  const bag = value as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof bag.id !== "string") missing.push("id");
  if (typeof bag.attached !== "function") missing.push("attached");
  if (typeof bag.detached !== "function") missing.push("detached");
  if (typeof bag.update !== "function") missing.push("update");
  if (bag.paint != null && typeof bag.paint !== "function") missing.push("paint");
  if (bag.hitTest != null && typeof bag.hitTest !== "function") missing.push("hitTest");
  if (bag.zOrder != null && !Z_ORDERS.includes(bag.zOrder as PrimitiveZOrder)) {
    missing.push("zOrder");
  }
  if (missing.length > 0) {
    throw new EngineRefusalError("attachPrimitive: not an EnginePrimitive", missing);
  }
}
