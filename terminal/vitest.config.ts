import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Only include files using the vitest describe/it API.
    // The .mjs files in components/__tests__/ and tests/ use a custom console runner
    // and are not vitest suites — exclude them to avoid "no test suite found" failures.
    include: ["lib/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` ships a module that THROWS unless the bundler applies the `react-server`
      // export condition. That throw is exactly the protection we want from `next build`, but
      // vitest resolves plain Node conditions, so without this alias every suite that
      // transitively reaches lib/flowScore.ts (14 of them, via lib/flowSource.ts) would die on
      // import. Node IS a server, so satisfying the marker here is honest rather than a bypass —
      // and the build-time fence is untouched.
      "server-only": path.resolve(__dirname, "lib/__tests__/stubs/serverOnly.ts"),
    },
  },
});
