// Mastermind Chart Engine — canvas refusal types (P3).
//
// EngineRefusalError is the single typed refusal the native renderer throws when
// construction, applyOptions, or attachPrimitive cannot honour the request.
// This module must stay free of index.ts / model.ts imports so both the engine
// and the option gate can share it without a cycle.

import { enginePrimitiveShapeErrors, type EnginePrimitive } from "../primitive";

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

/**
 * Shape-guard an attachPrimitive argument. Throws EngineRefusalError naming
 * every missing/invalid member; never imports renderer state.
 */
export function assertEnginePrimitive(value: unknown): asserts value is EnginePrimitive {
  const missing = enginePrimitiveShapeErrors(value);
  if (missing.length > 0) {
    throw new EngineRefusalError("attachPrimitive: not an EnginePrimitive", missing);
  }
}
