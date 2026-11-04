<#
.SYNOPSIS
  Installs the TabSearch native vertical-tabs integration into Firefox.

.DESCRIPTION
  Copies the Autoconfig loader and chrome integration next to firefox.exe and
  adds a single defaults/pref file that points Firefox at the loader. It does
  not change user preferences or profile data. Administrator rights are
  required because Firefox is normally installed under Program Files.

.PARAMETER FirefoxDir
  Optional Firefox application directory (the folder containing firefox.exe).

.PARAMETER Force
  Reinstall/overwrite TabSearch's own integration files. Files belonging to a
  different Autoconfig/userChrome setup are never overwritten.
#>
param(
  [string]$FirefoxDir = "",
  [switch]$Force
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
if (-not (Test-Path $prefDir)) {
  Fail "Could not find defaults\pref in the Firefox directory."
}

$ours = "zz-tabsearch-autoconfig.js"
$existingAutoconfig = @()
Get-ChildItem -Path $prefDir -Filter "*.js" -File | ForEach-Object {
  if ($_.Name -ne $ours) {
    $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -match 'general\.config\.filename') {
      $existingAutoconfig += $_.FullName
    }
  }
}

if ($existingAutoconfig.Count -gt 0) {
  Write-Host ""
  Write-Host "An existing Autoconfig setup was found:" -ForegroundColor Yellow
  $existingAutoconfig | ForEach-Object { Write-Host "  $_" }
  Write-Host ""
  Write-Host "Firefox supports only one general.config.filename." -ForegroundColor Yellow
  Write-Host "To avoid breaking it, this installer will NOT overwrite it." -ForegroundColor Yellow
  Write-Host "Merge these lines into your existing config instead:"
  Write-Host '  pref("general.config.obscure_value", 0);'
  Write-Host '  pref("general.config.filename", "tabsearch-autoconfig.cfg");'
  Write-Host "Then copy config.js and tabsearch-native-tabs.js as described in README.md."
  exit 2
}

$sources = @{
  "config.js"           = "tabsearch-autoconfig.cfg"
  "autoconfig-prefs.js" = "defaults\pref\zz-tabsearch-autoconfig.js"
}

$targets = @(
  (Join-Path $FirefoxDir "tabsearch-autoconfig.cfg"),
  (Join-Path $FirefoxDir "tabsearch-native-tabs.js"),
  (Join-Path $prefDir $ours)
)

$anyExisting = $false
foreach ($target in $targets) {
  if (Test-Path $target) { $anyExisting = $true }
}
if ($anyExisting -and -not $Force) {
  Fail "TabSearch integration files already exist. Use -Force to reinstall them (a backup is created)."
}

$backupDir = $null
if ($anyExisting) {
  $backupDir = Join-Path $FirefoxDir ("tabsearch-native-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $backupDir | Out-Null
  foreach ($target in $targets) {
    if (Test-Path $target) {
      $relative = $target.Substring($FirefoxDir.Length).TrimStart('\')
      $destination = Join-Path $backupDir $relative
      New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $destination -Force
    }
  }
  Write-Host "Backup created: $backupDir"
}

foreach ($sourceName in $sources.Keys) {
  $source = Join-Path $PSScriptRoot $sourceName
  if (-not (Test-Path $source)) {
    Fail "Missing package file: $source"
  }
  $destination = Join-Path $FirefoxDir $sources[$sourceName]
  New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Host "Installed: $destination"
}

# Remove a file installed by older integration versions; the current config.js
# is self-contained and no longer loads a separate subscript.
$legacyScript = Join-Path $FirefoxDir "tabsearch-native-tabs.js"
if (Test-Path $legacyScript) {
  Remove-Item -LiteralPath $legacyScript -Force
  Write-Host "Removed legacy file: $legacyScript"
}

Write-Host ""
Write-Host "TabSearch native panel integration installed." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Install/enable TabSearch 0.9.0 or newer in Firefox."
Write-Host "  2. Enable native vertical tabs (Firefox Settings > Appearance, or the sidebar)."
Write-Host "  3. Quit Firefox completely and start it again."
Write-Host ""
Write-Host "To remove it, run uninstall.ps1 as Administrator."
