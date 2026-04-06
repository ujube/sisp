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
    "  sisp [path] [--before|--after|--auto] [--json]",
    "  sisp before [path] [--json]",
    "  sisp after [path] [--json]",
    "  sisp install <package-spec...> [--json] [--dry-run] [-- <npm install args>]",
    "",
    "Examples:",
    "  sisp",
    "  sisp before",
    "  sisp after ./some-project",
    "  sisp ./some-project",
    "  sisp --after --json",
    "  sisp install package-name",
    "  sisp install package-name -- --save-dev"
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
  const preflight = inspectRequestedPackages(options.packageSpecs, { cwd, execFileSync });

  if (preflight.verdict === "BLOCK") {
    if (options.json) {
      stdout.write(`${JSON.stringify({ preflight, install: null, afterScan: null }, null, 2)}\n`);
    } else {
      stdout.write(`${formatInstallPreflightReport(preflight, { willInstall: false, dryRun: options.dryRun })}\n`);
    }

    return 1;
  }

  if (options.dryRun) {
    if (options.json) {
      stdout.write(`${JSON.stringify({ preflight, install: null, afterScan: null }, null, 2)}\n`);
    } else {
      stdout.write(`${formatInstallPreflightReport(preflight, { willInstall: false, dryRun: true })}\n`);
    }

    return 0;
  }

  if (!options.json) {
    stdout.write(`${formatInstallPreflightReport(preflight, { willInstall: true, dryRun: false })}\n\n`);
    stdout.write(`Running: npm install ${options.packageSpecs.join(" ")}${options.npmArgs.length > 0 ? ` ${options.npmArgs.join(" ")}` : ""}\n\n`);
  }

  const install = runNpmInstall(options.packageSpecs, options.npmArgs, {
    cwd,
    spawnSync,
    stdio: options.json ? "pipe" : "inherit"
  });

  if (install.status !== 0) {
    if (options.json) {
      stdout.write(`${JSON.stringify({ preflight, install, afterScan: null }, null, 2)}\n`);
    } else {
      stderr.write(`SISP error: npm install failed with exit code ${install.status}\n`);
    }

    return install.status || 1;
  }

  const afterScan = scanProject(path.resolve(cwd), { mode: "after" });

  if (options.json) {
    stdout.write(`${JSON.stringify({ preflight, install, afterScan }, null, 2)}\n`);
  } else {
    stdout.write(`\nPost-install scan:\n${formatReport(afterScan)}\n`);
  }

  return afterScan.verdict === "BLOCK" ? 1 : 0;
}

function formatInstallPreflightReport(report, options = {}) {
  const decision = buildInstallDecisionSummary(report);
  const explanation = buildInstallExplanation(report, options);
  const findings = buildHumanInstallFindings(report);
  const nextSteps = buildInstallNextSteps(report, options);
  const lines = [
    "SISP install preflight",
    `Target: ${report.targetPath}`,
    `Requested packages: ${report.packageSpecs.join(", ")}`,
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
    lines.push("- No strong npm registry metadata risk signals were detected for the requested packages.");
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
    return "SISP checked npm registry metadata for the requested packages and found blocking install-time risk signals. npm install was not started.";
  }

  if (options.dryRun) {
    return "SISP checked npm registry metadata for the requested packages without running npm install. Use this mode to review package signals before changing your project.";
  }

  if (report.verdict === "REVIEW") {
    return "SISP found install-time or source signals worth a quick review in npm metadata. This command only blocks on stronger signals, so npm install will continue after the preflight report.";
  }

  return "SISP checked npm registry metadata for the requested packages before running npm install. No blocking preflight signals were found.";
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
      return `Some requested package specs use non-standard sources such as git, local paths, or direct tarballs: ${extractDetails(reason.message)}.`;
    case "package-install-scripts":
      return `Requested packages run code during install: ${extractDetails(reason.message)}.`;
    case "package-suspicious-install-scripts":
      return `Requested packages contain install commands that may fetch or execute code: ${extractDetails(reason.message)}.`;
    case "package-native-build-indicators":
      return `Requested packages perform native build work: ${extractDetails(reason.message)}.`;
    case "package-dependency-source-risks":
      return `Requested packages depend on non-standard sources: ${extractDetails(reason.message)}.`;
    case "package-source-unknown":
      return `Some requested packages do not publish a source repository URL: ${extractDetails(reason.message)}.`;
    case "package-missing-integrity":
      return `Some requested packages do not expose integrity metadata: ${extractDetails(reason.message)}.`;
    default:
      return reason.message;
  }
}

function buildInstallNextSteps(report, options) {
  if (report.verdict === "BLOCK") {
    return [
      "Inspect the requested package version and its npm metadata before retrying.",
      "Avoid installing packages that fetch or execute remote code during install unless you trust the source and expected behavior.",
      "If you still want to inspect without changing the project, rerun the command with --dry-run."
    ];
  }

  if (options.dryRun) {
    return [
      "If the findings look expected, rerun the same command without --dry-run to perform npm install.",
      "If anything looks unfamiliar, inspect the package metadata and published files before installing."
    ];
  }

  if (report.verdict === "REVIEW") {
    return [
      "Let npm install finish, then read the post-install scan that follows.",
      "If a package looks unfamiliar, inspect its npm metadata and published repository before keeping it in the project.",
      "Use --dry-run first when you want the preflight decision without changing dependencies."
    ];
  }

  return [
    "Let npm install finish, then review the post-install scan for the full project state.",
    "If you only want the preflight decision next time, use --dry-run."
  ];
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
  formatInstallPreflightReport,
  formatReport,
  humanizeInstallReason,
  humanizeReason,
  parseArgs,
  parseCliArgs
};
