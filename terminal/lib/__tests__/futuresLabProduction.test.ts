import { afterEach, describe, expect, it, vi } from "vitest";
import FuturesLabPage from "../../app/dev/futures/page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("TEST_NEXT_NOT_FOUND"); } }));
// The lazy client import must not execute under the production branch.
vi.mock("@/components/futures/FuturesResearchLab", () => {
  throw new Error("SYNTHETIC_LAB_MUST_NOT_LOAD_IN_PRODUCTION");
});
afterEach(() => vi.unstubAllEnvs());
describe("futures synthetic laboratory production boundary", () => {
  it("returns not-found before importing the development consumer", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(FuturesLabPage()).rejects.toThrow("TEST_NEXT_NOT_FOUND");
  });
});
