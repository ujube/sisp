# SISP

SISP is a lightweight npm install wrapper that checks dependency metadata before install and scans the project again after install.

Instead of running plain `npm install`, you can let SISP inspect the packages involved, flag install-time risk signals, continue with `npm install` when the result looks acceptable, and then show you the post-install state of the project.

## Install

Global install from GitHub:

```bash
npm install -g github:ujube/sisp
```

## Main Workflow

Install the dependencies already listed in the current project's `package.json`:

```bash
sisp install
```

Check a package first without changing the project:

```bash
sisp install package-name --dry-run
```

Install a specific package through SISP:

```bash
sisp install package-name
```

Forward extra npm install flags after `--`:

```bash
sisp install package-name -- --save-dev
```

## How `sisp install` Works

1. SISP decides which packages this install would use.
2. It reads npm metadata for those packages before install.
3. It checks source type, install scripts, suspicious install commands, native build signals, repository metadata, integrity metadata, and dependency source risks.
4. If the result is blocking, `npm install` does not start.
5. If the result is acceptable, SISP runs `npm install`.
6. After install finishes, SISP scans the project again and shows the resulting state.

This means one command can cover both:
- the package you are about to install
- the project state after install finishes

## Scan Commands

SISP still supports direct project scans when you want them:

```bash
sisp scan
sisp scan before
sisp scan after
sisp before
sisp after
```

Scan another project:

```bash
sisp scan before /path/to/project
sisp scan after /path/to/project
```

JSON output:

```bash
sisp install --json
sisp scan after --json
```

Scan modes:
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
- In `sisp install`, read npm metadata for the packages involved before install starts
- In `sisp install`, flag non-standard package specs such as `git`, `file:`, `link:`, aliases, or direct tarballs
- In `sisp install`, inspect published install scripts, native build indicators, missing repository URLs, integrity metadata, and dependency source risks before install

## Example Output

```text
SISP install
Target: /path/to/project
Requested scope: current project dependencies (2 direct)
Decision: Review these packages before continuing
Risk level: REVIEW (0.35)

What this means:
SISP checked the packages this install would use before running npm install. No blocking signals were found.

What SISP found:
- Packages in this install request run code during install: esbuild@0.28.0 (postinstall).
- Some packages in this install request do not publish a source repository URL: example-package@1.2.3.

What to do next:
- Let npm install finish, then read the post-install scan that follows.
- If a package looks unfamiliar, inspect its npm metadata and published repository before keeping it in the project.
- Use --dry-run first when you want the install decision without changing dependencies.
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
