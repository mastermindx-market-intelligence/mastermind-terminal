# Terminal W2B-A Exact-Target Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the incumbent Terminal deploy owner require a caller-supplied accepted full SHA and a `CLEAN` W2A source receipt before any fetch, reset, clean, build, or source projection.

**Architecture:** Keep `ops/terminal-build.sh` as the sole lifecycle owner. Add sourceable shell helpers for target validation, W2A artifact selection, safe receipt-directory preparation, preflight execution, and post-fetch target admission; the executable body calls those helpers in fail-closed order and resets only to the admitted SHA. The first W2B release can execute the exact protected `ops/` artifact from a temporary directory; later runs fall back to the currently deployed canonical checkout's `ops/` artifacts.

**Tech Stack:** Bash, Git, Python 3 release-preflight CLI, pytest.

**Spec:** Terminal issue #483 comments `5720927600`, `5720960214`, and `5720978884`; protected baseline `75c22083249e7a1529be3d6baf819b9ad5ea509f`.

## Global Constraints

- Preserve `ops/terminal-build.sh` as the only deploy lifecycle owner; no parallel deployer, queue, receipt authority, or service.
- `DEPLOY.md` is excluded because draft PR #582 currently owns a separate hunk there.
- Require exactly `--target-sha <40 lower-case hex>`; no environment fallback and no moving-ref inference.
- Run the W2A preflight against the currently deployed canonical checkout before `git fetch`, `reset --hard`, `clean`, dependency installation, build, source sync, service action, or runtime-data action.
- Receipt-directory creation is the only admitted pre-fetch write; create and verify root-owned `0750` parent and leaf directories.
- Select the preflight script and policy as one pair from the executing owner artifact first, otherwise from the currently deployed canonical checkout; never mix directories or follow symlink files.
- After preflight, fetch `origin/master`, resolve the requested full SHA exactly, require it to be contained by `refs/remotes/origin/master`, then reset/clean to that SHA only.
- This slice does not change dependency installation, deploy production, restart services, mutate runtime data, or claim build/deploy/rollback/browser/drift proof.

---

### Task 1: Discriminating deploy-admission contract

**Files:**
- Create: `tests/test_terminal_build_admission.py`
- Read: `ops/terminal-build.sh`

**Interfaces:**
- Consumes: sourceable `ops/terminal-build.sh` library seam.
- Produces: executable contract for `validate_target_sha`, `select_preflight_artifacts`, `run_release_preflight`, `admit_target_sha`, and main-body ordering.

- [x] **Step 1: Write failing CLI and target-validation tests**

Create tests that source the script and assert:

```python
assert run_gen('validate_target_sha "' + VALID_SHA + '"').returncode == 0
for invalid in ("master", "ABC...", "abc", "0" * 39, "0" * 41):
    assert run_gen(f'validate_target_sha "{invalid}"').returncode != 0
```

Execute the script with no arguments and malformed `--target-sha`; both must exit `64` before emitting a Node/Git deploy log.

- [x] **Step 2: Run target tests and verify RED**

Run:

```bash
python3 -m pytest -q tests/test_terminal_build_admission.py -k 'target or cli'
```

Expected: failures because the target helpers and required CLI do not exist.

- [x] **Step 3: Write failing artifact-selection tests**

Create temporary owner/canonical `ops` directories. Assert a complete owner pair wins, an incomplete owner pair falls back to a complete canonical pair without mixing, and symlink script/policy candidates are rejected.

- [x] **Step 4: Run selection tests and verify RED**

Run:

```bash
python3 -m pytest -q tests/test_terminal_build_admission.py -k artifact
```

Expected: failures because `select_preflight_artifacts` does not exist.

- [x] **Step 5: Write failing exact-admission and order tests**

Create a temporary Git repository with an accepted branch commit and an unaccepted side commit. Assert `admit_target_sha` accepts the former and rejects the latter. Statically assert the executable body calls `run_release_preflight` before fetch/reset/clean/build, resets to `"$TARGET_SHA"`, and never resets to `origin/$BRANCH`.

- [x] **Step 6: Run admission/order tests and verify RED**

Run:

```bash
python3 -m pytest -q tests/test_terminal_build_admission.py -k 'admit or order or reset'
```

Expected: failures because the helpers/order are absent and the current script resets to the moving branch.

### Task 2: Minimal fail-closed deploy-owner implementation

**Files:**
- Modify: `ops/terminal-build.sh`
- Test: `tests/test_terminal_build_admission.py`
- Regression: `tests/test_terminal_build_rollback.py`

