import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import LegacyShellPage, { generateMetadata } from "@/app/(shell)/[...legacyPath]/page";

const props = (href: string) => ({ params: Promise.resolve({ legacyPath: href.slice(1).split("/") }) });
const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
beforeEach(() => { vi.stubEnv("MMX_SHARED_SHELL", "1"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("Shared Shell route admission preserves HTTP status before streaming", () => {
  it.each(["", "0", "true", "01"])("does not admit a legacy path with flag %s", async (flag) => {
    vi.stubEnv("MMX_SHARED_SHELL", flag);
    await expect(LegacyShellPage(props("/macro.html"))).rejects.toMatchObject(notFound);
    await expect(generateMetadata(props("/macro.html"))).rejects.toMatchObject(notFound);
  });

  it.each(["/unknown-shared-shell-page.html", "/private/secrets.html", "/api/not-a-page"])(
    "rejects unknown path %s even with the beta flag enabled", async (href) => {
      await expect(LegacyShellPage(props(href))).rejects.toMatchObject(notFound);
      await expect(generateMetadata(props(href))).rejects.toMatchObject(notFound);
    },
  );

  it("admits a catalogued page without creating a second frame owner", async () => {
    expect(await LegacyShellPage(props("/macro.html"))).toBeNull();
    expect(await generateMetadata(props("/macro.html"))).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("has no streaming boundary above the finite route gate", () => {
    const app = path.resolve(__dirname, "../../app");
    const chain = [app, path.join(app, "(shell)"), path.join(app, "(shell)", "[...legacyPath]")];
    for (const dir of chain) {
      expect(existsSync(path.join(dir, "loading.tsx")), dir + " must preserve the gate's 404").toBe(false);
      const layout = path.join(dir, "layout.tsx");
      if (existsSync(layout)) expect(readFileSync(layout, "utf8")).not.toMatch(/<Suspense\b/);
    }
  });
});
