# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [0.2.0] - 2026-04-06

### Added

- `sisp install [package-spec...]` as the main install workflow for project installs and single-package installs
- `--dry-run` support for install checks without changing the target project
- Post-install follow-up scan after `sisp install` completes
- `sisp scan` subcommand as a grouped form of the existing project scan modes

### Changed

- CLI help and README now present `sisp install` as the primary user workflow
- Install output is now presented as one install flow instead of a separate check phase

## [0.1.0] - 2026-04-06

### Added

- Initial SISP CLI for npm install risk scanning
- Before-install and after-install scan modes
- Human-readable CLI output for install risk decisions
- Lockfile scanning for install scripts and non-standard dependency sources
- Installed dependency scanning for install scripts and native build signals
- Test fixtures and CLI formatting coverage
