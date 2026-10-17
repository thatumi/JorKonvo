$ErrorActionPreference = 'Stop'

$packageName = 'jorkonvo'
$key = Get-UninstallRegistryKey -SoftwareName 'JorKonvo*'

if ($key.Count -eq 1) {
  $key | ForEach-Object {
    $uninstPath = $_.UninstallString
    Uninstall-ChocolateyPackage -PackageName $packageName `
      -FileType 'exe' `
      -SilentArgs '/S' `
      -File $uninstPath `
      -ValidExitCodes @(0)
  }
} elseif ($key.Count -eq 0) {
  Write-Warning "$packageName has already been uninstalled."
} else {
  Write-Warning "$($key.Count) matches found for $packageName; cannot determine which one to uninstall."
}
