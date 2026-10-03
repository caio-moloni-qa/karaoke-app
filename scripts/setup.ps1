# One-time setup of the karaoke app on a (new) Windows machine.
#
#   .\scripts\setup.ps1              check prerequisites, install, configure
#   .\scripts\setup.ps1 -CheckOnly   just report what's missing / would be done
#
# Safe to re-run: existing installs and settings are kept. What it does:
#   1. Checks Node.js, Python 3.11, ffmpeg, Docker Desktop, NVIDIA driver
#      (prints the winget command for anything missing, then stops).
#   2. npm install for the web app.
#   3. Worker Python environment (.venv) + packages; GPU build of PyTorch
#      when an NVIDIA card is present.
#   4. Starts Docker and the local database (Supabase), which creates the
#      tables from supabase\migrations.
#   5. Writes apps\web\.env.local and apps\worker\.env if missing: database
#      keys from the local Supabase, a generated worker secret. YouTube and
#      Spotify keys still have to be filled in by hand (see README).
# Then: start.cmd. To bring data from another machine: scripts\restore.ps1.
param([switch]$CheckOnly)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root "apps\web"
$worker = Join-Path $root "apps\worker"

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  ok   $msg" -ForegroundColor Green }
function Todo($msg) { Write-Host "  todo $msg" -ForegroundColor Yellow }
function Missing($msg) { Write-Host "  MISSING $msg" -ForegroundColor Red }

# See start.ps1: native stderr must not be fatal under "Stop".
function Native([scriptblock]$command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $command | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
}

function NativeOutput([scriptblock]$command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { return (& $command 2>$null) } finally { $ErrorActionPreference = $previous }
}

# --- 1. Prerequisites ------------------------------------------------------------
Step "Prerequisites"
$missing = 0

if (Get-Command node -ErrorAction SilentlyContinue) { Ok "Node.js $(NativeOutput { node --version })" }
else { Missing "Node.js - winget install OpenJS.NodeJS.LTS"; $missing++ }

# audio-separator's dependencies have no wheels for newer Pythons yet.
$py311 = (Get-Command py -ErrorAction SilentlyContinue) -and ((Native { py -3.11 --version }) -eq 0)
if ($py311) { Ok "Python 3.11" } else { Missing "Python 3.11 - winget install Python.Python.3.11"; $missing++ }

$ffmpegOnPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffmpegWinget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ffmpegOnPath -or $ffmpegWinget) { Ok "ffmpeg" } else { Missing "ffmpeg - winget install Gyan.FFmpeg"; $missing++ }

$dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerExe) { Ok "Docker Desktop" } else { Missing "Docker Desktop - winget install Docker.DockerDesktop (then restart Windows)"; $missing++ }

$hasNvidia = (Get-Command nvidia-smi -ErrorAction SilentlyContinue) -and ((Native { nvidia-smi -L }) -eq 0)
if ($hasNvidia) { Ok "NVIDIA GPU: $((NativeOutput { nvidia-smi -L }) | Select-Object -First 1)" }
else { Todo "No NVIDIA GPU found - songs will process on the CPU (much slower)" }

if ($missing -gt 0) {
  Write-Host "`nInstall the missing items above, open a new terminal, and run setup again." -ForegroundColor Red
  exit 1
}

# --- 2. Web app dependencies -----------------------------------------------------
Step "Web app dependencies"
if ($CheckOnly) { Todo "would run: npm install (apps\web)" }
else {
  Push-Location $web
  try { if ((Native { npm install --no-audit --no-fund }) -ne 0) { throw "npm install failed" } } finally { Pop-Location }
  Ok "installed"
}

