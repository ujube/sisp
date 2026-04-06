#!/usr/bin/env node

const { runCli } = require("../src/cli");

try {
  const exitCode = runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  });

  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(`SISP failed: ${error.message}\n`);
  process.exitCode = 1;
}
