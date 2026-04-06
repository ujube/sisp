const fs = require("fs");
const path = require("path");
const { evaluateRisk } = require("./risk-engine");

const LIFECYCLE_SCRIPT_NAMES = ["preinstall", "install", "postinstall", "prepare"];
const DEPENDENCY_INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"];
const SUSPICIOUS_SCRIPT_PATTERNS = [
  /(^|\s)curl(\s|$)/i,
  /(^|\s)wget(\s|$)/i,
  /(^|\s)bash(\s|$)/i,
  /(^|\s)sh\s+-c(\s|$)/i,
  /(^|\s)powershell(\s|$)/i,
  /(^|\s)pwsh(\s|$)/i,
  /Invoke-WebRequest/i,
  /(^|\s)node\s+-e(\s|$)/i,
  /(^|\s)python(?:3)?\s+-c(\s|$)/i
];
const GIT_DEPENDENCY_PATTERNS = [
  /^git\+/i,
  /^git:\/\//i,
  /^github:/i,
  /^gitlab:/i,
  /^bitbucket:/i,
  /\.git(?:#|$)/i,
  /^https?:\/\/github\.com\//i
];
const LOCAL_DEPENDENCY_PATTERNS = [/^file:/i, /^link:/i];
const NATIVE_BUILD_SCRIPT_PATTERNS = [
  /node-gyp/i,
  /prebuild-install/i,
  /napi-postinstall/i,
  /node-pre-gyp/i,
  /cmake-js/i
];
const NATIVE_BUILD_PACKAGES = new Set([
  "bindings",
  "cmake-js",
  "nan",
  "node-addon-api",
  "node-gyp",
  "node-pre-gyp",
  "prebuild-install"
]);
const LOCKFILE_NAMES = ["npm-shrinkwrap.json", "package-lock.json"];
const SOURCE_RISK_PATTERNS = {
  git: [
    /^git\+/i,
    /^git:\/\//i,
    /^github:/i,
    /^gitlab:/i,
    /^bitbucket:/i,
    /\.git(?:#|$)/i,
    /github\.com\/.+\/.+(?:\.git|\/tar\.gz\/)/i,
    /codeload\.github\.com\//i
  ],
  localFile: [/^file:/i, /^file:\/\//i],
  localLink: [/^link:/i],
  remoteTarball: [/^https?:\/\/.+\.(?:tgz|tar\.gz|tar)(?:[?#].*)?$/i],
  alias: [/^npm:/i]
};
const EMPTY_DEPENDENCY_SIGNALS = {
  packagesScanned: 0,
  lifecycleScripts: [],
  suspiciousLifecycleScripts: [],
  nativeBuildIndicators: []
};

function scanProject(projectDir, options = {}) {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${projectDir}`);
  }

  const requestedScanMode = options.mode || "auto";
  const nodeModulesExists = hasNodeModules(projectDir);
  const effectiveScanMode = resolveScanMode(requestedScanMode, nodeModulesExists);
  const notes = [];
  const pkg = readJson(packageJsonPath);
  const allDependencies = collectDependencies(pkg);
  const lifecycleScripts = findLifecycleScripts(pkg.scripts || {});
  const suspiciousLifecycleScripts = findSuspiciousLifecycleScripts(lifecycleScripts);
  const directSourceRisks = findDirectSourceRisks(allDependencies);
  const installedDependencySignals = effectiveScanMode === "after"
    ? scanInstalledDependencies(projectDir)
    : EMPTY_DEPENDENCY_SIGNALS;
  const lockfileSignals = scanLockfile(projectDir);
  const directSourceRiskKeys = new Set(
    directSourceRisks.map((item) => `${item.packageName}:${sourceRiskFamily(item.sourceType)}`)
  );

  if (requestedScanMode === "after" && !nodeModulesExists) {
    notes.push("After-install mode was requested, but node_modules was not found. Installed dependencies could not be inspected.");
  }

  const analysis = {
    packageName: pkg.name || path.basename(projectDir),
    targetPath: projectDir,
    requestedScanMode,
    effectiveScanMode,
    notes,
    lifecycleScripts,
    suspiciousLifecycleScripts,
    gitDependencies: findDependenciesMatching(allDependencies, GIT_DEPENDENCY_PATTERNS),
    localDependencies: findDependenciesMatching(allDependencies, LOCAL_DEPENDENCY_PATTERNS),
    directSourceRisks,
    nativeBuildIndicators: findNativeBuildIndicators(pkg, allDependencies),
    dependencyLifecycleScripts: installedDependencySignals.lifecycleScripts,
    dependencySuspiciousLifecycleScripts: installedDependencySignals.suspiciousLifecycleScripts,
    dependencyNativeBuildIndicators: installedDependencySignals.nativeBuildIndicators,
    installedPackagesScanned: installedDependencySignals.packagesScanned,
    lockfilePackagesScanned: lockfileSignals.packagesScanned,
    lockfileInstallScripts: lockfileSignals.installScripts,
    lockfileSourceRisks: lockfileSignals.sourceRisks.filter(
      (item) => !directSourceRiskKeys.has(`${item.packageName}:${sourceRiskFamily(item.sourceType)}`)
    ),
    hasLockfile: hasNpmLockfile(projectDir)
  };

  const risk = evaluateRisk(analysis);

  return {
    packageName: analysis.packageName,
    targetPath: analysis.targetPath,
    requestedScanMode: analysis.requestedScanMode,
    effectiveScanMode: analysis.effectiveScanMode,
    notes: analysis.notes,
    score: risk.score,
    verdict: risk.verdict,
    reasons: risk.reasons,
    findings: {
      lifecycleScripts: analysis.lifecycleScripts,
      suspiciousLifecycleScripts: analysis.suspiciousLifecycleScripts,
      gitDependencies: analysis.gitDependencies,
      localDependencies: analysis.localDependencies,
      directSourceRisks: analysis.directSourceRisks,
      nativeBuildIndicators: analysis.nativeBuildIndicators,
      dependencyLifecycleScripts: analysis.dependencyLifecycleScripts,
      dependencySuspiciousLifecycleScripts: analysis.dependencySuspiciousLifecycleScripts,
      dependencyNativeBuildIndicators: analysis.dependencyNativeBuildIndicators,
      installedPackagesScanned: analysis.installedPackagesScanned,
      lockfilePackagesScanned: analysis.lockfilePackagesScanned,
      lockfileInstallScripts: analysis.lockfileInstallScripts,
      lockfileSourceRisks: analysis.lockfileSourceRisks,
      hasLockfile: analysis.hasLockfile
    }
  };
}

function resolveScanMode(requestedScanMode, nodeModulesExists) {
  if (requestedScanMode === "before") {
    return "before";
  }

  if (requestedScanMode === "after") {
    return "after";
  }

  return nodeModulesExists ? "after" : "before";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function collectDependencies(pkg) {
  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies"
  ];

  return sections.flatMap((section) => {
    const entries = Object.entries(pkg[section] || {});
    return entries.map(([name, spec]) => ({ name, spec, section }));
  });
}

function findLifecycleScripts(scripts) {
  return LIFECYCLE_SCRIPT_NAMES.filter((name) => typeof scripts[name] === "string").map((name) => ({
    name,
    command: scripts[name]
  }));
}

function findSuspiciousLifecycleScripts(lifecycleScripts) {
  const matches = [];

  for (const script of lifecycleScripts) {
    for (const pattern of SUSPICIOUS_SCRIPT_PATTERNS) {
      const matched = script.command.match(pattern);
      if (matched) {
        matches.push({
          name: script.name,
          command: script.command,
          token: matched[0].trim()
        });
        break;
      }
    }
  }

  return matches;
}

function findDependenciesMatching(dependencies, patterns) {
  return dependencies.filter((dependency) =>
    patterns.some((pattern) => pattern.test(dependency.spec))
  );
}

function findNativeBuildIndicators(pkg, dependencies) {
  const found = new Set();

  if (pkg.gypfile === true) {
    found.add("gypfile");
  }

  for (const dependency of dependencies) {
    if (NATIVE_BUILD_PACKAGES.has(dependency.name)) {
      found.add(dependency.name);
    }
  }

  return Array.from(found).sort();
}

function findDirectSourceRisks(dependencies) {
  const findings = [];

  for (const dependency of dependencies) {
    const sourceType = classifySourceFromText(dependency.spec);
    if (!sourceType) {
      continue;
    }

    findings.push({
      packageName: dependency.name,
      sourceType,
      spec: dependency.spec,
      section: dependency.section
    });
  }

  return findings;
}

function scanInstalledDependencies(projectDir) {
  const nodeModulesDir = path.join(projectDir, "node_modules");

  if (!fs.existsSync(nodeModulesDir)) {
    return EMPTY_DEPENDENCY_SIGNALS;
  }

  const packageDirs = collectInstalledPackageDirs(nodeModulesDir);
  const lifecycleScripts = [];
  const suspiciousLifecycleScripts = [];
  const nativeBuildIndicators = new Set();

  for (const packageDir of packageDirs) {
    const packageJsonPath = path.join(packageDir, "package.json");
    const pkg = tryReadJson(packageJsonPath);

    if (!pkg) {
      continue;
    }

    const packageName = pkg.name || path.basename(packageDir);
    const scripts = pkg.scripts || {};

    for (const scriptName of DEPENDENCY_INSTALL_SCRIPT_NAMES) {
      if (typeof scripts[scriptName] !== "string") {
        continue;
      }

      const script = {
        packageName,
        name: scriptName,
        command: scripts[scriptName]
      };

      lifecycleScripts.push(script);

      const suspiciousMatch = findSuspiciousToken(script.command);
      if (suspiciousMatch) {
        suspiciousLifecycleScripts.push({
          ...script,
          token: suspiciousMatch
        });
      }

      const nativeBuildMatch = findNativeBuildToken(script.command);
      if (nativeBuildMatch) {
        nativeBuildIndicators.add(`${packageName} via ${nativeBuildMatch}`);
      }
    }

    if (pkg.gypfile === true) {
      nativeBuildIndicators.add(`${packageName} via gypfile`);
    }
  }

  return {
    packagesScanned: packageDirs.length,
    lifecycleScripts,
    suspiciousLifecycleScripts,
    nativeBuildIndicators: Array.from(nativeBuildIndicators).sort()
  };
}

function collectInstalledPackageDirs(nodeModulesDir) {
  const packageDirs = [];
  const stack = [nodeModulesDir];

  while (stack.length > 0) {
    const currentNodeModulesDir = stack.pop();
    const entries = safeReadDir(currentNodeModulesDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === ".bin") {
        continue;
      }

      if (entry.name.startsWith("@")) {
        const scopeEntries = safeReadDir(path.join(currentNodeModulesDir, entry.name));
        for (const scopedEntry of scopeEntries) {
          if (!scopedEntry.isDirectory()) {
            continue;
          }

          const packageDir = path.join(currentNodeModulesDir, entry.name, scopedEntry.name);
          packageDirs.push(packageDir);

          const nestedNodeModulesDir = path.join(packageDir, "node_modules");
          if (fs.existsSync(nestedNodeModulesDir)) {
            stack.push(nestedNodeModulesDir);
          }
        }

        continue;
      }

      const packageDir = path.join(currentNodeModulesDir, entry.name);
      packageDirs.push(packageDir);

      const nestedNodeModulesDir = path.join(packageDir, "node_modules");
      if (fs.existsSync(nestedNodeModulesDir)) {
        stack.push(nestedNodeModulesDir);
      }
    }
  }

  return packageDirs;
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findSuspiciousToken(command) {
  for (const pattern of SUSPICIOUS_SCRIPT_PATTERNS) {
    const matched = command.match(pattern);
    if (matched) {
      return matched[0].trim();
    }
  }

  return null;
}

function findNativeBuildToken(command) {
  for (const pattern of NATIVE_BUILD_SCRIPT_PATTERNS) {
    const matched = command.match(pattern);
    if (matched) {
      return matched[0].trim();
    }
  }

  return null;
}

function scanLockfile(projectDir) {
  const lockfilePath = findLockfilePath(projectDir);

  if (!lockfilePath) {
    return {
      packagesScanned: 0,
      installScripts: [],
      sourceRisks: []
    };
  }

  const lockfile = readJson(lockfilePath);
  const packages = collectLockfilePackages(lockfile);
  const installScripts = [];
  const sourceRisks = [];

  for (const pkg of packages) {
    if (pkg.hasInstallScript) {
      installScripts.push({
        packageName: pkg.packageName,
        path: pkg.path,
        sourceType: classifyLockfileSource(pkg) || "registry"
      });
    }

    const sourceType = classifyLockfileSource(pkg);
    if (!sourceType) {
      continue;
    }

    sourceRisks.push({
      packageName: pkg.packageName,
      path: pkg.path,
      sourceType,
      resolved: pkg.resolved || null,
      version: pkg.version || null
    });
  }

  return {
    packagesScanned: packages.length,
    installScripts,
    sourceRisks
  };
}

function findLockfilePath(projectDir) {
  for (const fileName of LOCKFILE_NAMES) {
    const filePath = path.join(projectDir, fileName);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function collectLockfilePackages(lockfile) {
  if (lockfile.packages && typeof lockfile.packages === "object") {
    return Object.entries(lockfile.packages)
      .filter(([packagePath]) => packagePath !== "")
      .map(([packagePath, entry]) => ({
        path: packagePath,
        packageName: entry.name || packageNameFromLockfilePath(packagePath),
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        link: Boolean(entry.link),
        hasInstallScript: Boolean(entry.hasInstallScript)
      }));
  }

  if (lockfile.dependencies && typeof lockfile.dependencies === "object") {
    const packages = [];
    walkLegacyLockfileDependencies(lockfile.dependencies, packages);
    return packages;
  }

  return [];
}

function walkLegacyLockfileDependencies(dependencies, result, parentPath = "") {
  for (const [packageName, entry] of Object.entries(dependencies)) {
    const packagePath = parentPath ? `${parentPath}/node_modules/${packageName}` : `node_modules/${packageName}`;

    result.push({
      path: packagePath,
      packageName,
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      link: Boolean(entry.link),
      hasInstallScript: Boolean(entry.hasInstallScript)
    });

    if (entry.dependencies && typeof entry.dependencies === "object") {
      walkLegacyLockfileDependencies(entry.dependencies, result, packagePath);
    }
  }
}

function packageNameFromLockfilePath(packagePath) {
  const marker = "node_modules/";
  const lastIndex = packagePath.lastIndexOf(marker);

  if (lastIndex === -1) {
    return path.basename(packagePath);
  }

  return packagePath.slice(lastIndex + marker.length);
}

function classifyLockfileSource(pkg) {
  if (pkg.link) {
    return "local-link";
  }

  const candidates = [pkg.version, pkg.resolved].filter(Boolean);
  for (const candidate of candidates) {
    const sourceType = classifySourceFromText(candidate);
    if (!sourceType) {
      continue;
    }

    if (sourceType === "remote-tarball" && looksLikeRegistryResolved(pkg.resolved)) {
      continue;
    }

    return sourceType;
  }

  return null;
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

function sourceRiskFamily(sourceType) {
  if (sourceType === "local-file" || sourceType === "local-link") {
    return "local";
  }

  return sourceType;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function looksLikeRegistryResolved(resolved) {
  if (typeof resolved !== "string") {
    return false;
  }

  return resolved === "registry.npmjs.org" || resolved.includes("registry.npmjs.org/") || resolved.includes("/-/");
}

function hasNpmLockfile(projectDir) {
  return LOCKFILE_NAMES.some((fileName) =>
    fs.existsSync(path.join(projectDir, fileName))
  );
}

function hasNodeModules(projectDir) {
  return fs.existsSync(path.join(projectDir, "node_modules"));
}

module.exports = {
  EMPTY_DEPENDENCY_SIGNALS,
  scanProject,
  resolveScanMode,
  findDependenciesMatching,
  findLifecycleScripts,
  findDirectSourceRisks,
  findNativeBuildIndicators,
  findSuspiciousLifecycleScripts,
  scanLockfile,
  scanInstalledDependencies,
  hasNodeModules,
  hasNpmLockfile
};
