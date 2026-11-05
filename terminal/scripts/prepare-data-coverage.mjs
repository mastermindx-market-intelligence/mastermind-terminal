// The host-owned nightly publisher writes fresh data/coverage.json on the VPS.
// Vercel is an immutable frontend: do not generate a counterfeit index from the
// bounded tracked fixtures. next.config.ts refuses Vercel unless the audited
// independent market-data origin is configured and rewrites /data before files.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.VERCEL === "1") {
  process.stdout.write("[coverage] Vercel: real data remains at the approved upstream; no fixture index generated\n");
  process.exit(0);
}
const publisher = fileURLToPath(new URL("../../scripts/build_data_coverage.py", import.meta.url));
const result = spawnSync("python3", [publisher], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`[coverage] Python publisher failed to start: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