**Interfaces:**
- Produces: `validate_target_sha SHA -> 0|64`; `select_preflight_artifacts OWNER_OPS CANONICAL_OPS -> globals PREFLIGHT_SCRIPT/PREFLIGHT_POLICY`; `prepare_preflight_receipt_dir DIR -> 0|nonzero`; `run_release_preflight SCRIPT POLICY CANONICAL_REPO RECEIPT_DIR -> globals PREFLIGHT_*`; `admit_target_sha REPO SHA ACCEPTED_REF -> 0|nonzero`.
- Main CLI: `bash terminal-build.sh --target-sha <full-lowercase-sha>`.

- [x] **Step 1: Implement target validation and CLI**

Add:

```bash
validate_target_sha(){
  local value=${1:-}
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || {
    log "FATAL: --target-sha must be one full lower-case 40-hex commit SHA"
    return 64
  }
}
```

After the sourced guard, require exactly two arguments with `$1 == --target-sha`, assign `TARGET_SHA=$2`, and validate before Node/Git access.

- [x] **Step 2: Implement paired artifact selection**

For each supplied directory in order, accept only when both `terminal_release_preflight.py` and `terminal_source_audit.production.json` are real regular non-symlink files. Set both globals from that same directory. Return nonzero if no complete pair exists.

- [x] **Step 3: Implement safe preflight execution**

Use `install -d -o root -g root -m 0750` for `/var/lib/mastermind-terminal` and its `release-preflight` leaf, reject symlinks, and verify owner/group/mode. Run the selected Python tool with `PYTHONDONTWRITEBYTECODE=1`, `umask 027`, absolute canonical/policy/receipt paths, captured stdout+stderr, and propagate every nonzero code. Parse the successful JSON summary with Python and require `result == CLEAN`; bind/log accepted SHA, receipt path, and receipt IDs.

- [x] **Step 4: Implement exact target admission**

After the successful preflight, fetch `origin/master`. Resolve `SHA^{commit}`, require exact equality with the requested SHA, and require `git merge-base --is-ancestor SHA refs/remotes/origin/master`. Reset/clean to `SHA`; assert resulting HEAD equals `SHA`.

- [x] **Step 5: Run focused tests to verify GREEN**

Run:

```bash
python3 -m pytest -q tests/test_terminal_build_admission.py tests/test_terminal_build_rollback.py
bash -n ops/terminal-build.sh
```

Expected: all pass.

- [ ] **Step 6: Commit the implementation slice**

```bash
git add ops/terminal-build.sh tests/test_terminal_build_admission.py docs/superpowers/plans/2026-09-17-terminal-w2b-a-exact-target-preflight.md
git commit -m "feat(ops): gate Terminal deploy on exact target preflight"
```

### Task 3: Operator contract and release verification

**Files:**
- Modify: `ops/TERMINAL_RELEASE_PREFLIGHT.md`
- Modify: `ops/README.md`
- Test: focused W2A/W2B Python suites.

**Interfaces:**
- Documents the new deploy-owner consumer without claiming build/deploy/rollback/browser/drift completion.

- [ ] **Step 1: Document the exact CLI and first-adoption path**

State that W2B-A requires `--target-sha`, runs W2A before source mutation, uses adjacent exact-artifact ops files for first adoption and canonical-checkout ops files thereafter, and only admits a target contained by freshly fetched protected master.

- [ ] **Step 2: Run full focused verification**

Run:

```bash
python3 -m pytest -q \
  tests/test_terminal_build_admission.py \
  tests/test_terminal_build_rollback.py \
  tests/test_terminal_release_preflight.py \
  tests/test_terminal_source_audit.py \
  tests/test_terminal_source_audit_policy_contracts.py \
  tests/test_terminal_source_audit_cli_failures.py \
  tests/test_terminal_source_audit_trust_boundary.py
bash -n ops/terminal-build.sh
python3 -m compileall -q ops tests/test_terminal_build_admission.py tests/test_terminal_build_rollback.py
```

Expected: all pass, no warnings beyond accepted repository baseline.

- [ ] **Step 3: Mutation checks**

Mutate the source in isolated temporary copies to remove target validation, move preflight after fetch, reset to `origin/master`, allow an unaccepted target, mix artifact directories, and ignore a preflight failure. Each corresponding test must fail.

- [ ] **Step 4: Commit docs/test refinements**

```bash
git add ops/TERMINAL_RELEASE_PREFLIGHT.md ops/README.md tests/test_terminal_build_admission.py
git commit -m "docs(ops): define exact-target preflight deploy gate"
```

- [ ] **Step 5: Push, open PR, and complete review/CI release gates**

Push the one W2B-A branch, open a PR against protected master referencing #483, consume natural required CI without rerun-to-green, obtain one exact-head independent security/operations review, and merge only with zero unresolved BLOCKER/MAJOR. Do not deploy this incomplete W2B wave to production.
