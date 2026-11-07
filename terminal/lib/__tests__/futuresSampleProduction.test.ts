import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import SamplePage from "../../app/dev/futures-sample/page";
import config from "../../next.config";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("TEST_NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/futuresSampleLoader", () => { throw new Error("REAL_SAMPLE_LOADER_MUST_NOT_RUN_IN_PRODUCTION"); });
afterEach(() => vi.unstubAllEnvs());
describe("internal historical sample is not a production feature", () => {
  it("returns not-found before loading the private sample", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(SamplePage()).rejects.toThrow("TEST_NEXT_NOT_FOUND");
  });
  it("production file traces exclude all local sample bytes", () => {
    const excludes = config.outputFileTracingExcludes?.["/*"] ?? [];
    expect(excludes).toContain(".local-futures/**/*");
    expect(excludes).toContain("**/.local-futures/**/*");
    expect(excludes.some(pattern => pattern.startsWith("../"))).toBe(false);
    expect(config.turbopack?.root).toBe(path.resolve(__dirname, "../.."));
  });
  it("the server loader has no user-supplied path or API key", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../futuresSampleLoader.ts"), "utf8");
    expect(source).toContain("loadFuturesSampleView()");
    expect(source).not.toMatch(/API_KEY|searchParams|request\.url|fetch\(/);
    expect(source).toContain("createHash(\"sha256\")");
  });
});
