import librosa
import numpy as np

# Krumhansl-Schmuckler key profiles.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def detect_key(audio_path: str) -> tuple[str, str]:
    """Estimates key + scale via chroma correlation against the KS profiles.

    Informative only — not wired into any pitch-shifting/autotune feature.
    Returns (key, scale), e.g. ("G", "major").
    """
    y, sr = librosa.load(audio_path, sr=None, mono=True, duration=120)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)

    best_score = -np.inf
    best_key, best_scale = "C", "major"
    for shift in range(12):
        major_score = np.corrcoef(np.roll(MAJOR_PROFILE, shift), chroma_mean)[0, 1]
        minor_score = np.corrcoef(np.roll(MINOR_PROFILE, shift), chroma_mean)[0, 1]
        if major_score > best_score:
            best_score, best_key, best_scale = major_score, NOTE_NAMES[shift], "major"
        if minor_score > best_score:
            best_score, best_key, best_scale = minor_score, NOTE_NAMES[shift], "minor"

    return best_key, best_scale
