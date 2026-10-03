import ctypes
import os
import shutil
import sys
import socket
import threading
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
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

WORK_DIR = Path(__file__).parent / "work"
# Final stem/original files land here, where the web app serves them from.
# Not configured on this side: fetched from the web app at startup (its
# STEMS_STORAGE_DIR), so the two can never point at different folders.
STORAGE_DIR: Path | None = None


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
        timeout=10,
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


SEPARATION_START_PCT = 30
SEPARATION_END_PCT = 60
SEPARATION_REPORT_EVERY_SECONDS = 3


def separation_progress_reporter(job_id: str):
    # Maps separation's own chunk progress onto the 30-60% band of the bar.
    # Throttled: the model finishes a chunk every second or two, and the
    # bar only needs to move, not to get a request per chunk. A failed
    # report is ignored — it must never interrupt the separation itself.
    last = {"pct": -1, "at": 0.0}

    def on_progress(fraction: float, label: str) -> None:
        pct = SEPARATION_START_PCT + int(fraction * (SEPARATION_END_PCT - SEPARATION_START_PCT))
        now = time.monotonic()
        if pct == last["pct"] or now - last["at"] < SEPARATION_REPORT_EVERY_SECONDS:
            return
        last.update(pct=pct, at=now)
        try:
            report_progress(job_id, "separating", label, pct)
        except requests.RequestException:
            pass

    return on_progress


def save_local(local_path: str, song_id: str, filename: str) -> str:
    dest_dir = STORAGE_DIR / song_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(local_path, dest_dir / filename)
    return f"{song_id}/{filename}"


def keep_system_awake(awake: bool) -> None:
    # A song takes several minutes and a batch can run for hours unattended;
    # Windows going to sleep mid-batch would silently stop it. This only
    # holds off sleep while a song is processing — no system setting changes.
    if sys.platform != "win32":
        return
    es_continuous, es_system_required = 0x80000000, 0x00000001
    flags = es_continuous | (es_system_required if awake else 0)
    ctypes.windll.kernel32.SetThreadExecutionState(flags)


def process_job(job: dict) -> None:
    keep_system_awake(True)
    try:
        _process_job(job)
    finally:
        keep_system_awake(False)


def _process_job(job: dict) -> None:
    job_id = job["id"]
    song = job["songs"]
    song_id = song["id"]
    video_id = song["youtube_video_id"]

    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        report_progress(job_id, "downloading", "Baixando áudio do YouTube", 5)
        audio_path, duration_seconds = download_audio(video_id, str(job_dir))

        report_progress(job_id, "separating", "Separando instrumental e vocais", SEPARATION_START_PCT)
        stems = separate_stems(audio_path, str(job_dir), separation_progress_reporter(job_id))
        stems["original"] = audio_path

        report_progress(job_id, "separating", "Detectando tom e escala", SEPARATION_END_PCT)
        detected_key, detected_scale = detect_key(stems["instrumental"])

        report_progress(job_id, "uploading", "Enviando arquivos", 75)
        stem_uploads = [
            {"type": stem_type, "storagePath": save_local(local_path, song_id, f"{stem_type}.wav")}
            for stem_type, local_path in stems.items()
        ]

        report_complete(job_id, detected_key, detected_scale, duration_seconds, stem_uploads)
        print(f"[{job_id}] done: {song['title']}")
    except Exception as exc:
        traceback.print_exc()
        report_error(job_id, str(exc))
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


HEARTBEAT_INTERVAL_SECONDS = 10


def heartbeat_loop() -> None:
    # Runs alongside job processing: the claim poll in main() is the only
    # other heartbeat, and it goes silent for the minutes a song takes to
    # separate, which made the app think a busy worker was offline.
    while True:
        try:
            requests.post(
                f"{WEB_BASE_URL}/api/worker/heartbeat",
                json={"workerId": WORKER_ID},
                headers=auth_headers(),
                timeout=5,
            )
        except requests.RequestException:
            pass
        time.sleep(HEARTBEAT_INTERVAL_SECONDS)


def recover_orphaned_jobs() -> None:
    # Jobs the previous run of this worker was in the middle of when it was
    # stopped go back to the queue (see /api/worker/jobs/recover).
    try:
        res = requests.post(
            f"{WEB_BASE_URL}/api/worker/jobs/recover",
            json={"workerId": WORKER_ID},
            headers=auth_headers(),
            timeout=10,
        )
        recovered = res.json().get("recovered", 0)
        if recovered:
            print(f"Requeued {recovered} job(s) interrupted by the last shutdown")
    except (requests.RequestException, ValueError) as exc:
        print(f"Couldn't recover interrupted jobs: {exc}")


def fetch_storage_dir() -> Path:
    # The web app may still be starting (e.g. both launched by the start
    # script), so keep trying rather than exiting.
    while True:
        try:
            res = requests.get(f"{WEB_BASE_URL}/api/worker/config", headers=auth_headers(), timeout=10)
            res.raise_for_status()
            return Path(res.json()["stemsStorageDir"])
        except (requests.RequestException, ValueError, KeyError) as exc:
            print(f"Waiting for the web app to get the audio library folder: {exc}")
            time.sleep(POLL_INTERVAL_SECONDS)


def storage_available() -> bool:
    # Creating the folder succeeds on a fresh (or newly moved) library, and
    # fails when its drive is missing, e.g. an unplugged external HD.
    try:
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        return True
    except OSError:
        return False


def main() -> None:
    global STORAGE_DIR
    print(f"Worker '{WORKER_ID}' polling {WEB_BASE_URL} every {POLL_INTERVAL_SECONDS}s")
    STORAGE_DIR = fetch_storage_dir()
    print(f"Saving audio to {STORAGE_DIR}")
    recover_orphaned_jobs()
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    warned_unavailable = False
    while True:
        # Don't take a song we'd spend minutes processing only to fail at
        # the final save — wait for the library folder to come back instead.
        if not storage_available():
            if not warned_unavailable:
                print(f"Audio library folder unavailable ({STORAGE_DIR}) — is the drive connected? Waiting…")
                warned_unavailable = True
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        warned_unavailable = False

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
