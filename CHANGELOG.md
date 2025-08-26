# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial FlakeGuard implementation with comprehensive CI/CD pipeline
- GitHub Actions workflows for lint, test, and release automation
- Docker multi-stage builds with security scanning
- Semantic versioning and automated changelog generation
- Blue-green deployment strategy for production releases

### Changed
- N/A

### Deprecated
- N/A

### Removed
- N/A

### Fixed
- N/A

### Security
- N/A

---

## Guidelines

### Types of Changes
- **Added** for new features.
- **Changed** for changes in existing functionality.
- **Deprecated** for soon-to-be removed features.
- **Removed** for now removed features.
- **Fixed** for any bug fixes.
- **Security** in case of vulnerabilities.

### Versioning Strategy

This project follows [Semantic Versioning (SemVer)](https://semver.org/):

- **MAJOR** version when you make incompatible API changes
- **MINOR** version when you add functionality in a backwards compatible manner
- **PATCH** version when you make backwards compatible bug fixes

### Release Candidate and Pre-release Tags

- **Alpha releases**: `X.Y.Z-alpha.N` - Early development versions
- **Beta releases**: `X.Y.Z-beta.N` - Feature-complete but may contain bugs
- **Release Candidates**: `X.Y.Z-rc.N` - Stable candidates for final release

### Changelog Maintenance

This changelog is automatically updated during the release process via GitHub Actions.
The release workflow:

1. Analyzes commit messages since the last release
2. Groups changes by conventional commit types
3. Updates this changelog with the new version entry
4. Creates a GitHub release with formatted release notes

### Contributing to the Changelog

When contributing, please use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Examples:
- `feat: add GitHub webhook endpoint for check runs`
- `fix: resolve flaky test detection algorithm edge case`
- `docs: update README with deployment instructions`
- `perf: optimize JUnit report parsing performance`
- `refactor: restructure policy engine architecture`
- `test: add integration tests for worker components`
- `build: update Docker base images to Node 20`
- `ci: improve release workflow error handling`

### Links and References

- [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Releases](https://github.com/flakeguard/flakeguard/releases)
- [Docker Images](https://github.com/orgs/flakeguard/packages)