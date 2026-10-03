-- When a queue entry finished playing, so the stage's "previous song" button
-- can go back to the one played most recently (added_at is request order,
-- not play order).
alter table queue_items add column if not exists played_at timestamptz;
