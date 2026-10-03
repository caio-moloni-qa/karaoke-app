import os

import yt_dlp


def download_audio(video_id: str, out_dir: str) -> tuple[str, float]:
    """Downloads the best available audio for a YouTube video as WAV.

    Returns (file_path, duration_seconds).
    """
    os.makedirs(out_dir, exist_ok=True)
    out_template = os.path.join(out_dir, "original.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        # YouTube now requires solving a JavaScript challenge to get working
        # download URLs; without a JS runtime yt-dlp silently gets URLs that
        # fail with "HTTP Error 403: Forbidden". yt-dlp only looks for Deno
        # by default — use the Node.js that's already installed instead (with
        # the yt-dlp-ejs solver scripts from requirements.txt).
        "js_runtimes": {"node": {}},
    }

    # YouTube's bot-detection ("Sign in to confirm you're not a bot")
    # triggers occasionally for anonymous requests. Pointing yt-dlp at a
    # real browser's cookies makes requests look like a logged-in session,
    # which YouTube trusts far more. Optional — most downloads work without
    # it. Chrome/Edge must be fully closed for yt-dlp to read their cookie
    # DB (it's locked while the browser is running).
    cookies_browser = os.environ.get("YTDLP_COOKIES_FROM_BROWSER")
    if cookies_browser:
        ydl_opts["cookiesfrombrowser"] = (cookies_browser,)

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)

    final_path = os.path.join(out_dir, "original.wav")
    return final_path, float(info.get("duration") or 0)
