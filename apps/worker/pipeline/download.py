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
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)

    final_path = os.path.join(out_dir, "original.wav")
    return final_path, float(info.get("duration") or 0)
