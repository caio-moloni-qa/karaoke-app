# Karaoke worker

Local script that polls the web app for queued songs, downloads them from
YouTube, splits them into instrumental / lead vocal / backing vocal via GPU,
estimates key/scale, and saves the results to the audio library folder. That
folder is set once, on the web app side (`STEMS_STORAGE_DIR` in
`apps/web/.env.local`, default `apps/worker/storage/`); the worker asks the web
app for it at startup, so the two never disagree. Normally started by
`start.cmd` and set up by `scripts/setup.ps1` — see the
[root README](../../README.md). The manual steps below are what those scripts
automate.

## Prerequisites

- **Python 3.11** specifically — `audio-separator`'s dependencies (e.g.
  `diffq-fixed`) don't have prebuilt wheels for newer Pythons yet and fail to
  build from source. If you don't have 3.11: `winget install Python.Python.3.11`
  (installs alongside any other Python version you have).
- **ffmpeg** on PATH — `winget install Gyan.FFmpeg`. Restart your terminal
  afterwards so the PATH change takes effect.
- **Node.js** on PATH (already there if you run `apps/web`). YouTube
  downloads need a JavaScript runtime to solve YouTube's challenge;
  without one they fail with `HTTP Error 403: Forbidden`.
- An NVIDIA GPU with a recent driver (`nvidia-smi` should work). CPU-only
  will technically run but stem separation will be very slow.

## Setup

```bash
py -3.11 -m venv .venv
./.venv/Scripts/pip install -r requirements.txt
./.venv/Scripts/pip install --index-url https://download.pytorch.org/whl/cu124 --force-reinstall torch torchvision
```

The second command replaces the CPU-only `torch` wheel that PyPI ships by
default on Windows with the CUDA build. Verify it worked:

```bash
./.venv/Scripts/python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Should print `True` and your GPU's name. If your driver's CUDA version
(`nvidia-smi`) doesn't support cu124, swap the URL for a matching one from
[pytorch.org](https://pytorch.org/get-started/locally/).

Copy `.env.example` to `.env` and fill in:
- `WEB_BASE_URL` — where `apps/web` is running (`http://localhost:3000` locally).
- `WORKER_API_KEY` — must match `apps/web/.env.local`'s `WORKER_API_KEY`.

## Running

```bash
./.venv/Scripts/python worker.py
```

It polls `WEB_BASE_URL` every few seconds for a queued job, and for each one:
download → separate (2 stages: instrumental/vocals, then lead/backing vocals)
→ detect key → save 4 files (original + 3 stems) to `<library>/<songId>/` →
mark the song `ready`. While the library folder is unreachable (e.g. an
unplugged external HD) it waits instead of taking new songs. A song that was
mid-processing when the worker stopped goes back in the queue on next start.
Models download automatically on first use into `models_cache/` (a few
hundred MB each, one-time).

First run will be slow while models download; after that, separation speed
depends on your GPU.

## Troubleshooting

**`ERROR: [youtube] ...: Sign in to confirm you're not a bot`** — YouTube's
anti-bot check triggering on an anonymous request; happens occasionally, not
a bug. Set `YTDLP_COOKIES_FROM_BROWSER` in `.env` to a browser you're logged
into YouTube with (`chrome`, `edge`, `firefox`, ...) — that browser needs to
be fully closed while the worker downloads, since yt-dlp reads its cookie
database directly and it's locked while the browser is running.
