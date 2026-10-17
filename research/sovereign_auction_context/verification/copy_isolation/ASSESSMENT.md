# Terminal shared-language evidence repair

At source `9292c7ca1e19e07ee70514b9a3cfb598ba5dd5b9`, broad CI job 113599240786 reported the changed shared i18n hash in seven annotated evidence suites. The read-only full-log review identified an eighth, personalAccuracyEvidence, for nine failing assertions overall. Root retained the exact 12 annotations, independently included all eight suites, and reproduced their successful source-bound rerun after restoring the baseline. The root gh-run full-log command reported the overall workflow still running; that read limitation is retained, and no full-log copy is claimed.

All 55 auction translation tuples now live in a feature-owned module subscribing to the existing useLang context. The component changes only its translator import; auth, effects, model, upstream, formatting and mount remain identical. Global i18n is byte-for-byte baseline SHA-256 858306597ebbfc2d912cefc997ad88e4805cafb08794b5cd4d3dfeacb109371f. No foreign evidence manifest was changed or recaptured.

Root native verification passed 129 tests: 42 auction, 47 across the eight evidence suites, and 40 plain-language controls. The flagged Bad.tsx output was reproduced under the explicit negative-fixture receipt while both control suites passed; it is not a production component failure. TypeScript and changed-leaf/copy-module/E2E lint passed. The actual 18-case browser run03 passed with zero skipped, flaky, unexpected or top-level errors.

The final manifest and verification/copy_isolation receipts bind the correction. The prior run02 remains historical. Current repository CI remains a separate exact-head gate; this repair does not authorize merge, deployment or any risk-decision use.
