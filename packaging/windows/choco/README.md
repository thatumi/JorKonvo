# Chocolatey package (`jorkonvo`)

Downloads and silently runs the NSIS installer from the Forgejo release
(`windows-v<version>`), same pattern as `packaging/linux/aur/jorkonvo-bin`:
a thin wrapper around the already-published installer, not a rebuild.

## Update on every release

1. `jorkonvo.nuspec`: bump `<version>`.
2. `tools/chocolateyinstall.ps1`: bump the version in `$url64`, and set
   `$checksum64` from the release's `SHA256SUMS`.

## Publish (not yet done - needs a chocolatey.org account)

```
choco pack packaging/windows/choco/jorkonvo.nuspec
choco apikey --key <your-api-key> --source https://push.chocolatey.org/
choco push jorkonvo.0.1.5.nupkg --source https://push.chocolatey.org/
```

Community-repo moderation includes an automated AV scan of the installer;
since it's unsigned, expect that scan to take longer or need a manual
false-positive dispute the first time. A code-signing certificate (tracked
in `.hub/status.json`) would remove this friction.

`choco pack`/`choco push` need the actual Chocolatey CLI, which is
Windows-only - there is no Linux client, so this can't be test-packed on
this box. The `.nuspec`/`.ps1` were validated for XML/PowerShell syntax
only; do a real `choco pack` + local `choco install -s . jorkonvo` test on
a Windows machine before the first real push.
