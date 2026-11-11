-- CONTRACT PHASE ONLY: run after the new RPC-based frontend is deployed and verified.
-- Kept outside migrations so a normal expand-phase push cannot break the old editor.
begin;
revoke insert (id,display_name,updated_at), update (id,display_name,updated_at)
  on public.profiles from authenticated;
drop policy if exists word_atlas_legacy_insert on public.profiles;
drop policy if exists word_atlas_legacy_update on public.profiles;
-- Persistent restrictive markers prevent an accidental expand rerun from reopening writes.
drop policy if exists word_atlas_rpc_only_insert on public.profiles;
create policy word_atlas_rpc_only_insert on public.profiles as restrictive for insert to authenticated with check (false);
drop policy if exists word_atlas_rpc_only_update on public.profiles;
create policy word_atlas_rpc_only_update on public.profiles as restrictive for update to authenticated using (false) with check (false);
notify pgrst, 'reload schema';
commit;
