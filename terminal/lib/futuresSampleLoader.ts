import "server-only";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseFuturesSampleView } from "./futuresSampleView";

/** Local development diagnostics only. No path, URL, credential or user parameter. */
export async function loadFuturesSampleView() {
  if (process.env.NODE_ENV === "production") return null;
  const folder = path.resolve(process.cwd(), "..", ".local-futures");
  const file = path.join(folder, "browser-canary.json");
  const receiptFile = path.join(folder, "browser-canary-receipt.json");
  try {
    const [dataStat, receiptStat] = await Promise.all([stat(file), stat(receiptFile)]);
    if (!dataStat.isFile() || dataStat.size > 4 * 1024 * 1024 || !receiptStat.isFile() || receiptStat.size > 65536) return null;
    const [data, receiptText] = await Promise.all([readFile(file), readFile(receiptFile, "utf8")]);
    if (data.byteLength > 4 * 1024 * 1024 || receiptText.length > 65536) return null;
    const receipt = JSON.parse(receiptText);
    if (receipt.schema !== "futures.private_view_receipt/v1" || receipt.live !== false || receipt.synthetic !== false ||
        receipt.bytes !== data.byteLength || receipt.sha256 !== createHash("sha256").update(data).digest("hex")) return null;
    return parseFuturesSampleView(JSON.parse(data.toString("utf8")));
  } catch { return null; }
}
