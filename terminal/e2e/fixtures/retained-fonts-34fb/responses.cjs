"use strict";
const fs = require("node:fs");
const path = require("node:path");
const css = name => fs.readFileSync(path.join(__dirname, name), "utf8").replaceAll("FIXTURE_ASSET_ROOT", __dirname);
module.exports = {
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap": css("inter.css"),
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap": css("jetbrains-mono.css"),
};
