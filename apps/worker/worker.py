import os
import shutil
import socket
import time
import traceback
from pathlib import Path

import requests
from dotenv import load_dotenv

from pipeline.download import download_audio
from pipeline.key_detect import detect_key
from pipeline.separate import separate_stems

load_dotenv()

WEB_BASE_URL = os.environ["WEB_BASE_URL"].rstrip("/")
WORKER_API_KEY = os.environ["WORKER_API_KEY"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

WORK_DIR = Path(__file__).parent / "work"


def auth_headers() -> dict:
    return {"Authorization": f"Bearer {WORKER_API_KEY}", "Content-Type": "application/json"}


def claim_job() -> dict | None:
    res = requests.post(f"{WEB_BASE_URL}/api/worker/jobs/claim", json={"workerId": WORKER_ID}, headers=auth_headers())
    res.raise_for_status()
    return res.json().get("job")


def report_progress(job_id: str, status: str, stage_label: str, progress_pct: int) -> None:
    requests.post(
        f"{WEB_BASE_URL}/api/worker/jobs/{job_id}/progress",
        json={"status": status, "stageLabel": stage_label, "progressPct": progress_pct},
        headers=auth_headers(),
    )


def report_error(job_id: str, message: str) -> None:
    requests.post(f"{WEB_BASE_URL}/api/worker/jobs/{job_id}/error", json={"message": message}, headers=auth_headers())


def report_complete(job_id: str, detected_key: str, detected_scale: str, duration_seconds: float, stems: list[dict]) -> None:
    requests.post(
        f"{WEB_BASE_URL}/api/worker/jobs/{job_id}/complete",
        json={
            "detectedKey": detected_key,
            "detectedScale": detected_scale,
            "durationSeconds": duration_seconds,
            "stems": stems,
        },
        headers=auth_headers(),
    )


def upload_file(local_path: str, song_id: str, filename: str) -> str:
    sign_res = requests.post(
        f"{WEB_BASE_URL}/api/worker/uploads/sign",
        json={"songId": song_id, "filename": filename},
        headers=auth_headers(),
    )
    sign_res.raise_for_status()
    signed = sign_res.json()

    with open(local_path, "rb") as f:
        put_res = requests.put(
            signed["signedUrl"],
            data=f,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "x-upsert": "true",
                "Content-Type": "audio/wav",
            },
        )
    put_res.raise_for_status()
    return signed["path"]


def process_job(job: dict) -> None:
    job_id = job["id"]
    song = job["songs"]
    song_id = song["id"]
    video_id = song["youtube_video_id"]

    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        report_progress(job_id, "downloading", "Baixando áudio do YouTube", 5)
        audio_path, duration_seconds = download_audio(video_id, str(job_dir))

        report_progress(job_id, "separating", "Separando instrumental e vocais", 30)
        stems = separate_stems(audio_path, str(job_dir))
        stems["original"] = audio_path

        report_progress(job_id, "separating", "Detectando tom e escala", 60)
        detected_key, detected_scale = detect_key(stems["instrumental"])

        report_progress(job_id, "uploading", "Enviando arquivos", 75)
        stem_uploads = [
            {"type": stem_type, "storagePath": upload_file(local_path, song_id, f"{stem_type}.wav")}
            for stem_type, local_path in stems.items()
        ]

        report_complete(job_id, detected_key, detected_scale, duration_seconds, stem_uploads)
        print(f"[{job_id}] done: {song['title']}")
    except Exception as exc:
        traceback.print_exc()
        report_error(job_id, str(exc))
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def main() -> None:
    print(f"Worker '{WORKER_ID}' polling {WEB_BASE_URL} every {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            job = claim_job()
        except requests.RequestException as exc:
            print(f"Failed to poll for jobs: {exc}")
            job = None

        if job:
            print(f"Claimed job {job['id']} for song '{job['songs']['title']}'")
            process_job(job)
        else:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
