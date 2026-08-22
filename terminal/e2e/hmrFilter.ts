/**
 * The Fast Refresh frame filter used by e2e/fixtures.ts, as a pure state machine so its safety
 * property can be tested without a browser (lib/__tests__/e2eHmrFilter.test.ts).
 *
 * Not a spec file: Playwright's default testMatch only collects *.spec.ts, so this module is
 * imported, never run.
 *
 * This is NOT the fix for the rotating CI flake — that is the hydration race gated in
 * e2e/hydration.ts. It removes a separate, real perturbation:
 *
 * `next dev` broadcasts a `building`/`built` pair to every connected page on essentially every
 * request it serves, including requests that changed nothing — 158 such pairs in 51 seconds across
 * twelve tests, measured against a warm server. The page cannot tell them from real ones: `built`
 * drives handleHotUpdate(), so each pair re-renders the tree and refetches the RSC payload. In a
 * fullyParallel run that re-renders the page another worker is mid-gesture on. e2e/fixtures.ts
 * carries the full account.
 *
 * THE SAFETY PROPERTY, which is the whole design: a pair is withheld only when NOTHING passed
 * between its two halves. Turbopack delivers a lazily-built chunk as `turbopack-message` and the
 * page applies it when the following `built` lands, so a `built` that follows real traffic must
 * get through or the surface never mounts. Both blunter versions of this were tried and both broke
 * the suite — see the notes in e2e/fixtures.ts before loosening anything here.
 */

export type HmrFrame = string | Buffer;

type Frame = { type?: string; errors?: unknown[]; warnings?: unknown[] };

function parse(message: HmrFrame): Frame | null {
  if (typeof message !== "string" || !message.startsWith("{")) return null;
  try { return JSON.parse(message) as Frame; } catch { return null; }
}

/** Anything unrecognised reports as "" and takes the default branch — forwarded, and releasing any
 *  held pair. An unknown frame is assumed to matter. */
function frameType(message: HmrFrame): string {
  return parse(message)?.type ?? "";
}

/** `{"type":"built",…,"errors":[],"warnings":[]}` — nothing for the page to report. */
function isClean(message: HmrFrame): boolean {
  const frame = parse(message);
  return !!frame && !frame.errors?.length && !frame.warnings?.length;
}

/**
 * One filter per socket. Feed it each server→client frame; forward exactly what it returns, in
 * order. Frames are never reordered and never duplicated — a held `building` is emitted ahead of
 * whatever released it.
 */
export function createHmrFilter(): (message: HmrFrame) => HmrFrame[] {
  // `building` is held rather than dropped: at that moment the pair's contents are still unknown.
  let heldBuilding: HmrFrame | null = null;

  return (message) => {
    const forward: HmrFrame[] = [];
    const release = () => {
      if (heldBuilding !== null) { forward.push(heldBuilding); heldBuilding = null; }
    };

    switch (frameType(message)) {
      case "building":
        release();                 // a second `building` with no `built` between — the first was real
        heldBuilding = message;
        return forward;
      case "built":
        // A `built` carrying errors or warnings always goes through, so a genuine compile failure
        // reaches the page and its overlay instead of becoming a mystery timeout.
        if (heldBuilding !== null && isClean(message)) { heldBuilding = null; return forward; }
        release();
        break;
      case "isrManifest":
        // Pure telemetry for the dev indicator. It says nothing about the pending build, so it must
        // not be read as "something happened" and release the pair.
        break;
      default:
        // turbopack-message, turbopack-connected, sync, serverComponentChanges … every one of them
        // means the pair around it is doing real work.
        release();
    }

    forward.push(message);
    return forward;
  };
}
