"""Word-level timing for synced lyrics.

Synced lyrics (LRCLIB) only give each line's start time. To fill the stage
lyrics word by word — pausing where the singer pauses — this forced-aligns
each line's words against the isolated lead-vocal stem: the text is already
known, so the model only has to find *when* each word is sung, not *what*.

Uses torchaudio's MMS_FA multilingual alignment model (letters a-z, so text
is romanized with unidecode: "não" -> "nao"). Lines in scripts that can't be
romanized meaningfully (Japanese, Korean, ...) are skipped; the stage falls
back to line-level fill for any line without word timings.
"""
import re

import torch
import torchaudio
from unidecode import unidecode

_BUNDLE = torchaudio.pipelines.MMS_FA
_SAMPLE_RATE = _BUNDLE.sample_rate
_model = None

_TAG = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
# Kana, CJK, Hangul, Cyrillic, Arabic, Hebrew, Thai: unidecode output for
# these isn't what's being sung, so aligning against it would be noise.
_UNSUPPORTED_SCRIPT = re.compile(r"[぀-ヿ㐀-鿿가-힯Ѐ-ӿ֐-ۿ฀-๿]")

# Line windows reach a little past the LRC start/next-line times, which are
# hand-made and often slightly early or late.
_PAD_BEFORE_MS = 300
_PAD_AFTER_MS = 300
# A line's window runs to the next line's start, but before a guitar solo
# that's a minute or more of audio — and the model's cost grows with the
# square of the window length (one such song took 5+ minutes). Singing a
# line never takes that long, so the window is also capped by a generous
# per-word allowance.
_MS_PER_WORD_MAX = 1200
_MIN_WINDOW_MS = 6000
_MAX_WINDOW_MS = 20000


def _get_model(device: str):
    global _model
    if _model is None:
        # First use downloads the model (~1.2 GB) into the torch hub cache.
        _model = _BUNDLE.get_model(with_star=False).to(device).eval()
    return _model


# Mirrors apps/web/lib/lrc.ts exactly (same regex, same times): word timings
# are keyed by these line times, so both sides must expand repeats alike.
_REPEAT = re.compile(r"\s*[(\[]\s*(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*[x×])\s*[)\]]\s*$|\s+[x×](\d{1,2})\s*$", re.IGNORECASE)
_MAX_REPEAT = 16
_MS_PER_CHAR = 110
_MIN_LINE_MS = 1500


def _repeat_count(text: str) -> tuple[str, int] | None:
    match = _REPEAT.search(text)
    if not match:
        return None
    count = int(match.group(1) or match.group(2) or match.group(3))
    if count < 2 or count > _MAX_REPEAT:
        return None
    return text[: match.start()].strip(), count


