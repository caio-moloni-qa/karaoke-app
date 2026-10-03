-- Per-word timing for the stage's progressive lyric fill, computed by the
-- worker (forced alignment against the vocal stems — apps/worker/pipeline/align.py).
--   word_timings     [{"t": line_ms, "words": [{"w": text, "s": start_ms, "e": end_ms}]}]
--   aligned_hash     hash of the raw_lrc + offset_ms they were computed for;
--                    when the lyrics or their offset change, the timings are
--                    stale and the worker re-aligns the song
--   alignment_error  why the last alignment attempt failed, if it did
alter table lyrics add column if not exists word_timings jsonb;
alter table lyrics add column if not exists aligned_hash text;
alter table lyrics add column if not exists alignment_error text;
