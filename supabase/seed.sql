-- MVP1 manual seed: one demo room + one song, so the stage/remote views have
-- something real to render before the YouTube/worker pipeline exists (MVP2).
--
-- To use it:
--   1. Create `apps/worker/storage/` and place three short test audio files
--      at its root, named to match the storage_path values below (audio is
--      served from local disk, not Supabase Storage — see
--      apps/web/lib/stemsStorage.ts):
--        instrumental.mp3
--        lead_vocal.mp3
--        backing_vocal.mp3
--   2. Run this file (`supabase db reset`, or paste into the SQL editor).
--   3. Visit /room/00000000-0000-0000-0000-000000000001 on a phone and
--      /stage/00000000-0000-0000-0000-000000000001 on the big screen.

insert into rooms (id, slug, name)
values ('00000000-0000-0000-0000-000000000001', 'demo', 'Demo Room')
on conflict (id) do nothing;

insert into songs (id, title, artist_guess, status)
values ('00000000-0000-0000-0000-000000000002', 'Demo Song', 'Demo Artist', 'ready')
on conflict (id) do nothing;

insert into stems (song_id, type, storage_path)
values
  ('00000000-0000-0000-0000-000000000002', 'instrumental', 'instrumental.mp3'),
  ('00000000-0000-0000-0000-000000000002', 'lead_vocal', 'lead_vocal.mp3'),
  ('00000000-0000-0000-0000-000000000002', 'backing_vocal', 'backing_vocal.mp3')
on conflict (song_id, type) do nothing;
