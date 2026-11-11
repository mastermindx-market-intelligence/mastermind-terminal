import { describe, expect, it } from "vitest";
import { fixtureFor } from "@/lib/flowSource";
import { parseOptionsTickerCatalog } from "@/lib/optionsTickerCatalog";

describe("fixture options ticker catalog", () => {
  it("carries available, quiet, and waiting roots for the real Tickers-tab journey", async () => {
    const meta = await fixtureFor("meta");
    const catalog = parseOptionsTickerCatalog(meta);
    const byRoot = new Map(catalog.map((entry) => [entry.root, entry]));
    const envelope = (meta as { ticker_catalog: {
      supported_n: number;
      available_n: number;
      quiet_n: number;
      waiting_n: number;
    } }).ticker_catalog;

    expect(catalog.length).toBeGreaterThanOrEqual(30);
    expect(envelope.supported_n).toBe(catalog.length);
    expect(envelope.available_n).toBe(catalog.filter((entry) => entry.status === "available").length);
    expect(envelope.quiet_n).toBe(catalog.filter((entry) => entry.status === "quiet").length);
    expect(envelope.waiting_n).toBe(catalog.filter((entry) => entry.status === "waiting").length);
    expect(byRoot.get("SPY")?.status).toBe("available");
    expect(byRoot.get("AMD")?.status).toBe("quiet");
    expect(byRoot.get("TLT")?.status).toBe("waiting");
  });

  it("never marks a fixture root available without a renderable ticker artifact", async () => {
    const meta = await fixtureFor("meta");
    const catalog = parseOptionsTickerCatalog(meta);

    for (const entry of catalog.filter((row) => row.status === "available")) {
      const ticker = await fixtureFor(`ticker:${entry.root}`);
      expect((ticker as { day?: unknown }).day, entry.root).toBeTruthy();
    }
  });
});
