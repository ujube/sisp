const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { scanProject } = require("../src/scan-project");

const fixturesDir = path.join(__dirname, "fixtures");

test("marks a low-risk project as SAFE", () => {
  const report = scanProject(path.join(fixturesDir, "safe-project"));

  assert.equal(report.verdict, "SAFE");
  assert.equal(report.score, 0);
  assert.deepEqual(report.reasons, []);
});

test("marks lifecycle scripts as REVIEW", () => {
  const report = scanProject(path.join(fixturesDir, "review-project"));

  assert.equal(report.verdict, "REVIEW");
  assert.equal(report.score, 0.35);
  assert.match(report.reasons[0].message, /Lifecycle scripts found/);
});

test("marks stacked risky signals as BLOCK", () => {
  const report = scanProject(path.join(fixturesDir, "block-project"));

  assert.equal(report.verdict, "BLOCK");
  assert.ok(report.score >= 0.75);
  assert.ok(report.reasons.some((reason) => reason.code === "suspicious-lifecycle-script"));
  assert.ok(report.reasons.some((reason) => reason.code === "non-standard-source-risks"));
});

test("marks installed dependency install scripts as REVIEW", () => {
  const report = scanProject(path.join(fixturesDir, "installed-risk-project"));

  assert.equal(report.verdict, "REVIEW");
  assert.equal(report.effectiveScanMode, "after");
  assert.ok(report.reasons.some((reason) => reason.code === "dependency-lifecycle-scripts"));
  assert.ok(report.reasons.some((reason) => reason.code === "dependency-native-build-indicators"));
  assert.equal(report.findings.installedPackagesScanned, 1);
});

test("before mode skips installed dependency inspection", () => {
  const report = scanProject(path.join(fixturesDir, "installed-risk-project"), { mode: "before" });

  assert.equal(report.verdict, "SAFE");
  assert.equal(report.effectiveScanMode, "before");
  assert.equal(report.findings.installedPackagesScanned, 0);
  assert.deepEqual(report.reasons, []);
});

test("marks lockfile install scripts and source risks without node_modules", () => {
  const report = scanProject(path.join(fixturesDir, "lockfile-risk-project"));

  assert.equal(report.verdict, "REVIEW");
  assert.ok(report.reasons.some((reason) => reason.code === "lockfile-install-scripts"));
  assert.ok(report.reasons.some((reason) => reason.code === "non-standard-source-risks"));
  assert.equal(report.findings.lockfilePackagesScanned, 2);
  assert.equal(report.findings.lockfileInstallScripts.length, 1);
  assert.equal(report.findings.lockfileSourceRisks.length, 1);
});

test("after mode adds a note when node_modules is missing", () => {
  const report = scanProject(path.join(fixturesDir, "safe-project"), { mode: "after" });

  assert.equal(report.effectiveScanMode, "after");
  assert.ok(report.notes.some((note) => note.includes("node_modules was not found")));
});
