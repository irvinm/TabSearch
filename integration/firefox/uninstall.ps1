<#
.SYNOPSIS
  Removes the TabSearch native vertical-tabs integration from Firefox.

.DESCRIPTION
  Deletes the Autoconfig loader, the chrome integration and the defaults/pref
  pointer. If a TabSearch backup directory is present, its files are restored.
  User preferences and profile data are never touched.

.PARAMETER FirefoxDir
  Optional Firefox application directory (the folder containing firefox.exe).
#>
param(
  [string]$FirefoxDir = ""
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail "Administrator rights are required. Right-click PowerShell and choose 'Run as administrator'."
}

$candidates = @()
if ($FirefoxDir) { $candidates += $FirefoxDir }
$candidates += @(
  (Join-Path $env:ProgramFiles "Mozilla Firefox"),
  (Join-Path $env:ProgramFiles "Firefox Nightly"),
  (Join-Path ${env:ProgramFiles(x86)} "Mozilla Firefox"),
  (Join-Path ${env:ProgramFiles(x86)} "Firefox Nightly")
)

$FirefoxDir = $null
foreach ($candidate in $candidates) {
  if ($candidate -and (Test-Path (Join-Path $candidate "firefox.exe"))) {
    $FirefoxDir = (Resolve-Path $candidate).Path
    break
  }
}
if (-not $FirefoxDir) {
  Fail "Could not find firefox.exe. Pass -FirefoxDir 'C:\Program Files\Firefox Nightly'."
}

Write-Host "Firefox directory: $FirefoxDir"

$prefDir = Join-Path $FirefoxDir "defaults\pref"
$targets = @(
  (Join-Path $FirefoxDir "tabsearch-autoconfig.cfg"),
  (Join-Path $FirefoxDir "tabsearch-native-tabs.js"),
  (Join-Path $prefDir "zz-tabsearch-autoconfig.js")
)

foreach ($target in $targets) {
  if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Force
    Write-Host "Removed: $target"
  }
}

$backups = Get-ChildItem -Path $FirefoxDir -Directory -Filter "tabsearch-native-backup-*" |
  Sort-Object LastWriteTime -Descending
if ($backups.Count -gt 0) {
  $backup = $backups[0].FullName
  Write-Host "Restoring backup: $backup"
  Get-ChildItem -Path $backup -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($backup.Length).TrimStart('\')
    $destination = Join-Path $FirefoxDir $relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    Write-Host "Restored: $destination"
  }
}

Write-Host ""
Write-Host "TabSearch native panel integration removed." -ForegroundColor Green
Write-Host "Quit Firefox completely and start it again to restore the original tab strip."
