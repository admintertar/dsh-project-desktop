# Official runtime dependency locks

These locks materialize the local core tarballs produced by the fixed DeepSeek
source in `official-source.lock.json`. They also pin the external npm packages
that the official Desktop preparation script normally resolves from ranges.

Each target's `inputs.json` binds its lock to the official commit, exact tarball
set, Electron Node version and pnpm version. Preparation checks these values and
then uses `--prod --frozen-lockfile --trust-lockfile` in a new install directory.
A missing or mismatched lock fails before dependency installation; it never
silently resolves a newer graph.

The initial `mac-arm64` lock was generated with official
`createRuntimeProjectMetadata` and pnpm 11.7.0 `install --lockfile-only`, then
checked with official `verifyDesktopCoreLockfile`. Other targets still require
lock generation and native verification before being added here. Updates must
regenerate the core tarballs and target lock together, review their diff, and
rerun the native payload/Host/Office and relocation checks.

This is an unsigned development runtime input. It does not change the released
Stable application, its updater, or the formal Shell build/packaging entry.
