-- Backs the worker online/offline indicator. The claim endpoint upserts a
-- row here on every poll cycle (whether or not a job was available), so a
-- worker counts as "online" as long as its last_seen_at is recent — no
-- separate heartbeat call needed from the worker script.
create table workers (
  id text primary key,
  last_seen_at timestamptz not null default now()
);

alter table workers enable row level security;
create policy "public read workers" on workers for select using (true);
