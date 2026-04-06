const path = require("path");
const { scanProject } = require("./scan-project");
const {
  inspectRequestedPackages,
  parseInstallArgs,
  runNpmInstall
} = require("./install-command");

function runCli(argv, { cwd, stdout, stderr, execFileSync, spawnSync }) {
  const options = parseCliArgs(argv);

  if (options.help) {
    stdout.write(`${buildHelp()}\n`);
    return 0;
  }

  try {
    if (options.command === "install") {
      return runInstallWorkflow(options, { cwd, stdout, stderr, execFileSync, spawnSync });
    }

    const targetPath = path.resolve(cwd, options.targetPath || ".");
    const report = scanProject(targetPath, { mode: options.scanMode });

    if (options.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(`${formatReport(report)}\n`);
    }

    return report.verdict === "BLOCK" ? 1 : 0;
  } catch (error) {
    stderr.write(`SISP error: ${error.message}\n`);
    return 1;
  }
}

function parseCliArgs(argv) {
  if (argv[0] === "install") {
    return {
      command: "install",
      ...parseInstallArgs(argv.slice(1))
    };
  }

  if (argv[0] === "scan") {
    return {
      command: "scan",
      ...parseArgs(argv.slice(1))
    };
  }

  return {
    command: "scan",
    ...parseArgs(argv)
  };
}

function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
    scanMode: "auto",
    targetPath: null
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--before") {
      setScanMode(options, "before");
      continue;
    }

    if (arg === "--after") {
      setScanMode(options, "after");
      continue;
    }

    if (arg === "--auto") {
      setScanMode(options, "auto");
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (isScanModeKeyword(arg) && !options.targetPath) {
      setScanMode(options, arg);
      continue;
    }

    if (options.targetPath) {
      throw new Error("Only one target path is supported");
    }

    options.targetPath = arg;
  }

  return options;
}

function setScanMode(options, nextMode) {
  if (options.scanMode !== "auto" && options.scanMode !== nextMode) {
    throw new Error(`Conflicting scan modes: ${options.scanMode} and ${nextMode}`);
  }

  options.scanMode = nextMode;
}

function isScanModeKeyword(value) {
  return value === "before" || value === "after" || value === "auto";
}

function buildHelp() {
  return [
    "SISP v0.2.0",
    "",
    "Usage:",
    "  sisp install [package-spec...] [--json] [--dry-run] [-- <npm install args>]",
    "  sisp scan [path] [--before|--after|--auto] [--json]",
    "  sisp scan before [path] [--json]",
    "  sisp scan after [path] [--json]",
    "  sisp [path] [--before|--after|--auto] [--json]",
    "  sisp before [path] [--json]",
    "  sisp after [path] [--json]",
    "",
    "Examples:",
    "  sisp install",
    "  sisp install package-name",
    "  sisp install package-name -- --save-dev",
    "  sisp scan",
    "  sisp scan after ./some-project",
    "  sisp",
    "  sisp before",
    "  sisp after ./some-project",
    "  sisp ./some-project",
    "  sisp --after --json"
  ].join("\n");
}

