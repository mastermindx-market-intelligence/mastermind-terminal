/**
 * Lossless nanosecond primitives shared by private server readers and future
 * admitted consumers. No source, transport, entitlement or trading authority.
 */
export class NanosecondContractError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NanosecondContractError";
  }
}

const UNSIGNED_DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const MAX_NATIVE_NS = BigInt("9223372036854775807");
const NS_PER_MS = BigInt("1000000");

/** Accept canonical decimal strings only; JSON numbers are never ns inputs. */
export function parseUnsignedNanoseconds(value: unknown, field = "ns"): bigint {
  if (typeof value !== "string" || !UNSIGNED_DECIMAL.test(value)) {
    throw new NanosecondContractError(field + ":unsafe_ns");
  }
  const ns = BigInt(value);
  if (ns > MAX_NATIVE_NS) throw new NanosecondContractError(field + ":overflow");
  return ns;
}

/**
 * Deliberately floor to milliseconds for display only, after integer division.
 * Keep the exact original and remainder. Never use milliseconds for source
 * identity, receipt ordering, point-in-time admission, replay or pairing.
 */
export function nanosecondsToDisplayMilliseconds(ns: bigint): Readonly<{
  milliseconds: number;
  originalNanoseconds: string;
  discardedNanoseconds: string;
  precision: "MILLISECONDS_FLOORED_FOR_DISPLAY";
}> {
  if (typeof ns !== "bigint" || ns < BigInt("0") || ns > MAX_NATIVE_NS) {
    throw new NanosecondContractError("display_ns:invalid_native_ns");
  }
  const milliseconds = Number(ns / NS_PER_MS);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new NanosecondContractError("display_ns:unsafe_milliseconds");
  }
  return Object.freeze({
    milliseconds,
    originalNanoseconds: ns.toString(),
    discardedNanoseconds: (ns % NS_PER_MS).toString(),
    precision: "MILLISECONDS_FLOORED_FOR_DISPLAY",
  });
}
