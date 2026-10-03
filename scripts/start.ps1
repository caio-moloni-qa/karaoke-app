# Starts everything the karaoke app needs, in order, and prints the URLs:
#   1. Docker Desktop (needed by the local database)
#   2. Local Supabase (database + live updates)
#   3. Web app (Next.js dev server, port 3000)
#   4. GPU worker (processes queued songs)
# Safe to run again: anything already running is left alone.
# Logs go to logs\ at the repo root.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root "apps\web"
$worker = Join-Path $root "apps\worker"
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  $msg" -ForegroundColor Red; exit 1 }

# Runs an external program and returns its exit code. Windows PowerShell 5.1
# turns anything a native program writes to stderr into an error, which
# $ErrorActionPreference = "Stop" makes fatal - and tools like the Supabase
# CLI print ordinary status lines there. Success is judged by exit code.
function Native([scriptblock]$command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $command | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
}

function DockerReady {
  return (Native { docker info --format "{{.ServerVersion}}" 2>$null }) -eq 0
}

function WaitFor($what, $seconds, [scriptblock]$check) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $check) { return $true }
    Start-Sleep -Seconds 2
  }
  Fail "$what didn't come up within $seconds s."
}

# --- 1. Docker ---------------------------------------------------------------
Step "Docker"
if (DockerReady) {
  Ok "already running"
} else {
  $dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $dockerExe)) { Fail "Docker Desktop isn't installed (see README)." }
  Start-Process $dockerExe
  WaitFor "Docker" 180 { DockerReady } | Out-Null
  Ok "started"
}

# --- 2. Local Supabase -------------------------------------------------------
Step "Database (local Supabase)"
Push-Location $root
try {
  # Idempotent: a no-op that just prints status when it's already running.
  $supabaseLog = Join-Path $logs "supabase.log"
  if ((Native { npx --yes supabase start *> $supabaseLog }) -ne 0) { Fail "supabase start failed - see logs\supabase.log" }
} finally { Pop-Location }
Ok "running (Studio: http://127.0.0.1:54323)"

# --- 3. Web app --------------------------------------------------------------
function WebUp {
  try { Invoke-WebRequest "http://localhost:3000/api/storage/status" -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true }
  catch { return $false }
}

Step "Web app"
if (WebUp) {
  Ok "already running"
} else {
  # Started with the database settings cleared from this process's
  # environment: Next.js gives existing environment variables priority over
  # .env.local, so a stale value here would silently point the app at the
  # wrong database.
  foreach ($name in "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY") {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  Start-Process "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $web -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "web.log") -RedirectStandardError (Join-Path $logs "web.err.log")
  WaitFor "Web app" 120 { WebUp } | Out-Null
  Ok "started"
}

# --- 4. Worker ---------------------------------------------------------------
Step "Worker (song processing)"
$running = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match "worker\.py" }
if ($running) {
  Ok "already running"
} else {
  $python = Join-Path $worker ".venv\Scripts\python.exe"
  if (-not (Test-Path $python)) { Fail "Worker isn't set up yet (no .venv) - run scripts\setup.ps1." }

  # ffmpeg is usually on PATH; a winget install that hasn't refreshed PATH
  # yet (new terminal needed) is found in its install folder instead.
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $ffmpeg) { Fail "ffmpeg not found - install it with: winget install Gyan.FFmpeg" }
    $env:PATH = "$($ffmpeg.DirectoryName);$env:PATH"
  }

  Start-Process $python -ArgumentList "-u", "worker.py" -WorkingDirectory $worker -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "worker.log") -RedirectStandardError (Join-Path $logs "worker.err.log")
  Ok "started"
}

# --- Done ----------------------------------------------------------------------
$lanUrl = $null
try { $lanUrl = (Invoke-RestMethod "http://localhost:3000/api/host-info" -TimeoutSec 5).lanUrl } catch {}
$base = if ($lanUrl) { $lanUrl } else { "http://localhost:3000" }
$room = "00000000-0000-0000-0000-000000000001"

Write-Host "`nKaraoke is up." -ForegroundColor Green
Write-Host "  Stage (TV):      $base/stage/$room"
Write-Host "  Control panel:   $base/room/$room"
Write-Host "  Phones join by scanning the QR code on the stage (same Wi-Fi)."
Write-Host "  Stop everything: stop.cmd"
