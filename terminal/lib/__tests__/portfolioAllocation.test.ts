import { describe, it, expect } from "vitest";
import { exampleAllocation, marketAllocation, distanceFromHigh, SAMPLE_LOTS } from "../portfolioAllocation";
const p = (ticker: string, shares: number | null, status: "open" | "closed" = "open") => ({ticker, shares, status});
const q = (last: number, currency: string) => ({last, currency});

describe("Portfolio allocation", () => {
  it("shows the full illustrative cohort until all four observations are comparable", () => {
    const example = exampleAllocation({ AAPL: q(250, "USD") });
    expect(example.observed).toBe(false);
    expect(example.allocation.total).toBe(10000);
    expect(example.allocation.rows.map(r => r.weight)).toEqual([40, 30, 20, 10]);
    const priced = exampleAllocation(Object.fromEntries(SAMPLE_LOTS.map(row => [row.ticker, q(100, "USD")])));
    expect(priced.observed).toBe(true);
    expect(priced.allocation.total).toBe(6000);
  });
  it("groups duplicate lots and excludes closed lots", () => {
    const result = marketAllocation([p("AA", 1.5),p("AA", 2.5),p("BB", 2),p("CC", 1, "closed")], { AA: q(5,"USD") }, {BB: q(10,"USD")});
    expect(result?.total).toBe(40);
    expect(result?.rows.map(row => row.weight)).toEqual([50, 50]);
  });
  it("withholds percentages on incomplete, negative or mixed-currency books", () => {
    for (const invalid of [null, -1, Infinity]) expect(marketAllocation([p("A", invalid)], { A: q(2, "USD") }, {})).toBeNull();
    expect(marketAllocation([p("A", 10),p("B", 1)], {A:q(1,"USD"), B:q(2,"HKD")}, {})).toBeNull();
    expect(marketAllocation([p("A", 10)], {A: { last: 10 }}, {A: q(5,"USD")})).toBeNull();
  });
  it("combines an institution-valued contract with a market-priced manual lot", () => {
    const broker = { ...p("OPTION", 1), brokerage: {account:"Brokerage",name:"Contract",symbol:"OPTION",type:"derivative",price:20,
      value:2000,currency:"USD",asOf:"2025-11-03",syncedAt:"2025-11-04T00:00:00Z"} };
    const book=marketAllocation([broker,p("STOCK",10)],{STOCK:q(200,"USD"),OPTION:q(22,"USD")},{});
    expect(book?.total).toBe(4000);expect(book?.rows.map(row=>row.weight)).toEqual([50,50]);
  });
  it("measures close against a positive 52-week high", () => {
    expect(distanceFromHigh(45,50)).toBeCloseTo(-10);
    expect(distanceFromHigh(45,0)).toBeNull();
  });
});
