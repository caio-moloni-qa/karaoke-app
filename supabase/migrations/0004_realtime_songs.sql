-- Room/stage pages now also subscribe to `songs` (to reflect processing
-- status live while the worker downloads/separates a requested song).
alter publication supabase_realtime add table songs;
