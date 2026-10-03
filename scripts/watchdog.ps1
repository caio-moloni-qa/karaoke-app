# Keeps the karaoke app up during long unattended processing runs: every
# couple of minutes, if the worker or the web app isn't running, runs
# start.ps1 (which only starts what's missing). Exits after -Hours.
#
#   Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File scripts\watchdog.ps1 -Hours 14"
#
# stop.ps1 stops the watchdog first, so a deliberate stop isn't undone.
param([double]$Hours = 12, [int]$IntervalSeconds = 120)
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "logs\watchdog.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$deadline = (Get-Date).AddHours($Hours)

function Log($msg) { Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" }

function WorkerRunning {
  return [bool](Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match "worker\.py" })
}

function WebRunning {
  try { Invoke-WebRequest "http://localhost:3000/api/storage/status" -UseBasicParsing -TimeoutSec 10 | Out-Null; return $true }
  catch { return $false }
}

Log "watchdog started (until $($deadline.ToString('HH:mm')))"
while ((Get-Date) -lt $deadline) {
  $worker = WorkerRunning
  $web = WebRunning
  if (-not ($worker -and $web)) {
    Log "worker running: $worker, web running: $web - running start.ps1"
    # Out-File with an explicit encoding: plain *>> redirection writes
    # UTF-16 in Windows PowerShell 5.1, which garbles the rest of the log.
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start.ps1") *>&1 | Out-File $log -Append -Encoding utf8
  }
  Start-Sleep -Seconds $IntervalSeconds
}
Log "watchdog finished"
