// Conservative same-symbol/timeframe 24H history retention guard.
// This tests severe nonempty bar-count contraction, NOT market-data completeness:
// a normal rolling/capped prefix, a small revision, or a source-confirmed empty
// window is still eligible for the existing correction/cancellation flow.
export function hasUnexpectedHistoryContraction(previousCount: number, nextCount: number): boolean {
  return Number.isSafeInteger(previousCount) && Number.isSafeInteger(nextCount)
    && previousCount >= 100 && nextCount > 0
    && previousCount - nextCount >= 60 && nextCount * 2 < previousCount;
}
