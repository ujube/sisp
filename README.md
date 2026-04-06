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

Preflight-check a package before installing it:

```bash
sisp install package-name --dry-run
```

Check first, then let SISP run `npm install` and follow it with a post-install scan:

```bash
sisp install package-name
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

Forward npm install flags after `--`:

```bash
sisp install package-name -- --save-dev
```

## Scan Modes

- `before`: checks project metadata and lockfile signals before install
- `after`: also inspects installed dependencies inside `node_modules`
- `auto`: default mode; uses `after` if `node_modules` exists, otherwise `before`

## Install Preflight

- `sisp install <package-spec...>` checks npm registry metadata before running `npm install`
- `--dry-run` stops after the preflight report and does not change your project
- Blocking findings stop the install
- Review findings are shown in the report, but `npm install` still runs in this v1 workflow
- Use `--` to forward extra npm install flags such as `--save-dev`

## What It Checks

- Scan `preinstall`, `install`, `postinstall`, and `prepare` scripts
- Flag suspicious install commands such as `curl`, `wget`, `bash`, or `node -e`
- Flag non-standard dependency sources such as `git`, `file:`, `link:`, and remote tarballs
- Flag native build indicators such as `node-gyp`
- Warn when no npm lockfile exists
- If `node_modules` already exists, inspect installed dependencies for `preinstall`, `install`, and `postinstall` scripts
- If `package-lock.json` exists, read `hasInstallScript` and source type signals such as `git`, `file:`, `link:`, and remote tarball specs
- In `sisp install`, read npm metadata for the requested packages before install
- In `sisp install`, flag requested package specs that use non-standard sources such as `git`, `file:`, `link:`, aliases, or direct tarballs
- In `sisp install`, inspect published install scripts, native build indicators, missing repository URLs, integrity metadata, and dependency source risks before install

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
