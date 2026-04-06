const childProcess = require("child_process");
const {
  findDirectSourceRisks,
  findNativeBuildIndicators,
  findSuspiciousLifecycleScripts
} = require("./scan-project");
const { pickVerdict } = require("./risk-engine");

const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"];
const INSTALL_SOURCE_WEIGHTS = {
  alias: 0.15,
  "local-file": 0.2,
  "local-link": 0.2,
  git: 0.25,
  "remote-tarball": 0.3
};
const INSTALL_RISK_WEIGHTS = {
  metadataUnavailable: 0.35,
  requestedNonStandardSource: 0.3,
  installScripts: 0.35,
  suspiciousInstallScripts: 0.4,
  nativeBuildIndicators: 0.15,
  dependencySourceRisks: 0.25,
  missingRepository: 0.1,
  missingIntegrity: 0.05
};
const SOURCE_RISK_PATTERNS = {
  git: [
    /^git\+/i,
    /^git:\/\//i,
    /^github:/i,
    /^gitlab:/i,
    /^bitbucket:/i,
    /\.git(?:#|$)/i,
    /^https?:\/\/github\.com\//i,
    /^https?:\/\/gitlab\.com\//i,
    /^https?:\/\/bitbucket\.org\//i
  ],
  localFile: [/^file:/i, /^file:\/\//i],
  localLink: [/^link:/i],
  remoteTarball: [/^https?:\/\/.+\.(?:tgz|tar\.gz|tar)(?:[?#].*)?$/i],
  alias: [/^npm:/i]
};

function parseInstallArgs(argv) {
  const options = {
    help: false,
    json: false,
    dryRun: false,
    packageSpecs: [],
    npmArgs: []
  };
  let forwarding = false;

  for (const arg of argv) {
    if (forwarding) {
      options.npmArgs.push(arg);
      continue;
    }

    if (arg === "--") {
      forwarding = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("-")) {
      options.npmArgs.push(arg);
      continue;
    }

    options.packageSpecs.push(arg);
  }

  if (!options.help && options.packageSpecs.length === 0) {
    throw new Error("Install mode requires at least one package spec");
  }

  return options;
}

function inspectRequestedPackages(packageSpecs, options = {}) {
  const cwd = options.cwd || process.cwd();
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const registryUrl = readConfiguredRegistry(cwd, execFileSync);
  const packageChecks = packageSpecs.map((spec) =>
    inspectSinglePackage(spec, { cwd, execFileSync, registryUrl })
  );
  const risk = evaluateInstallRisk(packageChecks);

  return {
    targetPath: cwd,
    registryUrl,
    packageSpecs: [...packageSpecs],
    packageChecks,
    notes: buildInstallNotes(packageChecks),
    score: risk.score,
    verdict: risk.verdict,
    reasons: risk.reasons
  };
}

function runNpmInstall(packageSpecs, npmArgs, options = {}) {
  const cwd = options.cwd || process.cwd();
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const stdio = options.stdio || "inherit";
  const result = spawnSync("npm", ["install", ...packageSpecs, ...npmArgs], {
    cwd,
    encoding: "utf8",
    stdio
  });

  if (result.error) {
    throw result.error;
  }

  return {
    command: "npm",
    args: ["install", ...packageSpecs, ...npmArgs],
    status: result.status === null ? 1 : result.status,
    signal: result.signal || null,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : ""
  };
}

function inspectSinglePackage(spec, options) {
  const requestedSourceType = classifySourceFromText(spec) || "registry";

  if (requestedSourceType !== "registry" && requestedSourceType !== "alias") {
    return {
      requestedSpec: spec,
      requestedSourceType,
      metadataAvailable: false,
      packageName: requestedDisplayName(spec),
      version: null,
      repositoryUrl: null,
      homepage: null,
      bugsUrl: null,
      distTarball: null,
      distIntegrity: null,
      installScripts: [],
      suspiciousInstallScripts: [],
      nativeBuildIndicators: [],
      dependencySourceRisks: [],
      dependencyCount: 0,
      metadataError: null
    };
  }

  try {
    const metadata = readPackageView(spec, options.cwd, options.execFileSync);
    const dependencies = collectMetadataDependencies(metadata.dependencies);
    const installScripts = findInstallScripts(metadata.scripts || {});

    return {
      requestedSpec: spec,
      requestedSourceType,
      metadataAvailable: true,
      packageName: metadata.name || requestedDisplayName(spec),
      version: metadata.version || null,
      repositoryUrl: extractRepositoryUrl(metadata.repository),
      homepage: metadata.homepage || null,
      bugsUrl: extractBugsUrl(metadata.bugs),
      distTarball: metadata["dist.tarball"] || null,
      distIntegrity: metadata["dist.integrity"] || null,
      installScripts,
      suspiciousInstallScripts: findSuspiciousLifecycleScripts(installScripts),
      nativeBuildIndicators: findNativeBuildIndicators(
        { gypfile: metadata.gypfile === true },
        dependencies
      ),
      dependencySourceRisks: findDirectSourceRisks(dependencies),
      dependencyCount: dependencies.length,
      metadataError: null
    };
  } catch (error) {
    return {
      requestedSpec: spec,
      requestedSourceType,
      metadataAvailable: false,
      packageName: requestedDisplayName(spec),
      version: null,
      repositoryUrl: null,
      homepage: null,
      bugsUrl: null,
      distTarball: null,
      distIntegrity: null,
      installScripts: [],
      suspiciousInstallScripts: [],
      nativeBuildIndicators: [],
      dependencySourceRisks: [],
      dependencyCount: 0,
      metadataError: normalizeExecError(error)
    };
  }
}

function readConfiguredRegistry(cwd, execFileSync) {
  try {
    const output = execFileSync("npm", ["config", "get", "registry"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();

    return output || "https://registry.npmjs.org/";
  } catch {
    return "https://registry.npmjs.org/";
  }
}

function readPackageView(spec, cwd, execFileSync) {
  const output = execFileSync(
    "npm",
    [
      "view",
      spec,
      "name",
      "version",
      "scripts",
      "repository",
      "homepage",
      "bugs",
      "dist.tarball",
      "dist.integrity",
      "dependencies",
      "gypfile",
      "--json"
    ],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (!output.trim()) {
    return {};
  }

  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
}

function evaluateInstallRisk(packageChecks) {
  const reasons = [];
  let score = 0;

  const metadataUnavailable = packageChecks.filter((item) => item.metadataError);
  if (metadataUnavailable.length > 0) {
    score += INSTALL_RISK_WEIGHTS.metadataUnavailable;
    reasons.push({
      code: "package-metadata-unavailable",
      weight: INSTALL_RISK_WEIGHTS.metadataUnavailable,
      message: `Could not read npm metadata for: ${metadataUnavailable.map(formatPackageLabel).join(", ")}`
    });
  }

  const nonStandardSources = packageChecks.filter(
    (item) => item.requestedSourceType && item.requestedSourceType !== "registry"
  );
  if (nonStandardSources.length > 0) {
    const sourceWeight = getInstallSourceRiskWeight(nonStandardSources);
    score += sourceWeight;
    reasons.push({
      code: "requested-non-standard-source",
      weight: sourceWeight,
      message: `Requested package specs use non-standard sources: ${nonStandardSources.map(formatSourceFinding).join(", ")}`
    });
  }

  const installScripts = flattenPackageChecks(packageChecks, "installScripts");
  if (installScripts.length > 0) {
    score += INSTALL_RISK_WEIGHTS.installScripts;
    reasons.push({
      code: "package-install-scripts",
      weight: INSTALL_RISK_WEIGHTS.installScripts,
      message: `Requested packages run install scripts: ${installScripts.map(formatScriptFinding).join(", ")}`
    });
  }

  const suspiciousInstallScripts = flattenPackageChecks(packageChecks, "suspiciousInstallScripts");
  if (suspiciousInstallScripts.length > 0) {
    score += INSTALL_RISK_WEIGHTS.suspiciousInstallScripts;
    reasons.push({
      code: "package-suspicious-install-scripts",
      weight: INSTALL_RISK_WEIGHTS.suspiciousInstallScripts,
      message: `Requested packages contain suspicious install commands: ${suspiciousInstallScripts.map(formatSuspiciousScriptFinding).join(", ")}`
    });
  }

  const nativeBuildIndicators = packageChecks.filter((item) => item.nativeBuildIndicators.length > 0);
  if (nativeBuildIndicators.length > 0) {
    score += INSTALL_RISK_WEIGHTS.nativeBuildIndicators;
    reasons.push({
      code: "package-native-build-indicators",
      weight: INSTALL_RISK_WEIGHTS.nativeBuildIndicators,
      message: `Requested packages perform native build work: ${nativeBuildIndicators.map(formatNativeBuildFinding).join(", ")}`
    });
  }

  const dependencySourceRisks = flattenPackageChecks(packageChecks, "dependencySourceRisks");
  if (dependencySourceRisks.length > 0) {
    score += INSTALL_RISK_WEIGHTS.dependencySourceRisks;
    reasons.push({
      code: "package-dependency-source-risks",
      weight: INSTALL_RISK_WEIGHTS.dependencySourceRisks,
      message: `Requested packages depend on non-standard sources: ${dependencySourceRisks.map(formatDependencySourceFinding).join(", ")}`
    });
  }

  const missingRepository = packageChecks.filter((item) => item.metadataAvailable && !item.repositoryUrl);
  if (missingRepository.length > 0) {
    score += INSTALL_RISK_WEIGHTS.missingRepository;
    reasons.push({
      code: "package-source-unknown",
      weight: INSTALL_RISK_WEIGHTS.missingRepository,
      message: `Requested packages do not publish a repository URL: ${missingRepository.map(formatPackageLabel).join(", ")}`
    });
  }

  const missingIntegrity = packageChecks.filter(
    (item) =>
      item.metadataAvailable &&
      item.requestedSourceType === "registry" &&
      !item.distIntegrity
  );
  if (missingIntegrity.length > 0) {
    score += INSTALL_RISK_WEIGHTS.missingIntegrity;
    reasons.push({
      code: "package-missing-integrity",
      weight: INSTALL_RISK_WEIGHTS.missingIntegrity,
      message: `Requested packages do not expose integrity metadata: ${missingIntegrity.map(formatPackageLabel).join(", ")}`
    });
  }

  const normalizedScore = Math.min(1, score);

  return {
    score: normalizedScore,
    verdict: pickVerdict(normalizedScore),
    reasons
  };
}

function buildInstallNotes(packageChecks) {
  const notes = [];
  const metadataSkipped = packageChecks.filter(
    (item) => !item.metadataAvailable && !item.metadataError && item.requestedSourceType !== "registry"
  );

  if (metadataSkipped.length > 0) {
    notes.push(
      `Registry metadata could not be checked for non-registry specs: ${metadataSkipped.map(formatSourceFinding).join(", ")}`
    );
  }

  return notes;
}

function collectMetadataDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    return [];
  }

  return Object.entries(dependencies).map(([name, spec]) => ({
    name,
    spec,
    section: "dependencies"
  }));
}

function findInstallScripts(scripts) {
  return INSTALL_SCRIPT_NAMES.filter((name) => typeof scripts[name] === "string").map((name) => ({
    name,
    command: scripts[name]
  }));
}

function extractRepositoryUrl(repository) {
  if (typeof repository === "string") {
    return repository;
  }

  if (repository && typeof repository.url === "string") {
    return repository.url;
  }

  return null;
}

function extractBugsUrl(bugs) {
  if (typeof bugs === "string") {
    return bugs;
  }

  if (bugs && typeof bugs.url === "string") {
    return bugs.url;
  }

  return null;
}

function normalizeExecError(error) {
  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  const shortMessage = stderr.split("\n").find(Boolean);
  if (shortMessage) {
    return shortMessage;
  }

  return error.message;
}

function flattenPackageChecks(packageChecks, key) {
  return packageChecks.flatMap((item) =>
    item[key].map((entry) => ({
      ...entry,
      packageName: item.packageName,
      version: item.version,
      requestedSpec: item.requestedSpec
    }))
  );
}

function getInstallSourceRiskWeight(items) {
  const maxWeight = items.reduce((highest, item) => {
    const itemWeight = INSTALL_SOURCE_WEIGHTS[item.requestedSourceType] || INSTALL_RISK_WEIGHTS.requestedNonStandardSource;
    return Math.max(highest, itemWeight);
  }, 0);
  const quantityBump = Math.min(0.1, Math.max(0, items.length - 1) * 0.03);

  return maxWeight + quantityBump;
}

function formatPackageLabel(item) {
  return item.version ? `${item.packageName}@${item.version}` : item.packageName;
}

function formatSourceFinding(item) {
  return `${item.requestedSpec} [${humanizeSourceType(item.requestedSourceType)}]`;
}

function formatScriptFinding(item) {
  const label = item.version ? `${item.packageName}@${item.version}` : item.packageName;
  return `${label} (${item.name})`;
}

function formatSuspiciousScriptFinding(item) {
  const label = item.version ? `${item.packageName}@${item.version}` : item.packageName;
  return `${label} (${item.name} uses ${item.token})`;
}

function formatNativeBuildFinding(item) {
  return `${formatPackageLabel(item)} (${item.nativeBuildIndicators.join(", ")})`;
}

function formatDependencySourceFinding(item) {
  return `${item.packageName} -> ${item.name} [${humanizeSourceType(item.sourceType)}]`;
}

function humanizeSourceType(sourceType) {
  switch (sourceType) {
    case "git":
      return "git";
    case "local-file":
    case "local-link":
      return "local path";
    case "remote-tarball":
      return "remote tarball";
    case "alias":
      return "alias";
    default:
      return sourceType;
  }
}

function requestedDisplayName(spec) {
  if (spec.startsWith("@")) {
    const secondAt = spec.indexOf("@", 1);
    return secondAt === -1 ? spec : spec.slice(0, secondAt);
  }

  const atIndex = spec.indexOf("@");
  return atIndex === -1 ? spec : spec.slice(0, atIndex);
}

function classifySourceFromText(value) {
  if (typeof value !== "string") {
    return null;
  }

  if (matchesAny(value, SOURCE_RISK_PATTERNS.localLink)) {
    return "local-link";
  }

  if (matchesAny(value, SOURCE_RISK_PATTERNS.localFile)) {
    return "local-file";
  }

  if (matchesAny(value, SOURCE_RISK_PATTERNS.git)) {
    return "git";
  }

  if (matchesAny(value, SOURCE_RISK_PATTERNS.alias)) {
    return "alias";
  }

  if (matchesAny(value, SOURCE_RISK_PATTERNS.remoteTarball)) {
    return "remote-tarball";
  }

  return null;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

module.exports = {
  INSTALL_RISK_WEIGHTS,
  classifySourceFromText,
  evaluateInstallRisk,
  findInstallScripts,
  inspectRequestedPackages,
  parseInstallArgs,
  runNpmInstall
};
