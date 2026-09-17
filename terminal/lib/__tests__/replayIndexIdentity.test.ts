import { describe, expect, it } from "vitest";
import { initReplay, replayReducer, stampAt } from "@/lib/replayEngine";

describe("replay index changes preserve the selected timestamp", () => {
  it("does not change the paused time when an earlier frame is inserted", () => {
    let state = initReplay(["0930", "0932", "0934"]);
    state = replayReducer(state, { type: "setFrame", frame: 1 });
    state = replayReducer(state, { type: "setStamps", stamps: ["0930", "0931", "0932", "0934"] });
    expect(stampAt(state)).toBe("0932");
  });
  it("uses the preceding available frame, not later knowledge, if the selected stamp is withdrawn", () => {
    let state = initReplay(["0930", "0932", "0934"]);
    state = replayReducer(state, { type: "setFrame", frame: 1 });
    state = replayReducer(state, { type: "setStamps", stamps: ["0930", "0934"] });
    expect(stampAt(state)).toBe("0930");
  });
  it("still follows a growing head when the user has not sought back", () => {
    const state = replayReducer(initReplay(["0930", "0931"]), { type: "setStamps", stamps: ["0930", "0931", "0932"] });
    expect(stampAt(state)).toBe("0932");
  });
});


it("keeps a manually paused head fixed when newer frames appear", () => {
  const paused = replayReducer(initReplay(["0930", "0931"]), { type: "pause" });
  const next = replayReducer(paused, { type: "setStamps", stamps: ["0930", "0931", "0932"] });
  expect(stampAt(next)).toBe("0931");
});

it("does not jump to later knowledge when no preceding observation remains", () => {
  let state = replayReducer(initReplay(["0930", "0931"]), { type: "toFirst" });
  state = replayReducer(state, { type: "setStamps", stamps: ["0932", "0933"] });
  expect(stampAt(state)).toBeNull();
  state = replayReducer(state, { type: "toLast" });
  expect(stampAt(state)).toBe("0933");
});
