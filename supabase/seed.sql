-- MVP1 manual seed: one demo room + one song, so the stage/remote views have
-- something real to render before the YouTube/worker pipeline exists (MVP2).
--
-- To use it:
--   1. In Supabase Studio -> Storage, open the "stems" bucket (created by
--      migration 0002) and upload three short test audio files under the
--      path demo-song/, named to match the storage_path values below:
--        demo-song/instrumental.mp3
--        demo-song/lead_vocal.mp3
--        demo-song/backing_vocal.mp3
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
  ('00000000-0000-0000-0000-000000000002', 'instrumental', 'demo-song/instrumental.mp3'),
  ('00000000-0000-0000-0000-000000000002', 'lead_vocal', 'demo-song/lead_vocal.mp3'),
  ('00000000-0000-0000-0000-000000000002', 'backing_vocal', 'demo-song/backing_vocal.mp3')
on conflict (song_id, type) do nothing;
