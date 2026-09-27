-- Tables the browser subscribes to via supabase.channel(...).on('postgres_changes', ...)
-- must be added to the realtime publication, or subscribers never receive
-- change events even though the writes themselves succeed.

alter publication supabase_realtime add table queue_items;