def parse_lrc(raw: str) -> list[dict]:
    """Same rules as apps/web/lib/lrc.ts parseLrc: one entry per timestamp
    tag, and a line with a repeat marker ("Go away (x8)") expanded into one
    entry per repetition, evenly spaced until the next line. Entries are
    {"t", "text"}, plus "group" (start time, count, end time) on expanded
    repetitions so they can be aligned together."""
    parsed = []
    for raw_line in raw.split("\n"):
        tags = _TAG.findall(raw_line)
        if not tags:
            continue
        text = _TAG.sub("", raw_line).strip()
        for minutes, seconds in tags:
            parsed.append((round((int(minutes) * 60 + float(seconds)) * 1000), text))
    parsed.sort(key=lambda line: line[0])

    lines = []
    for i, (line_ms, text) in enumerate(parsed):
        repeat = _repeat_count(text)
        if not repeat:
            lines.append({"t": line_ms, "text": text})
            continue
        repeat_text, count = repeat
        next_ms = next((t for t, _ in parsed[i + 1 :] if t > line_ms), None)
        per_repeat = max(_MIN_LINE_MS, len(repeat_text) * _MS_PER_CHAR)
        span = (next_ms if next_ms is not None else line_ms + per_repeat * count) - line_ms
        for k in range(count):
            lines.append({"t": line_ms + (k * span) // count, "text": repeat_text, "group": (line_ms, count, line_ms + span)})
    return lines


def _normalize(word: str) -> str:
    return re.sub(r"[^a-z']", "", unidecode(word).lower()).strip("'")


def _tokens(text: str) -> list[list[str]]:
    """[display word, normalized word] pairs. Punctuation-only tokens (a lone
    "-" or "&") have nothing to align, so they ride along with a neighbor."""
    tokens: list[list[str]] = []
    pending = ""
    for display in text.split():
        normalized = _normalize(display)
        if not normalized:
            if tokens:
                tokens[-1][0] += " " + display
            else:
                pending += display + " "
            continue
        tokens.append([pending + display, normalized])
        pending = ""
    return tokens


def _load_vocals(paths: list[str]) -> torch.Tensor:
    # Lead + backing vocals summed: lines in parentheses are usually sung by
    # the backing vocals, which the lead stem alone doesn't contain (aligning
    # them against it squashed and stretched words). Still vocals only — no
    # instruments for the aligner to trip on.
    mixed = None
    for path in paths:
        waveform, sample_rate = torchaudio.load(path)
        waveform = torchaudio.functional.resample(waveform.mean(0, keepdim=True), sample_rate, _SAMPLE_RATE)
        if mixed is None:
            mixed = waveform
        else:
            length = min(mixed.shape[1], waveform.shape[1])
            mixed = mixed[:, :length] + waveform[:, :length]
    return mixed


def align_lyrics(vocal_paths: list[str], raw_lrc: str, offset_ms: int) -> list[dict]:
    """Returns [{"t": line_time_ms, "words": [{"w", "s", "e"}]}], times on the
    LRC timeline (audio time minus offset_ms, the same timeline the stage
    compares against). Lines that can't be aligned are simply absent."""
    lines = parse_lrc(raw_lrc)
    if not any(line["text"] for line in lines):
        return []

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = _get_model(device)
    tokenizer = _BUNDLE.get_tokenizer()
    aligner = _BUNDLE.get_aligner()

    waveform = _load_vocals(vocal_paths)
    total_ms = waveform.shape[1] * 1000 / _SAMPLE_RATE

    def align_window(line_ms: int, end_ms: float, tokens: list[list[str]]) -> list[dict] | None:
        """Word timings for `tokens` sung between line_ms and end_ms (LRC
        timeline), or None if this stretch can't be aligned."""
        start = max(0.0, line_ms + offset_ms - _PAD_BEFORE_MS)
        end = min(total_ms, end_ms + offset_ms + _PAD_AFTER_MS)
        segment = waveform[:, int(start * _SAMPLE_RATE / 1000) : int(end * _SAMPLE_RATE / 1000)]
        if segment.shape[1] < _SAMPLE_RATE // 5:
            return None
        try:
            with torch.inference_mode():
                emission, _ = model(segment.to(device))
            spans = aligner(emission[0], tokenizer([normalized for _, normalized in tokens]))
        except Exception:
            # Typically more letters than audio frames in a very short
            # window — leave it to the line-level fill.
            return None
        ms_per_frame = segment.shape[1] * 1000 / _SAMPLE_RATE / emission.shape[1]
        return [
            {
                "w": display,
                "s": round(start + word_spans[0].start * ms_per_frame - offset_ms),
                "e": round(start + word_spans[-1].end * ms_per_frame - offset_ms),
            }
            for (display, _), word_spans in zip(tokens, spans)
        ]

    results = []
    for i, line in enumerate(lines):
        line_ms, text = line["t"], line["text"]
        if not text or _UNSUPPORTED_SCRIPT.search(text):
            continue
        tokens = _tokens(text)
        if not tokens:
            continue
        window_ms = min(_MAX_WINDOW_MS, max(_MIN_WINDOW_MS, len(tokens) * _MS_PER_WORD_MAX))

        group = line.get("group")
        if group:
            # All repetitions of an "(xN)" line are aligned together over the
            # whole stretch, so each one is found where it's really sung even
            # if they aren't evenly spaced. Done once, at the first entry.
            group_start, count, group_end = group
            if line_ms != group_start:
                continue
            words = align_window(group_start, min(group_end, group_start + window_ms * count), tokens * count)
            if words:
                entries = [entry for entry in lines if entry.get("group") == group]
                for k, entry in enumerate(entries):
                    results.append({"t": entry["t"], "words": words[k * len(tokens) : (k + 1) * len(tokens)]})
            continue

        next_ms = next((entry["t"] for entry in lines[i + 1 :] if entry["t"] > line_ms), None)
        line_end = line_ms + window_ms if next_ms is None else min(next_ms, line_ms + window_ms)
        words = align_window(line_ms, line_end, tokens)
        if words:
            results.append({"t": line_ms, "words": words})
    return results
