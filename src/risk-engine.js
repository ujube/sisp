const RISK_WEIGHTS = {
  lifecycleScripts: 0.35,
  suspiciousLifecycleScripts: 0.4,
  nativeBuildIndicators: 0.15,
  dependencyLifecycleScripts: 0.25,
  dependencySuspiciousLifecycleScripts: 0.35,
  dependencyNativeBuildIndicators: 0.2,
  lockfileInstallScripts: 0.2,
  missingLockfile: 0.1
};

function evaluateRisk(analysis) {
  const reasons = [];
  let score = 0;

  if (analysis.lifecycleScripts.length > 0) {
    score += RISK_WEIGHTS.lifecycleScripts;
    reasons.push({
      code: "lifecycle-scripts",
      weight: RISK_WEIGHTS.lifecycleScripts,
      message: `Lifecycle scripts found: ${analysis.lifecycleScripts.map((item) => item.name).join(", ")}`
    });
  }

  if (analysis.suspiciousLifecycleScripts.length > 0) {
    score += RISK_WEIGHTS.suspiciousLifecycleScripts;
    reasons.push({
      code: "suspicious-lifecycle-script",
      weight: RISK_WEIGHTS.suspiciousLifecycleScripts,
      message: `Suspicious install command found: ${analysis.suspiciousLifecycleScripts.map(formatSuspiciousScript).join(", ")}`
    });
  }

  if (analysis.nativeBuildIndicators.length > 0) {
    score += RISK_WEIGHTS.nativeBuildIndicators;
    reasons.push({
      code: "native-build-indicators",
      weight: RISK_WEIGHTS.nativeBuildIndicators,
      message: `Native build indicators found: ${analysis.nativeBuildIndicators.join(", ")}`
    });
  }

  if (analysis.dependencyLifecycleScripts.length > 0) {
    score += RISK_WEIGHTS.dependencyLifecycleScripts;
    reasons.push({
      code: "dependency-lifecycle-scripts",
      weight: RISK_WEIGHTS.dependencyLifecycleScripts,
      message: `Installed dependencies with install scripts: ${formatDependencyScripts(analysis.dependencyLifecycleScripts)}`
    });
  }

  if (analysis.dependencySuspiciousLifecycleScripts.length > 0) {
    score += RISK_WEIGHTS.dependencySuspiciousLifecycleScripts;
    reasons.push({
      code: "dependency-suspicious-lifecycle-scripts",
      weight: RISK_WEIGHTS.dependencySuspiciousLifecycleScripts,
      message: `Installed dependencies with suspicious install commands: ${formatDependencyScripts(analysis.dependencySuspiciousLifecycleScripts)}`
    });
  }

  if (analysis.dependencyNativeBuildIndicators.length > 0) {
    score += RISK_WEIGHTS.dependencyNativeBuildIndicators;
    reasons.push({
      code: "dependency-native-build-indicators",
      weight: RISK_WEIGHTS.dependencyNativeBuildIndicators,
      message: `Installed dependencies with native build activity: ${formatList(analysis.dependencyNativeBuildIndicators)}`
    });
  }

  if (analysis.lockfileInstallScripts.length > 0 && analysis.dependencyLifecycleScripts.length === 0) {
    score += RISK_WEIGHTS.lockfileInstallScripts;
    reasons.push({
      code: "lockfile-install-scripts",
      weight: RISK_WEIGHTS.lockfileInstallScripts,
      message: `Lockfile packages that run install scripts: ${formatLockfilePackages(analysis.lockfileInstallScripts)}`
    });
  }

  const nonStandardSourceRisks = mergeSourceRisks(
    analysis.directSourceRisks,
    analysis.lockfileSourceRisks
  );
  if (nonStandardSourceRisks.length > 0) {
    const sourceRiskWeight = getSourceRiskWeight(nonStandardSourceRisks);
    score += sourceRiskWeight;
    reasons.push({
      code: "non-standard-source-risks",
      weight: sourceRiskWeight,
      message: `Dependencies from non-standard sources: ${formatSourceRisks(nonStandardSourceRisks)}`
    });
  }

  if (!analysis.hasLockfile) {
    score += RISK_WEIGHTS.missingLockfile;
    reasons.push({
      code: "missing-lockfile",
      weight: RISK_WEIGHTS.missingLockfile,
      message: "No package-lock.json or npm-shrinkwrap.json found"
    });
  }

  const normalizedScore = Math.min(1, score);

  return {
    score: normalizedScore,
    verdict: pickVerdict(normalizedScore),
    reasons
  };
}

function pickVerdict(score) {
  if (score >= 0.75) {
    return "BLOCK";
  }

  if (score >= 0.35) {
    return "REVIEW";
  }

  return "SAFE";
}

function formatSuspiciousScript(item) {
  return `${item.name} uses ${item.token}`;
}

function formatDependencyScripts(items) {
  return formatList(items.map((item) => `${item.packageName} (${item.name})`));
}

function formatLockfilePackages(items) {
  return formatList(items.map((item) => `${item.packageName}`));
}

function formatSourceRisks(items) {
  return formatList(items.map((item) => `${item.packageName} [${humanizeSourceType(item.sourceType)}]`));
}

function getSourceRiskWeight(items) {
  const typeWeights = {
    alias: 0.1,
    "local-file": 0.2,
    "local-link": 0.2,
    git: 0.25,
    "remote-tarball": 0.3
  };
  const maxWeight = items.reduce((highest, item) => {
    const itemWeight = typeWeights[item.sourceType] || 0.15;
    return Math.max(highest, itemWeight);
  }, 0);

  const quantityBump = Math.min(0.1, Math.max(0, items.length - 1) * 0.03);
  return maxWeight + quantityBump;
}

function mergeSourceRisks(directSourceRisks, lockfileSourceRisks) {
  const merged = [];
  const seen = new Set();

  for (const item of [...directSourceRisks, ...lockfileSourceRisks]) {
    const key = `${item.packageName}:${item.sourceType}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(item);
  }

  return merged;
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

function formatList(items, maxItems = 5) {
  const visibleItems = items.slice(0, maxItems);
  const remainingCount = items.length - visibleItems.length;

  if (remainingCount > 0) {
    return `${visibleItems.join(", ")} +${remainingCount} more`;
  }

  return visibleItems.join(", ");
}

module.exports = {
  RISK_WEIGHTS,
  evaluateRisk,
  pickVerdict
};
