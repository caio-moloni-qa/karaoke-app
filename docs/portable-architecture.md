# Portable architecture plan

Goal: run the whole karaoke app (web app, database, GPU worker, audio
library) from one machine with **one command**, keep the processed audio on
**any folder you choose** (e.g. an external HD), and be able to **move the
whole setup to another machine** without redoing anything by hand.

Hosting is out of scope: this is for casual use with friends on the same
Wi-Fi. One machine (the "host", the one with the NVIDIA GPU) runs
everything. Friends only open the app in a browser.

## Where things stand (2026-10-03)

| Piece | Where it runs now | Portable? |
|---|---|---|
| Web app (Next.js) | Host, `npm run dev` | Code yes; started by hand |
| Database | **Local Supabase in Docker** (moved from Supabase Cloud today) | Data lives in a Docker volume, no backup/move path yet |
| Audio library | `apps/worker/storage/` (fixed path, set in two places) | No — can't point it at another disk |
| GPU worker (Python) | Host, started by hand with ffmpeg on PATH | Needs Python 3.11 + venv + CUDA torch set up by hand |
| Phone access | Host LAN IP hardcoded in `next.config.ts` | No — breaks whenever the IP changes |

Supabase Cloud is no longer used. Its config is kept in
`apps/web/.env.cloud.local` as a fallback.

## Phases

### Phase 1 — Audio library anywhere (`STEMS_STORAGE_DIR`)

- [x] One setting, `STEMS_STORAGE_DIR` in `apps/web/.env.local` (default
      stays `apps/worker/storage`). The worker fetches it from the web app
      at startup (`/api/worker/config`) so the two can't disagree. Database
      rows store paths relative to it (`<songId>/<stem>.wav`), so moving
      the library is only a config change plus copying the folder.
- [x] Move script `scripts/move-library.mjs`: copy, verify every file,
      update the config; `--dry-run` reports size only. Deleting the old
      copy is left to you. *Dry-run tested; the real move waits for the HD.*
- [x] "Abrir pasta" button on each song in "Já prontas": opens that song's
      folder in the host's file explorer. Only shown, and only allowed by
      the server, when the control panel is opened on the host itself.
- [x] Unplugged-HD handling: the control panel shows a banner with the
      expected folder; the worker waits instead of claiming songs it would
      have nowhere to save.

### Phase 2 — Works on any network

- [x] `next.config.ts` detects the host's LAN IPs at startup instead of
      the hardcoded `192.168.15.2` — the cause of the "blank control panel
      on the phone" bug, twice.
- [x] Browsers reach the local database on the same host they loaded the
      page from, so phones work without configuring an IP.
- [x] The stage's QR code uses the host's LAN address even when the stage
      is opened as `localhost` (`/api/host-info`).

### Phase 3 — One command to start and stop

- [x] `start.cmd` (→ `scripts/start.ps1`): Docker Desktop if needed →
      `supabase start` → web app → worker (finds ffmpeg itself) → prints
      the stage and control-panel URLs. Re-running leaves running parts
      alone.
- [x] `stop.cmd` (→ `scripts/stop.ps1`): worker, web app, `supabase stop`
      (data kept); `-KeepDatabase` leaves Supabase up.
- [x] Logs for each part in `logs/`.
- [x] Worker keeps Windows from sleeping while a song is processing.

### Phase 4 — Move to another machine (backup / restore)

- [x] `scripts/backup.ps1 -Destination <folder> [-IncludeAudio]`: data-only
      dump of the app's tables + both `.env` files (+ the library).
- [x] `scripts/restore.ps1 -Backup <folder> [-AudioDir <library>]`: fresh
      schema from the migrations, loads the dump, restores settings while
      keeping this machine's own database keys. *Tested by restoring a real
      backup into a throwaway second database: every table's row count
      matched.*

### Phase 5 — Fresh-machine setup

- [x] `scripts/setup.ps1`: checks prerequisites (Node, Python 3.11, ffmpeg,
      Docker, NVIDIA driver), installs dependencies, creates the worker
      venv with the right torch build, and writes `.env.local` / worker
      `.env` from `supabase status` (generates the worker secret).
      `-CheckOnly` reports without changing anything. *Check-only run
      verified here; the install-from-scratch path needs a fresh machine
      to test.*
- [x] Root README rewritten around `setup` → `start`.

### Phase 6 — Optional: Apple Silicon worker

- [ ] Worker install path for macOS (PyTorch with Apple GPU instead of
      CUDA), so a Mac can be the host. Slower than the RTX 4060, untested.
      Only worth doing if a Mac is actually going to be the host.

## Decisions

- **Local Supabase (Docker) over plain Postgres:** the app uses Supabase's
  REST API and live updates (Realtime) throughout; running Supabase locally
  keeps all of that working without code changes.
- **Windows first:** the host is a Windows PC. Scripts are PowerShell;
  macOS/Linux equivalents only if a non-Windows host becomes real.
- **Phones talk to the host directly:** no tunnels, no accounts — anyone on
  the same Wi-Fi can open the URL / scan the QR code.

## Progress log

- 2026-10-03 — Database moved from Supabase Cloud to local Supabase
  (Docker); all data copied and verified. Plan written; starting Phase 1.
- 2026-10-03 (night) — Phases 1–5 implemented. Lessons: scripts must be
  ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI), and
  native tools' stderr must not be fatal (the Supabase CLI prints normal
  status there). Song processing kept running throughout; restarts were
  only done between songs. Phase 6 (Mac host) not started — only if needed.

## Still needs you

- Plug in the external HD and run `scripts/move-library.mjs` with the
  folder you want (app stopped first). Then delete the old copy once songs
  play fine.
- Decide whether to delete the Supabase Cloud project (kept as a backup;
  its settings are in `apps/web/.env.cloud.local`).
