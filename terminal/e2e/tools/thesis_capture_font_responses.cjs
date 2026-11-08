/* eslint-disable @typescript-eslint/no-require-imports -- The Next font mock and incumbent capture tools use CommonJS. */
"use strict";
// Fixed local-only Next16.2.9 test seam; no parent supplied mock module.
module.exports = require("./thesis_capture_fonts.cjs").responseMap(require("node:path").resolve(__dirname, "../.."));
