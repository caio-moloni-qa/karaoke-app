from pathlib import Path

from audio_separator.separator import Separator

# Two-stage split, same approach the plan calls for: stage 1 pulls the
# instrumental away from a combined vocal stem using a general-purpose
# model; stage 2 runs a dedicated "karaoke" model (trained specifically to
# split lead vocals from backing vocals) on stage 1's vocal stem. Both
# models report their outputs generically as "vocals"/"instrumental" — for
# the stage 2 model, "vocals" means lead vocal and "instrumental" means
# backing vocal, since that's the pair it was trained to separate.
VOCAL_INSTRUMENTAL_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
KARAOKE_MODEL = "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt"

MODELS_CACHE_DIR = Path(__file__).parent.parent / "models_cache"


def _find_output(paths: list[str], name: str, work_dir: str) -> str:
    # separate() returns filenames relative to output_dir, not full paths.
    match = next((p for p in paths if name.lower() in Path(p).name.lower()), None)
    if not match:
        raise RuntimeError(f"Expected output '{name}' not found among {paths}")
    return match if Path(match).is_absolute() else str(Path(work_dir) / match)


def separate_stems(audio_path: str, work_dir: str) -> dict[str, str]:
    """Returns {"instrumental": path, "lead_vocal": path, "backing_vocal": path}."""
    MODELS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    separator = Separator(output_dir=work_dir, model_file_dir=str(MODELS_CACHE_DIR), output_format="WAV")

    separator.load_model(VOCAL_INSTRUMENTAL_MODEL)
    stage1_files = separator.separate(
        audio_path,
        custom_output_names={"vocals": "stage1_vocals", "instrumental": "instrumental"},
    )
    instrumental_path = _find_output(stage1_files, "instrumental", work_dir)
    stage1_vocals_path = _find_output(stage1_files, "stage1_vocals", work_dir)

    separator.load_model(KARAOKE_MODEL)
    stage2_files = separator.separate(
        stage1_vocals_path,
        custom_output_names={"vocals": "lead_vocal", "instrumental": "backing_vocal"},
    )
    lead_vocal_path = _find_output(stage2_files, "lead_vocal", work_dir)
    backing_vocal_path = _find_output(stage2_files, "backing_vocal", work_dir)

    return {
        "instrumental": instrumental_path,
        "lead_vocal": lead_vocal_path,
        "backing_vocal": backing_vocal_path,
    }
