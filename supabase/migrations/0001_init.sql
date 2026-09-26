-- Karaoke App — schema inicial (MVP1: fila + player, sem worker ainda)

create extension if not exists "pgcrypto";

create table rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table guests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  display_name text not null,
  client_token uuid not null,
  created_at timestamptz not null default now()
);
create index guests_room_id_idx on guests(room_id);
create unique index guests_room_client_token_idx on guests(room_id, client_token);

create table songs (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text unique,
  title text not null,
  artist_guess text,
  duration_seconds integer,
  thumbnail_url text,
  status text not null default 'pending' check (status in ('pending','queued','processing','ready','failed')),
  detected_key text,
  detected_scale text,
  created_at timestamptz not null default now()
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  requested_by uuid references guests(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','claimed','downloading','separating','uploading','done','error')),
  stage_label text,
  progress_pct integer not null default 0,
  claimed_by_worker text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index processing_jobs_status_idx on processing_jobs(status);

create table stems (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs(id) on delete cascade,
  type text not null check (type in ('original','instrumental','lead_vocal','backing_vocal')),
  storage_path text not null,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  unique (song_id, type)
);

create table lyrics (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs(id) on delete cascade unique,
  source text not null default 'lrclib',
  lrclib_id text,
  raw_lrc text,
  offset_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table song_display_settings (
  song_id uuid primary key references songs(id) on delete cascade,
  art_url text,
  blur numeric not null default 0,
  opacity numeric not null default 0.6,
  contrast numeric not null default 1,
  mix_instrumental_vol numeric not null default 1,
  mix_lead_vol numeric not null default 1,
  mix_backing_vol numeric not null default 1,
  updated_at timestamptz not null default now()
);

create table queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  song_id uuid not null references songs(id) on delete cascade,
  requested_by uuid references guests(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','now_playing','played','removed')),
  added_at timestamptz not null default now()
);
create index queue_items_room_id_idx on queue_items(room_id);

-- Row Level Security: liberado para leitura/escrita via chave anon (MVP pessoal/familiar).
-- Escrita sensível de verdade (jobs do worker) passa pelas rotas server-side com a service role key,
-- que ignora RLS — por isso as policies abaixo cobrem o necessário para o app funcionar com a anon key.

alter table rooms enable row level security;
alter table guests enable row level security;
alter table songs enable row level security;
alter table processing_jobs enable row level security;
alter table stems enable row level security;
alter table lyrics enable row level security;
alter table song_display_settings enable row level security;
alter table queue_items enable row level security;

create policy "public read rooms" on rooms for select using (true);
create policy "public read songs" on songs for select using (true);
create policy "public read stems" on stems for select using (true);
create policy "public read lyrics" on lyrics for select using (true);
create policy "public read song_display_settings" on song_display_settings for select using (true);
create policy "public read processing_jobs" on processing_jobs for select using (true);

create policy "public read queue_items" on queue_items for select using (true);
create policy "public insert queue_items" on queue_items for insert with check (true);
create policy "public update own queue_items" on queue_items for update using (true);

create policy "public read guests" on guests for select using (true);
create policy "public insert guests" on guests for insert with check (true);
