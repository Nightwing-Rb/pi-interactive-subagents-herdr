# Bootstrap this machine's pi setup from the repo into ~/.pi/agent.
#
#   powershell -ExecutionPolicy Bypass -File setup\bootstrap.ps1 [-Patches] [-SkipPackages]
#
# -Patches      also run setup/patches/apply-pi-patches.mjs (pi 1.4.0 cosmetic tweaks)
# -SkipPackages skip the `pi install` calls (config copy only)
#
# Safe to re-run: config files are overwritten (existing settings.json is
# backed up first), auth.json / sessions are never touched.

param(
    [switch]$Patches,
    [switch]$SkipPackages
)

$ErrorActionPreference = "Stop"

$SetupDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $SetupDir
$SrcDir   = Join-Path $SetupDir "agent"
$AgentDir = Join-Path $env:USERPROFILE ".pi\agent"

Write-Host "== pi machine setup bootstrap ==" -ForegroundColor Cyan
Write-Host ("  repo:     " + $RepoRoot)
Write-Host ("  agent:    " + $AgentDir)

# --- 1. pi must be available ------------------------------------------------
if (-not (Get-Command pi -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $AgentDir "bin"))) {
    $env:Path += ";" + (Join-Path $AgentDir "bin")
}
if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "pi not found on PATH. Install it first:" -ForegroundColor Yellow
    Write-Host "  curl -fsSL https://pi.dev/install.sh | sh                      (Git Bash)"
    Write-Host "  npm install -g --ignore-scripts @earendil-works/pi-coding-agent (Node >= 22.19)"
    exit 1
}
Write-Host ("  pi:       " + (& pi --version 2>$null))

# --- 2. copy config tree ----------------------------------------------------
New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null

# back up an existing settings.json before overwriting it
$settingsDest = Join-Path $AgentDir "settings.json"
if (Test-Path $settingsDest) {
    $backup = "settings.json.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    Copy-Item $settingsDest (Join-Path $AgentDir $backup)
    Write-Host ("  backed up settings.json -> " + $backup) -ForegroundColor DarkGray
}

Get-ChildItem -Path $SrcDir -Force | Where-Object { $_.Name -ne ".gitignore" } | ForEach-Object {
    if ($_.PSIsContainer) {
        Copy-Item -Path $_.FullName -Destination $AgentDir -Recurse -Force
    } else {
        Copy-Item -Path $_.FullName -Destination $AgentDir -Force
    }
    Write-Host ("  copied   " + $_.Name)
}

# --- 3. bash-guard runtime dependency --------------------------------------
$bashGuard = Join-Path $AgentDir "extensions\bash-guard"
if ((Test-Path (Join-Path $bashGuard "package.json")) -and -not (Test-Path (Join-Path $bashGuard "node_modules\shell-quote"))) {
    Push-Location $bashGuard
    try {
        Write-Host "  npm install (bash-guard/shell-quote)..."
        npm install --omit=dev --no-audit --no-fund | Out-Null
    } finally {
        Pop-Location
    }
}

# --- 4. packages: npm ones from settings + this clone as the subagent ext ---
if (-not $SkipPackages) {
    foreach ($spec in @("npm:pi-compact-tools", "npm:donsetch", $RepoRoot)) {
        Write-Host ("  pi install " + $spec)
        & pi install $spec
        if ($LASTEXITCODE -ne 0) {
            Write-Host ("    (warning) non-zero exit for " + $spec + " - check pi list") -ForegroundColor Yellow
        }
    }
}

# --- 5. optional pi 1.4.0 cosmetic patches ---------------------------------
if ($Patches) {
    Write-Host "  applying pi cosmetic patches..."
    node (Join-Path $SetupDir "patches\apply-pi-patches.mjs")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (warning) some patches not found - see output above" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  1. Start pi, run /login xiaomi    (credentials are NOT part of the repo)"
Write-Host "  2. /reload (or restart pi) to load all extensions"
Write-Host "  3. Try:  /subagent scout ""list the top-level files of this repo"""
Write-Host "  Details: setup\README.md"
