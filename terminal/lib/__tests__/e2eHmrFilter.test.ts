import { describe, expect, it } from "vitest";
import { createHmrFilter, type HmrFrame } from "../../e2e/hmrFilter";

// ── THE FILTER THAT DECIDES WHETHER next/dynamic MOUNTS ───────────────────────────────────────
//
// e2e/hmrFilter.ts withholds `next dev`'s no-op `building`/`built` pairs, which otherwise re-render
// whichever page another worker is mid-gesture on (the account is in e2e/fixtures.ts). It is one
// switch statement, and getting it slightly wrong does NOT look like a bug in it: the first version
// withheld every clean `built`, which silently stopped Turbopack applying lazily-built chunks, and
// four Pine editor specs turned into "the editor never appeared". That shipped to one CI run and
// was green, because retries covered it.
//
// So the property under test is not "no-ops are dropped" — it is the converse: a `built` that
// follows ANY real traffic must get through. These cases are cheap to run and would have caught it
// in seconds.

const building = '{"type":"building"}';
const built = (extra = "") => `{"type":"built","hash":"3","errors":[],"warnings":[]${extra}}`;
const builtWithError = '{"type":"built","hash":"3","errors":["boom"],"warnings":[]}';
const builtWithWarning = '{"type":"built","hash":"3","errors":[],"warnings":["hm"]}';
const isrManifest = '{"type":"isrManifest","data":{"/terminal":false}}';
const turbopackMessage = '{"type":"turbopack-message","data":{"instruction":{}}}';
const turbopackConnected = '{"type":"turbopack-connected","data":{"sessionId":1}}';
const sync = '{"type":"sync","errors":[],"warnings":[],"hash":""}';
const ping = '{"event":"ping"}';

/** Feed a whole sequence through one filter and collect everything forwarded, in order. */
const run = (frames: HmrFrame[]) => {
  const filter = createHmrFilter();
  return frames.flatMap((frame) => filter(frame));
};

describe("the dev-server Fast Refresh filter", () => {
  it("withholds a no-op build pair — the frames that caused the flake", () => {
    expect(run([building, built()])).toEqual([]);
  });

  it("withholds it across the ISR telemetry that interleaves with it", () => {
    // isrManifest arrives constantly (186 frames in 51s alongside 158 pairs). Treating it as
    // "something happened" would release nearly every pair and the filter would do nothing.
    expect(run([building, isrManifest, isrManifest, built()])).toEqual([isrManifest, isrManifest]);
  });

  it("lets a build carrying a chunk update through, in order — next/dynamic depends on it", () => {
    // Turbopack delivers a lazily-built chunk as turbopack-message and the page applies it when
    // the following `built` lands. Withhold that `built` and the surface never mounts.
    expect(run([building, turbopackMessage, built()])).toEqual([building, turbopackMessage, built()]);
  });

  it("lets one through around any other real frame", () => {
    for (const frame of [turbopackConnected, sync, ping, '{"type":"serverComponentChanges","hash":"x"}']) {
      expect(run([building, frame, built()]), frame).toEqual([building, frame, built()]);
    }
  });

  it("never withholds a build that reports errors or warnings", () => {
    // A real compile failure has to reach the page and its overlay, or it becomes a mystery timeout.
    expect(run([building, builtWithError])).toEqual([building, builtWithError]);
    expect(run([building, builtWithWarning])).toEqual([building, builtWithWarning]);
  });

  it("forwards a `built` that arrives with no `building` held", () => {
    expect(run([built()])).toEqual([built()]);
  });

  it("releases an orphaned `building` rather than swallowing it", () => {
    // Two `building` frames with no `built` between them: the first belonged to a build whose
    // result is coming later, so holding it forever would lose it.
    expect(run([building, building, turbopackMessage, built()]))
      .toEqual([building, building, turbopackMessage, built()]);
  });

  it("forwards frames it does not recognise, and treats them as real", () => {
    const unknown = '{"type":"somethingNextAddedLater"}';
    expect(run([unknown])).toEqual([unknown]);
    expect(run([building, unknown, built()])).toEqual([building, unknown, built()]);
  });

  it("survives frames that are not JSON at all", () => {
    expect(run(["not json", building, built()])).toEqual(["not json"]);
  });

  it("keeps its state per socket, not per module", () => {
    const a = createHmrFilter();
    const b = createHmrFilter();
    expect(a(building)).toEqual([]);            // a is holding
    expect(b(built())).toEqual([built()]);      // b holds nothing, so this is not its pair
    expect(a(built())).toEqual([]);             // a's pair completes and is withheld
  });

  it("does not withhold anything else the server sends", () => {
    const noise = [isrManifest, ping, sync, turbopackConnected, turbopackMessage];
    expect(run(noise)).toEqual(noise);
  });
});