function formatReport(report) {
  const decision = buildDecisionSummary(report);
  const explanation = buildExplanation(report);
  const nextSteps = buildNextSteps(report);
  const findings = buildHumanFindings(report);
  const lines = [
    `SISP scan: ${report.packageName}`,
    `Target: ${report.targetPath}`,
    `Scan mode: ${formatScanMode(report.effectiveScanMode, report.requestedScanMode)}`,
    `Decision: ${decision.title}`,
    `Risk level: ${report.verdict} (${report.score.toFixed(2)})`,
    "",
    "What this means:",
    explanation
  ];

  if (findings.length > 0) {
    lines.push("");
    lines.push("What SISP found:");
    for (const finding of findings) {
      lines.push(`- ${finding}`);
    }
  } else {
    lines.push("");
    lines.push("What SISP found:");
    lines.push("- No strong install-time risk signals were detected.");
  }

  if (report.notes.length > 0) {
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push("");
  lines.push("What to do next:");
  for (const step of nextSteps) {
    lines.push(`- ${step}`);
  }

  return lines.join("\n");
}

function runInstallWorkflow(options, { cwd, stdout, stderr, execFileSync, spawnSync }) {
  const installCheck = inspectRequestedPackages(options.packageSpecs, { cwd, execFileSync });

  if (installCheck.verdict === "BLOCK") {
    if (options.json) {
      stdout.write(`${JSON.stringify({ installCheck, install: null, afterScan: null }, null, 2)}\n`);
    } else {
      stdout.write(`${formatInstallReport(installCheck, { willInstall: false, dryRun: options.dryRun })}\n`);
    }

    return 1;
  }

  if (options.dryRun) {
    if (options.json) {
      stdout.write(`${JSON.stringify({ installCheck, install: null, afterScan: null }, null, 2)}\n`);
    } else {
      stdout.write(`${formatInstallReport(installCheck, { willInstall: false, dryRun: true })}\n`);
    }

    return 0;
  }

  if (!options.json) {
    stdout.write(`${formatInstallReport(installCheck, { willInstall: true, dryRun: false })}\n\n`);
    stdout.write(`Running: ${buildInstallCommandSummary(options)}\n\n`);
  }

  const install = runNpmInstall(options.packageSpecs, options.npmArgs, {
    cwd,
    spawnSync,
    stdio: options.json ? "pipe" : "inherit"
  });

  if (install.status !== 0) {
    if (options.json) {
      stdout.write(`${JSON.stringify({ installCheck, install, afterScan: null }, null, 2)}\n`);
    } else {
      stderr.write(`SISP error: npm install failed with exit code ${install.status}\n`);
    }

    return install.status || 1;
  }

  const afterScan = scanProject(path.resolve(cwd), { mode: "after" });

  if (options.json) {
    stdout.write(`${JSON.stringify({ installCheck, install, afterScan }, null, 2)}\n`);
  } else {
    stdout.write(`\nPost-install scan:\n${formatReport(afterScan)}\n`);
  }

  return afterScan.verdict === "BLOCK" ? 1 : 0;
}

function formatInstallReport(report, options = {}) {
  const decision = buildInstallDecisionSummary(report);
  const explanation = buildInstallExplanation(report, options);
  const findings = buildHumanInstallFindings(report);
  const nextSteps = buildInstallNextSteps(report, options);
  const lines = [
    "SISP install",
    `Target: ${report.targetPath}`,
    `Requested scope: ${formatInstallScope(report)}`,
    `Decision: ${decision.title}`,
    `Risk level: ${report.verdict} (${report.score.toFixed(2)})`,
    "",
    "What this means:",
    explanation
  ];

  if (findings.length > 0) {
    lines.push("");
    lines.push("What SISP found:");
    for (const finding of findings) {
      lines.push(`- ${finding}`);
    }
  } else {
    lines.push("");
    lines.push("What SISP found:");
    lines.push("- No strong npm metadata or install-time risk signals were detected for this install request.");
  }

  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }

  lines.push("");
  lines.push("What to do next:");
  for (const step of nextSteps) {
    lines.push(`- ${step}`);
  }

  return lines.join("\n");
}

function buildInstallDecisionSummary(report) {
  if (report.verdict === "BLOCK") {
    return {
      title: "Stop and inspect before npm install runs"
    };
  }

  if (report.verdict === "REVIEW") {
    return {
      title: "Review these packages before continuing"
    };
  }

  return {
    title: "Safe to install"
  };
}

function buildInstallExplanation(report, options) {
  if (report.verdict === "BLOCK") {
    return "SISP checked the packages this install would use and found blocking install-time risk signals. npm install was not started.";
  }

  if (options.dryRun) {
    return "SISP checked the packages this install would use without running npm install. Use this mode when you want an install decision without changing the project.";
  }

  if (report.verdict === "REVIEW") {
    return "SISP found install-time or source signals worth a quick review. This v1 workflow only blocks stronger signals, so npm install will continue after this check.";
  }

  return "SISP checked the packages this install would use before running npm install. No blocking signals were found.";
}

