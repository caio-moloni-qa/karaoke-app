# Karaoke worker

Local script that polls the web app for queued songs, downloads them from
YouTube, splits them into instrumental / lead vocal / backing vocal via GPU,
estimates key/scale, and uploads the results straight to Supabase Storage.
Runs on your machine so the GPU-heavy separation step doesn't need to live in
the cloud. See the [root README](../../README.md) for how this fits into the
overall architecture.

## Prerequisites

- **Python 3.11** specifically — `audio-separator`'s dependencies (e.g.
  `diffq-fixed`) don't have prebuilt wheels for newer Pythons yet and fail to
  build from source. If you don't have 3.11: `winget install Python.Python.3.11`
  (installs alongside any other Python version you have).
- **ffmpeg** on PATH — `winget install Gyan.FFmpeg`. Restart your terminal
  afterwards so the PATH change takes effect.
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
- `SUPABASE_ANON_KEY` — same anon key as the web app's `.env.local`. The
  worker uploads stems directly to Supabase Storage via a signed URL that the
  web app mints; per Supabase's signed-upload protocol, that upload request
  still needs a valid `apikey` header alongside the signed token.

## Running

```bash
./.venv/Scripts/python worker.py
```

It polls `WEB_BASE_URL` every few seconds for a queued job, and for each one:
download → separate (2 stages: instrumental/vocals, then lead/backing vocals)
→ detect key → upload 4 files (original + 3 stems) → mark the song `ready`.
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
