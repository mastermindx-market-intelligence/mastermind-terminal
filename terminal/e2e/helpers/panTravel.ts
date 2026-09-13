/** `|moved - dx|` — the number Playwright prints as Received on these drag specs. */
export function panTravelError(moved: number, dx: number): number {
  return Math.abs(moved - dx);
}

/** True only when travel is within slack of the requested drag, not merely past `dx * 0.5`. */
export function panTravelOk(moved: number, dx: number, slack = 0.35): boolean {
  return Number.isFinite(moved) && Number.isFinite(dx) && dx > 0
    && panTravelError(moved, dx) < dx * slack;
}

export type PanSample = { moved: number; lockstep: number };

export function panSampleOk(sample: PanSample, dx: number, lockstepSlack = 4): boolean {
  return panTravelOk(sample.moved, dx)
    && Number.isFinite(sample.lockstep)
    && Math.abs(sample.lockstep - sample.moved) < lockstepSlack;
}

export function panSampleSame(prev: PanSample, next: PanSample): boolean {
  return Math.round(prev.moved) === Math.round(next.moved)
    && Math.round(prev.lockstep) === Math.round(next.lockstep);
}
