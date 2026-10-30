import { describe, expect, it } from "vitest";
import {
  NanosecondContractError,
  nanosecondsToDisplayMilliseconds,
  parseUnsignedNanoseconds,
} from "../tp1Nanoseconds";

describe("private consumer nanoseconds", () => {
  it("retains adjacent nanoseconds through ordinary JSON transport", () => {
    const source = {
      event: "1791417600000000123",
      receipt: "1791417600000000124",
    };
    const received = JSON.parse(JSON.stringify(source));
    const event = parseUnsignedNanoseconds(received.event, "event");
    const receipt = parseUnsignedNanoseconds(received.receipt, "receipt");
    expect(receipt - event).toBe(BigInt("1"));
    expect(event < receipt).toBe(true);
  });

  it.each([
    1791417600000000123, 1, 0, null, undefined, true, {}, [],
    "01", "+1", "-1", "1.0", "1e9", " 1", "1 ", "", "NaN",
    "100000000000000000000000000000000000000",
    "1\n", "1\r", "1\u2028", "1\u2029", "1\r\n",
  ])("refuses unsafe or noncanonical clock %j", value => {
    expect(() => parseUnsignedNanoseconds(value)).toThrow(NanosecondContractError);
  });

  it("accepts the exact signed-native ceiling and refuses one nanosecond more", () => {
    expect(parseUnsignedNanoseconds("0")).toBe(BigInt("0"));
    expect(parseUnsignedNanoseconds("9223372036854775807").toString())
      .toBe("9223372036854775807");
    expect(() => parseUnsignedNanoseconds("9223372036854775808"))
      .toThrow(/overflow/);
  });

  it("labels display truncation and retains the discarded evidence", () => {
    const first = parseUnsignedNanoseconds("1791417600000000123");
    const second = first + BigInt("1");
    const a = nanosecondsToDisplayMilliseconds(first);
    const b = nanosecondsToDisplayMilliseconds(second);
    expect(a.milliseconds).toBe(1791417600000);
    expect(b.milliseconds).toBe(a.milliseconds);
    expect(a.originalNanoseconds).toBe(first.toString());
    expect(a.discardedNanoseconds).toBe("123");
    expect(b.discardedNanoseconds).toBe("124");
    expect(a.precision).toBe("MILLISECONDS_FLOORED_FOR_DISPLAY");
    expect(parseUnsignedNanoseconds(a.originalNanoseconds))
      .toBe(BigInt(a.milliseconds) * BigInt("1000000")
        + BigInt(a.discardedNanoseconds));
  });

  it("checks display input at runtime instead of trusting TypeScript casts", () => {
    for (const ns of [
      -BigInt("1"), BigInt("9223372036854775808"), 1 as unknown as bigint,
    ]) {
      expect(() => nanosecondsToDisplayMilliseconds(ns))
        .toThrow(/invalid_native_ns/);
    }
  });
});
