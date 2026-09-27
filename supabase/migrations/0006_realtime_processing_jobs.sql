-- Room/stage pages now also subscribe to `processing_jobs` to drive a live
-- progress bar while a song is downloading/separating/uploading.
alter publication supabase_realtime add table processing_jobs;
