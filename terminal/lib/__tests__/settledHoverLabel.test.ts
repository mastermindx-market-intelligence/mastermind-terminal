import { describe, expect, it } from "vitest";
import { hoverLabelOk, hoverLabelSame, type HoverLabelSample } from "../../e2e/helpers/settled";

// Hosted Shape A (job 101689653547 retry 1 at crosshair-price-label.spec.ts:348):
// the locator resolved 13× to <div class="mm-hovertag">192.74</div> with
// Received: hidden. The previous settle treated leftover text as success.

const hiddenLeftover: HoverLabelSample = {
  visible: false,
  text: "192.74",
  box: null,
};

const visible: HoverLabelSample = {
  visible: true,
  text: "192.74",
  box: { x: 1200, y: 240, width: 66, height: 21 },
};

describe("hoverLabelOk — leftover text on a hidden tag is not laid out", () => {
  it("rejects the hosted Shape A reading (text 192.74, display none)", () => {
    expect(hoverLabelOk(hiddenLeftover)).toBe(false);
  });

  it("rejects an empty visible tag", () => {
    expect(hoverLabelOk({ visible: true, text: "", box: visible.box })).toBe(false);
  });

  it("rejects a visible tag with no box", () => {
    expect(hoverLabelOk({ visible: true, text: "192.74", box: null })).toBe(false);
  });

  it("accepts a visible tag with text and a box", () => {
    expect(hoverLabelOk(visible)).toBe(true);
  });
});

describe("hoverLabelSame — one observation, not poll-then-reread", () => {
  it("rejects a hidden leftover pair even when the text matches", () => {
    expect(hoverLabelSame(hiddenLeftover, hiddenLeftover)).toBe(false);
  });

  it("rejects a box that is still moving", () => {
    expect(hoverLabelSame(visible, { ...visible, box: { ...visible.box!, y: 248 } })).toBe(false);
  });

  it("accepts a repeated visible reading", () => {
    expect(hoverLabelSame(visible, { ...visible, box: { ...visible.box! } })).toBe(true);
  });
});
