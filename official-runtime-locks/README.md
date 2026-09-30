# Official runtime dependency locks

These locks materialize the local core tarballs produced by the fixed DeepSeek
source in `official-source.lock.json`. They also pin the external npm packages
that the official Desktop preparation script normally resolves from ranges.

Each target's `inputs.json` binds its lock to the official commit, exact tarball
set, Electron Node version and pnpm version. Preparation checks these values and
then uses `--prod --frozen-lockfile --trust-lockfile` in a new install directory.
A missing or mismatched lock fails before dependency installation; it never
silently resolves a newer graph.

The lock covers all supported optional native packages (Darwin arm64/x64 and
Windows x64). Each target metadata binds that same reviewed dependency graph;
the release matrix must prove frozen installation and official payload/Host/Office
checks on its native runner before that target can be published. No target may
resolve a replacement lock during CI.

Runtime preparation is unsigned. Packaging independently verifies source identity,
collects the pinned Project plugin, applies product branding and local ad-hoc
macOS signing, and launches the relocated application before publication.
