-- Private bucket for original audio + stems. No public/anon storage policies
-- are created: every read goes through app/api routes using the service-role
-- key, which mints short-lived signed URLs (see lib/supabase/server.ts).

insert into storage.buckets (id, name, public)
values ('stems', 'stems', false)
on conflict (id) do nothing;
