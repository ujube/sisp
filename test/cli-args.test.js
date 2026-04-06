const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../src/cli");

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
