const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, parseCliArgs } = require("../src/cli");
const { parseInstallArgs } = require("../src/install-command");

test("parses before mode keyword", () => {
  const options = parseArgs(["before", "./demo"]);

  assert.equal(options.scanMode, "before");
  assert.equal(options.targetPath, "./demo");
});

test("parses after mode flag", () => {
  const options = parseArgs(["--after", "--json", "./demo"]);

  assert.equal(options.scanMode, "after");
  assert.equal(options.json, true);
  assert.equal(options.targetPath, "./demo");
});

test("rejects conflicting scan mode flags", () => {
  assert.throws(() => parseArgs(["--before", "--after"]), /Conflicting scan modes/);
});

test("parses install subcommand", () => {
  const options = parseCliArgs(["install", "demo-package"]);

  assert.equal(options.command, "install");
  assert.deepEqual(options.packageSpecs, ["demo-package"]);
});

test("parses install with no explicit package specs", () => {
  const options = parseCliArgs(["install", "--dry-run"]);

  assert.equal(options.command, "install");
  assert.equal(options.dryRun, true);
  assert.deepEqual(options.packageSpecs, []);
});

test("parses install dry-run and forwarded args", () => {
  const options = parseInstallArgs(["demo-package", "--dry-run", "--", "--save-dev"]);

  assert.equal(options.dryRun, true);
  assert.deepEqual(options.packageSpecs, ["demo-package"]);
  assert.deepEqual(options.npmArgs, ["--save-dev"]);
});

test("parses scan subcommand", () => {
  const options = parseCliArgs(["scan", "after", "./demo"]);

  assert.equal(options.command, "scan");
  assert.equal(options.scanMode, "after");
  assert.equal(options.targetPath, "./demo");
});
