# Backs up the karaoke app to a folder (e.g. on an external HD), so it can
# be restored on this or another machine with scripts\restore.ps1.
#
#   .\scripts\backup.ps1 -Destination E:\KaraokeBackups
#   .\scripts\backup.ps1 -Destination E:\KaraokeBackups -IncludeAudio
#
# Creates <Destination>\karaoke-backup-<date>\ with:
#   database.sql   every song, lyric, queue entry, guest... (app data only)
#   config\        apps\web\.env.local and apps\worker\.env - these hold
#                  the app's keys, so keep the backup somewhere private
#   audio\         the processed-audio library (only with -IncludeAudio;
#                  skip it if the library already lives on the backup drive)
# Works while the app is running; the database must be up (start.cmd).
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$IncludeAudio
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $Destination ("karaoke-backup-" + (Get-Date -Format "yyyy-MM-dd_HHmm"))
New-Item -ItemType Directory -Force (Join-Path $target "config") | Out-Null

Write-Host "> Database -> $target\database.sql"
Push-Location $root
try {
  # Only the app's own tables (public schema): the rest of Supabase's
  # internals are recreated by `supabase start` on the restoring machine.
  # Native programs run with errors relaxed: Windows PowerShell 5.1 treats
  # their ordinary stderr output as fatal under "Stop". Exit code decides.
  $ErrorActionPreference = "Continue"
  npx --yes supabase db dump --local --data-only --schema public -f (Join-Path $target "database.sql") 2>&1 | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "Database dump failed - is the app running (start.cmd)?" }
} finally { Pop-Location }

Write-Host "> Settings"
Copy-Item (Join-Path $root "apps\web\.env.local") (Join-Path $target "config\web.env.local")
$workerEnv = Join-Path $root "apps\worker\.env"
if (Test-Path $workerEnv) { Copy-Item $workerEnv (Join-Path $target "config\worker.env") }

if ($IncludeAudio) {
  $envText = Get-Content (Join-Path $root "apps\web\.env.local") -Raw
  $match = [regex]::Match($envText, "(?m)^STEMS_STORAGE_DIR=(.+)$")
  $library = if ($match.Success) { $match.Groups[1].Value.Trim() } else { Join-Path $root "apps\worker\storage" }
  Write-Host "> Audio library $library -> $target\audio"
  # robocopy: fast, resumable; exit codes below 8 mean success.
  robocopy $library (Join-Path $target "audio") /E /NFL /NDL /NJH /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the audio library failed (robocopy exit $LASTEXITCODE)." }
}

$size = (Get-ChildItem $target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("`nBackup done: {0} ({1:N0} MB)" -f $target, $size) -ForegroundColor Green
