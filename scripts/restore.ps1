# Restores a backup made by scripts\backup.ps1 - typically on a new machine
# after scripts\setup.ps1.
#
#   .\scripts\restore.ps1 -Backup E:\KaraokeBackups\karaoke-backup-2026-10-03_0300
#   .\scripts\restore.ps1 -Backup <folder> -AudioDir E:\Karaoke
#
# REPLACES this machine's karaoke database with the backup's (asks first).
# Settings: the backup's .env files are restored except the database keys,
# which belong to this machine's local Supabase and are kept as they are.
# Audio: -AudioDir points the app at a library folder that already has the
# files (e.g. the external HD); otherwise the backup's audio\ copy is used
# in place.
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$AudioDir
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dump = Join-Path $Backup "database.sql"
if (-not (Test-Path $dump)) { throw "No database.sql in $Backup - is that a backup folder?" }

$answer = Read-Host "This replaces the karaoke database on this machine with the backup. Type YES to continue"
if ($answer -ne "YES") { Write-Host "Cancelled."; exit 1 }

Push-Location $root
# Native programs run with errors relaxed: Windows PowerShell 5.1 treats
# their ordinary stderr output as fatal under "Stop". Exit codes decide.
$ErrorActionPreference = "Continue"
try {
  Write-Host "> Fresh database (schema from supabase\migrations)"
  npx --yes supabase start 2>&1 | Out-Null
  npx --yes supabase db reset --local --no-seed 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Database reset failed." }

  Write-Host "> Loading data"
  $container = "supabase_db_" + ((Select-String -Path "supabase\config.toml" -Pattern '^project_id = "(.+)"').Matches[0].Groups[1].Value)
  Get-Content $dump -Raw | docker exec -i $container psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "Loading the data failed." }
} finally {
  $ErrorActionPreference = "Stop"
  Pop-Location
}

Write-Host "> Settings"
# Keys for this machine's own local Supabase stay; everything else (worker
# secret, YouTube/Spotify keys, library folder) comes from the backup.
$keep = "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"
$webEnv = Join-Path $root "apps\web\.env.local"
$current = @{}
if (Test-Path $webEnv) {
  foreach ($line in Get-Content $webEnv) { if ($line -match "^([A-Z_]+)=(.*)$") { $current[$Matches[1]] = $Matches[2] } }
}
$restored = foreach ($line in Get-Content (Join-Path $Backup "config\web.env.local")) {
  if ($line -match "^([A-Z_]+)=" -and $keep -contains $Matches[1] -and $current.ContainsKey($Matches[1])) {
    "$($Matches[1])=$($current[$Matches[1]])"
  } else { $line }
}
$library = if ($AudioDir) { (Resolve-Path $AudioDir).Path } elseif (Test-Path (Join-Path $Backup "audio")) { (Resolve-Path (Join-Path $Backup "audio")).Path } else { $null }
if ($library) {
  $restored = @($restored | Where-Object { $_ -notmatch "^STEMS_STORAGE_DIR=" }) + "STEMS_STORAGE_DIR=$library"
}
Set-Content -Path $webEnv -Value $restored -Encoding utf8
$workerBackup = Join-Path $Backup "config\worker.env"
if (Test-Path $workerBackup) { Copy-Item $workerBackup (Join-Path $root "apps\worker\.env") -Force }

Write-Host "`nRestore done." -ForegroundColor Green
if ($library) { Write-Host "  Audio library: $library" } else { Write-Host "  No audio in the backup and no -AudioDir given - point STEMS_STORAGE_DIR at your library." -ForegroundColor Yellow }
Write-Host "  Restart the app: stop.cmd, then start.cmd"
