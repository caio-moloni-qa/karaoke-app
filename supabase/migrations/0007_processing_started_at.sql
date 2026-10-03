-- When the worker picked the job up, so the processing panel can show how
-- long a song has been processing (created_at is when it was queued).
alter table processing_jobs add column if not exists started_at timestamptz;
