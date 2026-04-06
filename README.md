# SISP

SISP is a lightweight npm install wrapper for JavaScript projects.

Its main job is simple:
- check the packages involved before `npm install` runs
- let the install continue only when the result looks acceptable
- scan the project again after install finishes

In normal use, SISP replaces the install step. Instead of typing `npm install`, you type `sisp install`.

## Global Setup

Install SISP globally from GitHub once:

```bash
npm install -g github:ujube/sisp
```

After that, the `sisp` command is available in your terminal.

## Main Usage

### 1. Install an existing project's dependencies

Go into the project directory:

```bash
cd /path/to/project
```

Instead of this:

```bash
npm install
```

use this:

```bash
sisp install
```

What happens:
1. SISP reads the direct dependencies from the current project's `package.json`.
2. It checks npm metadata for the packages that would be installed.
3. It looks for install-time risk signals.
4. If the result is blocking, install stops.
5. If the result is acceptable, SISP runs `npm install`.
6. After install finishes, SISP runs a post-install scan and prints the result.

After `sisp install` completes, run the project's normal command as usual:

```bash
npm run dev
```

or:

```bash
npm start
```

SISP replaces the install step. It does not replace your project's normal run, build, or start scripts.

### 2. Check first without changing the project

If you want the install decision first:

```bash
sisp install --dry-run
```

This checks the install request but does not run `npm install`.

### 3. Install a specific package through SISP

If you want to add one package:

```bash
sisp install package-name
```

SISP checks that package first, then runs:

```bash
npm install package-name
```

If you only want to inspect it first:

```bash
sisp install package-name --dry-run
```

### 4. Install a package with npm flags

Forward npm install flags after `--`:

```bash
sisp install package-name -- --save-dev
```

That means SISP checks the package first, then runs:

```bash
npm install package-name --save-dev
```

## What `sisp install` Checks

Before install:
- npm metadata for the packages involved
- install scripts such as `preinstall`, `install`, and `postinstall`
- suspicious commands such as `curl`, `wget`, `bash`, `sh -c`, `node -e`, or `powershell`
- non-standard sources such as `git`, `file:`, `link:`, aliases, and direct tarballs
- native build indicators such as `node-gyp`, `prebuild-install`, and similar tooling
- missing repository metadata
- missing integrity metadata
- dependency source risks inside the package metadata

After install:
- project scripts and lockfile signals
- installed dependency install scripts inside `node_modules`
- installed dependency native build signals
- non-standard source signals from the lockfile

## Command Summary

Main workflow:

```bash
sisp install
sisp install --dry-run
sisp install package-name
sisp install package-name --dry-run
sisp install package-name -- --save-dev
```

Manual scan commands:

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
- Packages in this install request run code during install: example-package@1.2.3 (postinstall).
- Some packages in this install request do not publish a source repository URL: example-package@1.2.3.

What to do next:
- Let npm install finish, then read the post-install scan that follows.
- If a package looks unfamiliar, inspect its npm metadata and published repository before keeping it in the project.
- Use --dry-run first when you want the install decision without changing dependencies.
```

## Direct Scan Modes

If you want to use SISP only as a scanner, these modes still exist:

- `before`: checks project metadata and lockfile signals before install
- `after`: also inspects installed dependencies inside `node_modules`
- `auto`: default mode; uses `after` if `node_modules` exists, otherwise `before`

These are useful for manual review, but the main user workflow is still `sisp install`.

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