function buildHumanInstallFindings(report) {
  const findings = [];

  for (const reason of report.reasons) {
    const finding = humanizeInstallReason(reason);
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

function humanizeInstallReason(reason) {
  switch (reason.code) {
    case "package-metadata-unavailable":
      return `npm metadata could not be read for: ${extractDetails(reason.message)}.`;
    case "requested-non-standard-source":
      return `Some packages in this install request use non-standard sources such as git, local paths, or direct tarballs: ${extractDetails(reason.message)}.`;
    case "package-install-scripts":
      return `Packages in this install request run code during install: ${extractDetails(reason.message)}.`;
    case "package-suspicious-install-scripts":
      return `Packages in this install request contain install commands that may fetch or execute code: ${extractDetails(reason.message)}.`;
    case "package-native-build-indicators":
      return `Packages in this install request perform native build work: ${extractDetails(reason.message)}.`;
    case "package-dependency-source-risks":
      return `Packages in this install request depend on non-standard sources: ${extractDetails(reason.message)}.`;
    case "package-source-unknown":
      return `Some packages in this install request do not publish a source repository URL: ${extractDetails(reason.message)}.`;
    case "package-missing-integrity":
      return `Some packages in this install request do not expose integrity metadata: ${extractDetails(reason.message)}.`;
    default:
      return reason.message;
  }
}

function buildInstallNextSteps(report, options) {
  if (report.verdict === "BLOCK") {
    return [
      "Inspect the package version and metadata before retrying this install.",
      "Avoid installing packages that fetch or execute remote code during install unless you trust the source and expected behavior.",
      "If you still want to inspect without changing the project, rerun the same command with --dry-run."
    ];
  }

  if (options.dryRun) {
    return [
      "If the findings look expected, rerun the same command without --dry-run to let SISP continue with npm install.",
      "If anything looks unfamiliar, inspect the package metadata and published files before installing."
    ];
  }

  if (report.verdict === "REVIEW") {
    return [
      "Let npm install finish, then read the post-install scan that follows.",
      "If a package looks unfamiliar, inspect its npm metadata and published repository before keeping it in the project.",
      "Use --dry-run first when you want the install decision without changing dependencies."
    ];
  }

  return [
    "Let npm install finish, then review the post-install scan for the full project state.",
    "If you only want the install check next time, use --dry-run."
  ];
}

function formatInstallScope(report) {
  if (report.installMode === "project") {
    return report.packageSpecs.length === 0
      ? "current project dependencies (none found)"
      : `current project dependencies (${report.packageSpecs.length} direct)`;
  }

  return report.packageSpecs.join(", ");
}

function buildInstallCommandSummary(options) {
  const args = ["npm", "install", ...options.packageSpecs, ...options.npmArgs];
  return args.join(" ");
}

function buildDecisionSummary(report) {
  if (report.verdict === "BLOCK") {
    return {
      title: "Stop and inspect before you install"
    };
  }

  if (report.verdict === "REVIEW") {
    return {
      title: "Review this project before you continue"
    };
  }

  return {
    title: "Safe to continue"
  };
}

function buildExplanation(report) {
  if (report.effectiveScanMode === "before") {
    if (report.verdict === "SAFE") {
      return "This was a before-install scan. SISP checked project metadata and lockfile signals before node_modules was inspected.";
    }

    return "This was a before-install scan. SISP checked project metadata and lockfile signals before node_modules was inspected.";
  }

  if (report.verdict === "BLOCK") {
    return "This project shows high-risk install behavior or dependency sources. That does not prove malware, but it is risky enough that you should stop and verify the changes before running install.";
  }

  if (report.verdict === "REVIEW") {
    return "This project has install-time behavior that deserves a quick review. Many packages do this for legitimate reasons, but unexpected changes should be checked before you continue.";
  }

  return "SISP did not find any strong install-time warning signs in the current project metadata. This lowers risk, but it does not guarantee that the project is completely safe.";
}

function buildNextSteps(report) {
  if (report.verdict === "BLOCK") {
    return [
      "Check the new or changed dependencies in package.json and package-lock.json before running install.",
      "Look closely at packages that run install scripts or come from git, local paths, or direct tarball URLs.",
      "If these changes were not expected, stop here and inspect the dependency update in code review."
    ];
  }

  if (report.verdict === "REVIEW") {
    return [
      "Confirm that the highlighted packages are expected for this project.",
      "If the changes are expected, you can continue after a quick review of package.json and package-lock.json.",
      "If any package looks unfamiliar or newly added, inspect that dependency before running install."
    ];
  }

  return [
    "You can continue, but still review dependency updates as part of normal code review.",
    "If this project was recently changed, compare package.json and package-lock.json with the previous commit."
  ];
}

function formatScanMode(effectiveScanMode, requestedScanMode) {
  const label = effectiveScanMode === "after" ? "after install" : "before install";
  if (requestedScanMode === "auto") {
    return `${label} (auto)`;
  }

  return label;
}

function buildHumanFindings(report) {
  const findings = [];

  for (const reason of report.reasons) {
    const finding = humanizeReason(reason);
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

function humanizeReason(reason) {
  switch (reason.code) {
    case "lifecycle-scripts":
      return `The project itself runs code during install: ${extractDetails(reason.message)}.`;
    case "suspicious-lifecycle-script":
      return `The project has an install command that may fetch or execute code: ${extractDetails(reason.message)}.`;
    case "native-build-indicators":
      return `The project depends on native build tooling such as ${extractDetails(reason.message)}.`;
    case "dependency-lifecycle-scripts":
      return `Installed dependencies run code during install: ${extractDetails(reason.message)}.`;
    case "dependency-suspicious-lifecycle-scripts":
      return `Installed dependencies contain install commands that may fetch or execute code: ${extractDetails(reason.message)}.`;
    case "dependency-native-build-indicators":
      return `Installed dependencies perform native build work: ${extractDetails(reason.message)}.`;
    case "lockfile-install-scripts":
      return `Packages in the lockfile are marked to run install scripts: ${extractDetails(reason.message)}.`;
    case "non-standard-source-risks":
      return `Some dependencies come from non-standard sources such as git, local paths, or direct tarballs: ${extractDetails(reason.message)}.`;
    case "missing-lockfile":
      return "No npm lockfile was found, so install results may change more easily between runs.";
    default:
      return reason.message;
  }
}

function extractDetails(message) {
  const parts = message.split(": ");
  return parts.length > 1 ? parts.slice(1).join(": ") : message;
}

module.exports = {
  buildDecisionSummary,
  buildHelp,
  formatScanMode,
  runCli,
  formatInstallReport,
  formatReport,
  humanizeInstallReason,
  humanizeReason,
  parseArgs,
  parseCliArgs
};