# --- 3. Worker environment -------------------------------------------------------
Step "Worker environment (Python)"
$python = Join-Path $worker ".venv\Scripts\python.exe"
if (Test-Path $python) {
  Ok ".venv exists (delete apps\worker\.venv to rebuild it)"
} elseif ($CheckOnly) {
  Todo "would create apps\worker\.venv and install requirements.txt$(if ($hasNvidia) { ' + CUDA PyTorch' })"
} else {
  Push-Location $worker
  try {
    if ((Native { py -3.11 -m venv .venv }) -ne 0) { throw "Creating the venv failed" }
    if ((Native { & $python -m pip install --upgrade pip }) -ne 0) { throw "pip upgrade failed" }
    Write-Host "  installing packages (several minutes)..."
    if ((Native { & $python -m pip install -r requirements.txt }) -ne 0) { throw "pip install -r requirements.txt failed" }
    if ($hasNvidia) {
      # PyPI's default torch on Windows is CPU-only; swap in the CUDA build.
      Write-Host "  installing GPU PyTorch (large download)..."
      if ((Native { & $python -m pip install --index-url https://download.pytorch.org/whl/cu124 --force-reinstall torch torchvision torchaudio }) -ne 0) { throw "CUDA PyTorch install failed" }
    }
  } finally { Pop-Location }
  Ok "created"
}

# --- 4. Database -----------------------------------------------------------------
Step "Database (local Supabase)"
if ($CheckOnly) { Todo "would start Docker Desktop and run: npx supabase start" }
else {
  if ((Native { docker info --format "{{.ServerVersion}}" 2>$null }) -ne 0) {
    Start-Process $dockerExe
    Write-Host "  waiting for Docker..."
    $deadline = (Get-Date).AddMinutes(3)
    while ((Native { docker info --format "{{.ServerVersion}}" 2>$null }) -ne 0) {
      if ((Get-Date) -gt $deadline) { throw "Docker didn't start - open Docker Desktop once by hand, then re-run setup." }
      Start-Sleep 3
    }
  }
  Push-Location $root
  try {
    Write-Host "  starting Supabase (first run downloads several images)..."
    if ((Native { npx --yes supabase start }) -ne 0) { throw "supabase start failed" }
  } finally { Pop-Location }
  Ok "running"
}

# --- 5. Settings -------------------------------------------------------------------
Step "Settings"
$webEnv = Join-Path $web ".env.local"
$workerEnv = Join-Path $worker ".env"
if ((Test-Path $webEnv) -and (Test-Path $workerEnv)) {
  Ok ".env.local and worker .env exist (left as they are)"
} elseif ($CheckOnly) {
  Todo "would write $(if (-not (Test-Path $webEnv)) { 'apps\web\.env.local ' })$(if (-not (Test-Path $workerEnv)) { 'apps\worker\.env' })"
} else {
  Push-Location $root
  try { $status = NativeOutput { npx --yes supabase status -o env } } finally { Pop-Location }
  $vars = @{}
  foreach ($line in $status) { if ($line -match '^([A-Z_]+)="?([^"]*)"?$') { $vars[$Matches[1]] = $Matches[2] } }

  $secret = -join ((1..48) | ForEach-Object { "abcdefghijklmnopqrstuvwxyz0123456789"[(Get-Random -Maximum 36)] })
  if (Test-Path $webEnv) {
    $existing = Get-Content $webEnv | Where-Object { $_ -match "^WORKER_API_KEY=" }
    if ($existing) { $secret = $existing.Substring("WORKER_API_KEY=".Length) }
  } else {
    @(
      "# Written by scripts\setup.ps1 - local Supabase (see supabase\config.toml)",
      "NEXT_PUBLIC_SUPABASE_URL=$($vars['API_URL'])",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=$($vars['ANON_KEY'])",
      "SUPABASE_SERVICE_ROLE_KEY=$($vars['SERVICE_ROLE_KEY'])",
      "",
      "# Shared secret the worker sends with every request",
      "WORKER_API_KEY=$secret",
      "",
      "# Fill these in - see README",
      "YOUTUBE_API_KEY=",
      "SPOTIFY_CLIENT_ID=",
      "SPOTIFY_CLIENT_SECRET=",
      "",
      "# Processed-audio library; defaults to apps\worker\storage",
      "# STEMS_STORAGE_DIR=E:\Karaoke"
    ) | Set-Content -Path $webEnv -Encoding utf8
    Ok "wrote apps\web\.env.local"
  }
  if (-not (Test-Path $workerEnv)) {
    @("WEB_BASE_URL=http://localhost:3000", "WORKER_API_KEY=$secret") | Set-Content -Path $workerEnv -Encoding utf8
    Ok "wrote apps\worker\.env"
  }
}

# --- Next steps ------------------------------------------------------------------
Write-Host "`nSetup done." -ForegroundColor Green
if (Test-Path $webEnv) {
  $envText = Get-Content $webEnv -Raw
  foreach ($key in "YOUTUBE_API_KEY", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET") {
    if ($envText -notmatch "(?m)^$key=\S") { Todo "$key is empty in apps\web\.env.local (see README)" }
  }
}
Write-Host "  Bring data from another machine: .\scripts\restore.ps1 -Backup <backup folder>"
Write-Host "  Start the app:                   start.cmd"
