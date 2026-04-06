const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { formatReport } = require("../src/cli");
const { scanProject } = require("../src/scan-project");

const fixturesDir = path.join(__dirname, "fixtures");

test("formats review results in plain English", () => {
  const report = scanProject(path.join(fixturesDir, "lockfile-risk-project"));
  const output = formatReport(report);

  assert.match(output, /Scan mode: before install \(auto\)/);
  assert.match(output, /Decision: Review this project before you continue/);
  assert.match(output, /What this means:/);
  assert.match(output, /What SISP found:/);
  assert.match(output, /Packages in the lockfile are marked to run install scripts/);
  assert.match(output, /What to do next:/);
});

test("formats safe results with clear next steps", () => {
  const report = scanProject(path.join(fixturesDir, "safe-project"));
  const output = formatReport(report);

  assert.match(output, /Decision: Safe to continue/);
  assert.match(output, /No strong install-time risk signals were detected/);
  assert.match(output, /You can continue, but still review dependency updates/);
});

test("formats after mode note when node_modules is missing", () => {
  const report = scanProject(path.join(fixturesDir, "safe-project"), { mode: "after" });
  const output = formatReport(report);

  assert.match(output, /Scan mode: after install/);
  assert.match(output, /After-install mode was requested, but node_modules was not found/);
});
