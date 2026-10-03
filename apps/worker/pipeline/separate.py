from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from audio_separator.separator import Separator
from audio_separator.separator.architectures import mdxc_separator

# (fraction of the whole two-stage separation done, label for that stage)
ProgressCallback = Callable[[float, str], None]

# Rough share of total separation time per stage: stage 1 runs a heavier
# model on the full mix, stage 2 a lighter one on the vocals only.
STAGE1_WEIGHT = 0.7

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


@contextmanager
def _report_chunk_progress(on_fraction: Callable[[float], None]) -> Iterator[None]:
    # audio-separator has no progress callback; its only signal is the tqdm
    # bar it wraps around the model's chunk loop (both models here go through
    # mdxc_separator). Swapping that module's tqdm for a subclass that also
    # reports each finished chunk is the least invasive hook — no changes to
    # the installed package, and it's restored afterwards.
    original_tqdm = mdxc_separator.tqdm

    class ReportingTqdm(original_tqdm):
        def __iter__(self):
            total = self.total
            for done, item in enumerate(super().__iter__(), start=1):
                yield item
                if total:
                    on_fraction(done / total)

    mdxc_separator.tqdm = ReportingTqdm
    try:
        yield
    finally:
        mdxc_separator.tqdm = original_tqdm


def separate_stems(audio_path: str, work_dir: str, on_progress: ProgressCallback | None = None) -> dict[str, str]:
    """Returns {"instrumental": path, "lead_vocal": path, "backing_vocal": path}."""
    report = on_progress or (lambda fraction, label: None)
    MODELS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    separator = Separator(output_dir=work_dir, model_file_dir=str(MODELS_CACHE_DIR), output_format="WAV")

    stage1_label = "Separando instrumental e vocais"
    separator.load_model(VOCAL_INSTRUMENTAL_MODEL)
    with _report_chunk_progress(lambda f: report(f * STAGE1_WEIGHT, stage1_label)):
        stage1_files = separator.separate(
            audio_path,
            custom_output_names={"vocals": "stage1_vocals", "instrumental": "instrumental"},
        )
    instrumental_path = _find_output(stage1_files, "instrumental", work_dir)
    stage1_vocals_path = _find_output(stage1_files, "stage1_vocals", work_dir)

    stage2_label = "Separando voz principal e backing vocal"
    report(STAGE1_WEIGHT, stage2_label)
    separator.load_model(KARAOKE_MODEL)
    with _report_chunk_progress(lambda f: report(STAGE1_WEIGHT + f * (1 - STAGE1_WEIGHT), stage2_label)):
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
