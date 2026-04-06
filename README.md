# SISP

Simple install security pre-scan for npm projects.

Current scope is intentionally small: SISP reads `package.json`, `package-lock.json`, and optionally `node_modules`, then returns a simple verdict before or after you run `npm install`.

## v0 Scope

- Scan `preinstall`, `install`, `postinstall`, and `prepare` scripts
- Flag suspicious install commands such as `curl`, `wget`, `bash`, or `node -e`
- Flag git-based dependencies
- Flag local `file:` and `link:` dependencies
- Flag native build indicators such as `node-gyp`
- Warn when no npm lockfile exists
- If `node_modules` already exists, inspect installed dependencies for `preinstall`, `install`, and `postinstall` scripts
- If `package-lock.json` exists, read `hasInstallScript` and source type signals such as `git`, `file:`, `link:`, and remote tarball specs

## Usage

```bash
node ./bin/sisp.js
node ./bin/sisp.js --json
node ./bin/sisp.js --before
node ./bin/sisp.js --after
node ./bin/sisp.js ./some-project
```

After installing the package locally or globally:

```bash
sisp
sisp before
sisp after
sisp after ./some-project
```

## Global Install

For local development:

```bash
npm link
```

For a direct global install:

```bash
npm install -g /path/to/sisp
```

## Scan Modes

- `before`: checks project metadata and lockfile signals before install
- `after`: also inspects installed dependencies inside `node_modules`
- `auto`: default mode; uses `after` if `node_modules` exists, otherwise `before`

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

```bash
npm test
```

## Releases

- GitHub Releases can use auto-generated release notes through `.github/release.yml`
- Release history is tracked in `CHANGELOG.md`

Project notes and earlier architecture ideas are in `structure.md` and `structure/`.
