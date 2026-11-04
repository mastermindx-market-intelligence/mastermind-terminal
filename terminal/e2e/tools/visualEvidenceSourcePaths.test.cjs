"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const script = path.join(__dirname, "visualEvidenceFs.py");

function fixture(run) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "visual-source-path-")));
  for (const dir of ["terminal/e2e", "terminal/app/api", "terminal/components", "terminal/lib"])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function request(root, extra) {
  const result = spawnSync("/usr/bin/python3", ["-I", script], {
    input: JSON.stringify({ root, relative: "", action: "snapshot", paths: [], ...extra }) + "\n", encoding: "utf8",
  });
  return JSON.parse(result.stdout);
}
function source(root, relative, bytes = "export const publicFixture = true;\n") {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), bytes);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("readonly snapshot hashes the literal Next private-folder escape without decoding or aliasing", () => fixture(root => {
  const escaped = "terminal/app/api/%5F_e2e__/supabase/route.ts";
  const ordinary = "terminal/app/api/__e2e__/supabase/route.ts";
  const a = source(root, escaped), b = source(root, ordinary, "export const other = true;\n");
  const result = request(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { [escaped]: a, [ordinary]: b });
  assert.notEqual(a, b);
}));

test("generic artifact reads and writes reject that source path, including an untrusted source flag", () => fixture(root => {
  const relative = "terminal/app/api/%5F_e2e__/supabase";
  source(root, relative + "/route.ts");
  for (const action of ["read", "write", "directory"])
    assert.equal(request(root, { relative, action, source: true, name: "route.ts", maximum: 1024, bytes: Buffer.from("changed").toString("base64") }).code, "UNSAFE_PATH");
  assert.equal(fs.readFileSync(path.join(root, relative, "route.ts"), "utf8"), "export const publicFixture = true;\n");
}));

for (const name of ["%5f_e2e__", "%255F_e2e__", "%2e%2e", "%2F", "%5C"])
  test(`snapshot refuses other percent encodings: ${name}`, () => fixture(root => {
    source(root, `terminal/app/api/${name}/route.ts`);
    assert.equal(request(root).code, "UNSAFE_PATH");
  }));

test("the literal escape is not admitted in another source namespace or as a leaf", () => {
  fixture(root => {
    source(root, "terminal/lib/%5F_e2e__/route.ts");
    assert.equal(request(root).code, "UNSAFE_PATH");
  });
  fixture(root => {
    source(root, "terminal/app/api/%5F_e2e__");
    assert.equal(request(root, { paths: ["terminal/app/api/%5F_e2e__"] }).code, "UNSAFE_PATH");
  });
});

test("source snapshot still rejects symlink and hardlink substitutions", () => {
  fixture(root => {
    const target = path.join(root, "outside"); fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(root, "terminal/app/api/%5F_e2e__"));
    assert.equal(request(root).code, "SOURCE_SYMLINK");
  });
  fixture(root => {
    const relative = "terminal/app/api/%5F_e2e__/route.ts";
    source(root, relative);
    fs.linkSync(path.join(root, relative), path.join(root, "linked-copy"));
    assert.equal(request(root).ok, false);
  });
});
