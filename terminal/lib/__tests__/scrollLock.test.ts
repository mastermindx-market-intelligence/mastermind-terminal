// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetScrollLockForTests, acquireScrollLock } from "../scrollLock";

function overflow() {
  return { body: document.body.style.overflow, root: document.documentElement.style.overflow };
}

const LOCKED = { body: "hidden", root: "hidden" };

describe("acquireScrollLock", () => {
  beforeEach(() => {
    __resetScrollLockForTests();
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";
  });

  afterEach(() => {
    __resetScrollLockForTests();
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  });

  it("locks body and html, and one release restores the original values", () => {
    const release = acquireScrollLock();
    expect(overflow()).toEqual(LOCKED);
    release();
    expect(overflow()).toEqual({ body: "auto", root: "scroll" });
  });

  it("stays locked until the last holder releases, even when they release out of order", () => {
    const releaseA = acquireScrollLock();
    const releaseB = acquireScrollLock();
    releaseA();
    expect(overflow()).toEqual(LOCKED);
    releaseB();
    expect(overflow()).toEqual({ body: "auto", root: "scroll" });
  });

  it("ignores a second call of the same release, so it cannot drop another holder", () => {
    const releaseA = acquireScrollLock();
    const releaseB = acquireScrollLock();
    releaseA();
    releaseA();
    expect(overflow()).toEqual(LOCKED);
    releaseB();
    expect(overflow()).toEqual({ body: "auto", root: "scroll" });
    releaseB();
    expect(overflow()).toEqual({ body: "auto", root: "scroll" });
  });

  it("saves the then-current values on a fresh acquire after a full release", () => {
    acquireScrollLock()();
    document.body.style.overflow = "clip";
    document.documentElement.style.overflow = "visible";
    const release = acquireScrollLock();
    expect(overflow()).toEqual(LOCKED);
    release();
    expect(overflow()).toEqual({ body: "clip", root: "visible" });
  });
});
