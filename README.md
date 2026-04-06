# SISP

A lightweight CLI that helps detect risky npm dependency behavior before and after install.

SISP reads `package.json`, `package-lock.json`, and optionally `node_modules`, then gives you a simple verdict before or after `npm install`.

## Install

Global install from GitHub:

```bash
npm install -g github:ujube/sisp
```

Then run:

```bash
sisp
```

## Quick Start

Before install:

```bash
sisp before
```

After install:

```bash
sisp after
```

Scan another project:

```bash
sisp before /path/to/project
sisp after /path/to/project
```

JSON output:

```bash
sisp after --json
```

## Scan Modes

- `before`: checks project metadata and lockfile signals before install
- `after`: also inspects installed dependencies inside `node_modules`
- `auto`: default mode; uses `after` if `node_modules` exists, otherwise `before`

## What It Checks

- Scan `preinstall`, `install`, `postinstall`, and `prepare` scripts
- Flag suspicious install commands such as `curl`, `wget`, `bash`, or `node -e`
- Flag non-standard dependency sources such as `git`, `file:`, `link:`, and remote tarballs
- Flag native build indicators such as `node-gyp`
- Warn when no npm lockfile exists
- If `node_modules` already exists, inspect installed dependencies for `preinstall`, `install`, and `postinstall` scripts
- If `package-lock.json` exists, read `hasInstallScript` and source type signals such as `git`, `file:`, `link:`, and remote tarball specs

## Example Output

```text
SISP scan: block-project
Target: /path/to/project
Decision: Stop and inspect before you install
Risk level: BLOCK (1.00)

What this means:
This project shows high-risk install behavior or dependency sources. That does not prove malware, but it is risky enough that you should stop and verify the changes before running install.

What SISP found:
- The project itself runs code during install: postinstall.
- The project has an install command that may fetch or execute code: postinstall uses curl.
- Some dependencies come from non-standard sources such as git, local paths, or direct tarballs: bad-lib [git].
- No npm lockfile was found, so install results may change more easily between runs.

What to do next:
- Check the new or changed dependencies in package.json and package-lock.json before running install.
- Look closely at packages that run install scripts or come from git, local paths, or direct tarball URLs.
- If these changes were not expected, stop here and inspect the dependency update in code review.
```

## Development

Run the test suite:

```bash
npm test
```

Link the local checkout as a global command while developing:

```bash
npm link
```

## Releases

- GitHub Releases can use auto-generated release notes through `.github/release.yml`
- Release history is tracked in `CHANGELOG.md`
