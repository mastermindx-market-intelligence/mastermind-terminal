import { isValidRoot } from "@/lib/flowRoot";

/** Only a single valid option root may cross the board/guide boundary. */
export function levelsSymbol(params: Pick<URLSearchParams, "getAll"> | null): string | null {
  const values = params?.getAll("symbol");
  if (values?.length !== 1) return null;
  const symbol = values[0].trim().toUpperCase();
  return isValidRoot(symbol) ? symbol : null;
}
