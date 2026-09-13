import { beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureDb,
  fixtureStore,
  fixtureUserId,
  resetFixtureStores,
} from "@/lib/watchlistsFixtureDb";

// Heal round h3 REQUIRED 6: the upsert branch used to push the already-stored row onto `accepted`
// and then `this.rows.push(...accepted)`, so a clashing upsert left two entries for one ticker.

const KEY = "targets-upsert-clash";
const owner = fixtureUserId(KEY);
const db = () => createFixtureDb(KEY);

beforeEach(() => resetFixtureStores());

describe("fixture portfolio_targets upsert", () => {
  it("a clashing upsert stores one row, not two", async () => {
    const first = await db().from("portfolio_targets").upsert({
      user_id: owner,
      ticker: "AAA",
      target_weight_pct: 40,
      band_pct: 5,
    });
    expect(first.error).toBeNull();
    expect(fixtureStore(KEY).targets).toHaveLength(1);

    const second = await db().from("portfolio_targets").upsert({
      user_id: owner,
      ticker: "AAA",
      target_weight_pct: 55,
      band_pct: 8,
    });
    expect(second.error).toBeNull();
    const rows = fixtureStore(KEY).targets;
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe("AAA");
    expect(rows[0].target_weight_pct).toBe(55);
    expect(rows[0].band_pct).toBe(8);
  });
});
