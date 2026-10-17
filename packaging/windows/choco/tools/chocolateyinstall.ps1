$ErrorActionPreference = 'Stop'

$packageName = 'jorkonvo'
$url64       = 'https://git.szabotar.dev/thatumi/JorKonvo/releases/download/windows-v0.1.5/JorKonvo_0.1.5_x64-setup.exe'
$checksum64  = 'e99cf8dad755548da1d95f54225ea74a88250b3904818ddf303465ece18cb668'

$packageArgs = @{
  packageName    = $packageName
  fileType       = 'exe'
  url64bit       = $url64
  checksum64     = $checksum64
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
