#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- One bounded source-fixture diagnostic. */
"use strict";
// Reuses the exact canonical owned lifecycle/case. Never emits a six-case FIXTURE.
require("./capture_b_f11_10_analysis_theses_entry.cjs").diagnoseMobileZh().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
