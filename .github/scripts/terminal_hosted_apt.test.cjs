"use strict";

// Exercise the pinned dependency consumer. Only APT is substituted: no package
// installation, network request, application server or browser is launched.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const terminal = path.resolve(__dirname, "../../terminal");
const cli = fs.realpathSync(path.join(terminal, "node_modules/.bin/playwright"));

for (const [name, output, aptExit, expected] of [
  ["complete dependencies", "0 upgraded, 0 newly installed, 0 to remove.\n", 0, 0],
  ["missing FreeFont", "Inst fonts-freefont-ttf (20211204 Ubuntu:24.04/noble [all])\n", 0, 1],
  ["missing Japanese font", "Inst fonts-ipafont-gothic (00303 Ubuntu:24.04/noble [all])\n", 0, 1],
  ["APT failure", "APT transport failed\n", 100, 1],
]) {
  test(`real Playwright dependency dry-run: ${name}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-apt-contract-"));
    try {
      fs.writeFileSync(path.join(root, "apt-get"),
        "#!/bin/sh\n[ \"$1 $2 $3\" = 'install -s --no-install-recommends' ] || exit 98\n" +
        "for required in fonts-freefont-ttf fonts-ipafont-gothic libnss3; do\n" +
        "  case \" $* \" in *\" $required \"*) ;; *) exit 97 ;; esac\ndone\n" +
        "printf '%s' \"$APT_TEST_OUTPUT\"\nexit \"$APT_TEST_EXIT\"\n", { mode: 0o755 });
      const result = spawnSync(process.execPath, [cli, "install-deps", "--dry-run", "chromium"], {
        cwd: terminal, encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: root + path.delimiter + process.env.PATH,
          APT_TEST_OUTPUT: output, APT_TEST_EXIT: String(aptExit), LC_ALL: "C" },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      if (output.startsWith("Inst ")) {
        assert.match(result.stdout + result.stderr, /Missing system dependencies/);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
