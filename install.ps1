<#
.SYNOPSIS
  Installs the zed-hermes bridge for the current user and registers it in Zed.

.DESCRIPTION
  Checks Node.js and Hermes, writes %APPDATA%\zed-hermes\config.json on first
  run, and adds the agent to Zed's settings.json (with a backup).

.PARAMETER Revert
  Remove the agent entry from Zed's settings.json.

.PARAMETER NoZed
  Do not touch Zed's settings.json; print the snippet instead.

.PARAMETER Name
  Agent name to show in Zed. Default: Hermes.
#>
[CmdletBinding()]
param(
  [switch]$Revert,
  [switch]$NoZed,
  [string]$Name = 'Hermes'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

Write-Step 'Checking Node.js'
$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
  throw 'Node.js is required (>= 22). Install it from https://nodejs.org or nvm.'
}
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  throw "Node.js >= 22 is required, found $nodeVersion"
}
Write-Host "    node $nodeVersion"

if ($Revert) {
  if (-not $NoZed) {
    & node (Join-Path $Root 'scripts/register-zed.mjs') --revert --name $Name
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  Write-Host 'Reverted. The per-user config was left in place; delete it manually if you no longer need it.'
  exit 0
}

Write-Step 'Checking Hermes Agent'
$hermes = Get-Command hermes -ErrorAction SilentlyContinue
if (-not $hermes) {
  Write-Warning '`hermes` is not on PATH. Install Hermes Agent, or set a custom command in the bridge config.'
} else {
  Write-Host "    $($hermes.Source)"
  & hermes acp --version 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning '`hermes acp --version` failed. Install the ACP extra in the Hermes checkout:'
    Write-Host  '    python -c "import pm; pm.sync_venv([''acp''], explicit=True)"'
  }
}

Write-Step 'Writing per-user config'
$configDir = Join-Path $env:APPDATA 'zed-hermes'
$configPath = Join-Path $configDir 'config.json'
if (-not (Test-Path $configPath)) {
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  Copy-Item (Join-Path $Root 'config/zed-hermes.example.json') $configPath
  Write-Host "    $configPath"
} else {
  Write-Host "    kept existing $configPath"
}

if ($NoZed) {
  Write-Step 'Zed settings snippet (-NoZed)'
  & node (Join-Path $Root 'scripts/register-zed.mjs') --name $Name --print
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Step 'Registering the agent in Zed'
  & node (Join-Path $Root 'scripts/register-zed.mjs') --name $Name
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Could not update Zed settings automatically; paste the snippet printed above.'
  }
}

Write-Host ''
Write-Host 'Done. Open the Agent Panel, start a new Hermes thread, and type "/".'
Write-Host 'Verify end-to-end with: npm run probe'
