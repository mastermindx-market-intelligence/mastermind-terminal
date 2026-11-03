# ASC Pine build evidence refresh — November 3, 2026

PR #1233 adds the reviewed Pine source digest to `next.config.ts`. Its original CI run 41537161605 failed exactly two visual source locks. This repair retains the accepted seven product/test files at 595dfe471796705cbcd3843506f7d3443a1ce209 and all historical captures. It updates only the next.config.ts entry in each evidence document and appends the new immutable evidence references.

The source hash is 7713c63146e5821e4d2c5df8e0495e7b1af76344c2299879150065fbeb1098b1. Both new operations carry the current recursive source snapshot, including the unchanged visualEvidenceReporter.cjs hash 3d839b5f1c988f3edd31900865a7ff1f04852e05f8dfbeed58c6623332c44b10.

- `asc1233-pl6-20261103`: 24 actual EN/ZH desktop/mobile layout captures. The contract requires 20 of these; the four additional Discover captures do not inflate required coverage.
- `asc1233-vi-ci-20261103`: 30 actual chart-context cases across desktop, tablet and mobile, with the original assertions and zero retries. This uses the repository's existing CI profile (60-second whole-test budget).
- `asc1233-current-20261103.composition.json`: explicit selection of the 20 required layout cases plus all 30 required chart cases. Its existing reader validates source/profile, actual execution reports, membership and image hashes.
- The original affected evidence-lock suites pass 14 tests. The accepted Pine export/host checks and TypeScript check remain unchanged; they were not rerun as a broad campaign.

The first local chart capture exhausted the default 30-second budget in the mobile restore/reload journey. Its failed run, partial artifacts, trace and log remain retained and unaccepted. Optional undefined fields in Playwright's timeout error also exposed a reporter serialization defect. That distinct repair is prepared outside this candidate and has NOT been applied: changing the reporter here would invalidate the captured source snapshot. No failed execution is reconstructed as successful evidence, and no historical screenshot or source hash inside an immutable operation is rewritten.

These are synthetic fixture UI captures only. They do not acquire an ASC reference, qualify empirical calibration, activate a feature, deploy the application or authorize merging this Draft.
