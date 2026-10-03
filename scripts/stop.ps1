# Stops the worker, the web app and the local database. Data is kept: the
# database lives in a Docker volume and the audio library on disk, both
# untouched. A song stopped mid-processing goes back in the queue the next
# time the worker starts.
#   -KeepDatabase   leave Supabase (and Docker) running
param([switch]$KeepDatabase)
$root = Split-Path -Parent $PSScriptRoot

# The watchdog goes first, or it would restart what's being stopped.
$watchdogs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match "watchdog\.ps1" }
foreach ($w in $watchdogs) { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "> Worker and web app"
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='node.exe'" | Where-Object {
  $_.CommandLine -match "worker\.py" -or ($_.CommandLine -match "next" -and $_.CommandLine -match [regex]::Escape("apps\web"))
}
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "  stopped $(@($procs).Count) process(es)"

if (-not $KeepDatabase) {
  Write-Host "> Database (local Supabase)"
  Push-Location $root
  try { npx --yes supabase stop *> $null } finally { Pop-Location }
  Write-Host "  stopped (data kept)"
}
Write-Host "`nKaraoke stopped."
