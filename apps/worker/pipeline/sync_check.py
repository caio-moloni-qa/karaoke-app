"""Automatic lyrics-sync check, run by the worker right after aligning a
song's lyrics, so out-of-sync songs get flagged in the app instead of having
to be found by singing them.

It checks what the stage will actually show (line starts after the app's
applyAlignedStarts, mirrored here) against when there's singing in the vocal
stems:
- lyrics that run past the end of the audio (wrong version of the song);
- the first line starting well after the singing does (the 3-2-1 countdown
  would end late);
- lines that light up where nobody is singing;
- many lines the aligner couldn't place (wrong lyrics, unusual singing).
"""
import numpy as np

from pipeline.align import _SAMPLE_RATE, _load_vocals, parse_lrc

_FRAME_MS = 50
# Mirrors apps/web/lib/lrc.ts (reliableWords / applyAlignedStarts).
_MAX_WORD_MS = 2500
_LEAD_MS = 300

_FIRST_LINE_LATE_MS = 1500   # singing starts this much before the first line
_PROBE_MS = 2000             # a line "has singing" if its first 2 s...
_MIN_VOICED = 0.10           # ...are at least 10% voiced
_MAX_ORPHAN_SHARE = 0.15
_MAX_UNALIGNED_SHARE = 0.25


def _reliable(words: list[dict] | None) -> list[dict] | None:
    if not words:
        return None
    return None if any(w["e"] - w["s"] > _MAX_WORD_MS for w in words[:-1]) else words


def _voice_activity(vocal_paths: list[str]) -> np.ndarray:
    wave = _load_vocals(vocal_paths)[0].numpy()
    hop = _SAMPLE_RATE * _FRAME_MS // 1000
    frames = wave[: len(wave) // hop * hop].reshape(-1, hop)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    return db > (np.percentile(db, 95) - 22)


def _first_singing_ms(active: np.ndarray) -> float | None:
    """Start of the first stretch that's mostly voiced for a full second."""
    window = 1000 // _FRAME_MS
    for i in range(len(active) - window):
        if active[i] and active[i : i + window].mean() >= 0.6:
            return i * _FRAME_MS
    return None


def check_sync(vocal_paths: list[str], raw_lrc: str, offset_ms: int, aligned: list[dict]) -> dict:
    """{"status": "ok" | "warn" | "fail", "issues": [{"code", "message", "lines"?}]}
    Times in messages are audio times (what you'd see in a player)."""
    active = _voice_activity(vocal_paths)
    audio_ms = len(active) * _FRAME_MS
    words_by_t = {line["t"]: line["words"] for line in aligned}

    # Line starts as the stage shows them, on the audio timeline.
    shown, previous = [], -np.inf
    for line in parse_lrc(raw_lrc):
        words = _reliable(words_by_t.get(line["t"]))
        start = max(previous, words[0]["s"] - _LEAD_MS if words else line["t"])
        previous = start
        if line["text"]:
            shown.append({"ms": start + offset_ms, "text": line["text"], "aligned": words is not None})
    if not shown:
        return {"status": "ok", "issues": []}

    def at(ms: float) -> str:
        return f"{int(ms // 60000)}:{int(ms % 60000 // 1000):02d}"

    issues = []
    past_end = [line for line in shown if line["ms"] > audio_ms - 1000]
    if past_end:
        issues.append({
            "code": "past_end",
            "message": f"{len(past_end)} linha(s) depois do fim do áudio ({at(audio_ms)}): letra de outra versão da música?",
            "lines": [line["text"] for line in past_end[:5]],
        })

    first_singing = _first_singing_ms(active)
    first_line = shown[0]["ms"] + _LEAD_MS
    if first_singing is not None and first_line - first_singing > _FIRST_LINE_LATE_MS:
        issues.append({
            "code": "first_line_late",
            "message": f"O canto começa em {at(first_singing)}, mas a primeira linha só em {at(first_line)}: a contagem 3-2-1 termina atrasada.",
        })

    probe = _PROBE_MS // _FRAME_MS
    orphans = []
    for line in shown:
        i = int(line["ms"] + _LEAD_MS) // _FRAME_MS
        if 0 <= i < len(active) and active[i : i + probe].mean() < _MIN_VOICED:
            orphans.append(line)
    if len(orphans) / len(shown) > _MAX_ORPHAN_SHARE:
        issues.append({
            "code": "orphan_lines",
            "message": f"{len(orphans)} de {len(shown)} linhas aparecem onde ninguém está cantando.",
            "lines": [f"{at(line['ms'] + _LEAD_MS)} {line['text']}" for line in orphans[:8]],
        })

    unaligned = [line for line in shown if not line["aligned"]]
    if len(unaligned) / len(shown) > _MAX_UNALIGNED_SHARE:
        issues.append({
            "code": "unaligned",
            "message": f"{len(unaligned)} de {len(shown)} linhas não puderam ser sincronizadas palavra por palavra.",
            "lines": [f"{at(line['ms'])} {line['text']}" for line in unaligned[:8]],
        })

    status = "fail" if past_end else "warn" if issues else "ok"
    return {"status": status, "issues": issues}
