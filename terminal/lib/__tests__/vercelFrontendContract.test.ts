import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Vitest is the required Terminal CI suite. Keep the complete low-level Node
// contract runner independently runnable without changing the shared CI matrix.
// The runner transpiles the real Next config using pinned TypeScript on Node 20.
test("Vercel frontend routing, identity, and backend custody are fail-closed", () => {
  const result = spawnSync(
    process.execPath,
    ["--test", path.join(root, "scripts/vercel-frontend-contract.test.mjs")],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, (result.stdout + result.stderr).slice(-5000)).toBe(0);
}, 35_000);
