# 📦 Safe Install – Project Structure

> Run `npm install` inside a sandbox before trusting your dependencies.

---

## 🧠 Overview

Safe Install is a CLI tool that:

1. Runs dependency installation inside a **sandbox (Docker)**
2. Monitors behavior (scripts, network, file access)
3. Generates a **risk score**
4. Decides:

   * ✅ Allow → run real install
   * ⚠️ Warn → user decision
   * ❌ Block → stop execution

---

## 🏗️ Architecture

```
User
  ↓
safe-install CLI
  ↓
Pre-Scan (Static Analysis)
  ↓
Sandbox (Docker)
  ↓
Runtime Monitor
  ↓
Risk Engine
  ↓
Decision Engine
  ↓
Real Install (npm ci)
```

---

## 📁 Folder Structure

```
/safe-install
  /cli
    index.js              # CLI entry point
    commands.js           # CLI command parser

  /core
    preScan.js            # package.json analysis
    sandbox.js            # Docker runner
    monitor.js            # runtime logging
    riskEngine.js         # scoring logic
    decisionEngine.js     # allow/block logic

  /sandbox
    Dockerfile            # minimal sandbox image
    runner.sh             # container entry script

  /utils
    logger.js             # log formatter
    fileDiff.js           # before/after comparison
    networkProxy.js       # optional proxy layer

  /config
    rules.json            # risk patterns
    allowlist.json        # safe domains

  /reports
    report.json           # output (generated)
    report.html           # optional UI report

  safe-install.js         # main executable
  package.json
  README.md
```

---

## ⚙️ Core Modules

### 1. PreScan (Static Analysis)

* Detects:

  * `postinstall`, `preinstall`
  * suspicious scripts
  * known risky patterns

---

### 2. Sandbox (Docker)

Runs install inside isolated container:

* non-root user
* read-only filesystem
* limited writable temp
* optional network restriction

---

### 3. Monitor (Runtime)

Tracks:

* executed scripts
* child processes
* file access (diff)
* network attempts

---

### 4. Risk Engine

Example scoring:

```
score =
  (postinstall * 0.3) +
  (network_call * 0.3) +
  (fs_sensitive * 0.2) +
  (obfuscation * 0.2)
```

---

### 5. Decision Engine

```
if (score > 0.7) → BLOCK
if (score > 0.4) → WARN
else → ALLOW
```

---

## 🐳 Sandbox Design

### Container Rules

* `--read-only`
* `--network none` OR restricted proxy
* `--cap-drop all`
* `--security-opt no-new-privileges`
* tmpfs writable dirs:

  * `/tmp`
  * `/app/node_modules`

---

### Mount Strategy

| Path         | Mode             |
| ------------ | ---------------- |
| Project      | read-only        |
| node_modules | writable (tmpfs) |
| logs         | writable         |

---

## 🔁 Execution Flow

```
1. Load project
2. Run PreScan
3. Copy to temp sandbox
4. Start Docker container
5. Run npm install inside sandbox
6. Monitor behavior
7. Generate report
8. Score risk
9. Decision:
   - allow → npm ci (real)
   - block → exit
```

---

## 📊 Example Report

```
{
  "package": "unknown-lib",
  "scripts": ["postinstall"],
  "network": ["185.x.x.x"],
  "file_access": [".env"],
  "score": 0.82,
  "decision": "BLOCK"
}
```

---

## 🚀 CLI Usage

```
node safe-install.js
```

or

```
node safe-install.js npm install
```

---

## 🔒 Limitations

* Not 100% secure (no tool is)
* Depends on Docker isolation
* Advanced attacks may bypass detection

---

## 🔥 Roadmap

### v1

* Static scan
* Docker sandbox
* Basic scoring

### v2

* Network proxy allowlist
* HTML reports
* CI integration

### v3

* eBPF syscall tracking
* AI-based anomaly detection

---

## 🎯 Goal

> Detect what dependencies *do*, not just what they *are*.
