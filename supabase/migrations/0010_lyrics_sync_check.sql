-- Result of the worker's automatic lyrics-sync check (apps/worker/pipeline/
-- sync_check.py), run after each alignment: {"status": "ok"|"warn"|"fail",
-- "issues": [{"code", "message", "lines"?}]}. Shown as a warning on songs
-- in the library and listed by scripts/sync-report.mjs.
alter table lyrics add column if not exists sync_check jsonb;
