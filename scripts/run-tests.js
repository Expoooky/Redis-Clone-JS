"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const testDir = path.join(projectRoot, "test");

const files = fs.readdirSync(testDir)
  .filter((n) => n.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const file of files) {
  const full = path.join(testDir, file);
  console.log(`== Running ${file}`);
  const res = spawnSync(process.execPath, ["--test", "--test-timeout=5000", full], {
    stdio: "inherit",
    env: { ...process.env, REDISJS_MONITOR_PORT: "0" }
  });
  if (res.status !== 0) failed += 1;
}

process.exit(failed ? 1 : 0);


