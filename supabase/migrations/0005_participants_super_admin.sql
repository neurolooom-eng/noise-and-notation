-- =====================================================================
-- 0005 — Participants list is owner-only (super admins)
--
-- Spec §5.3: only the owner can map an internal code to a person.
-- Plain admins keep full access to everything else, but can no longer
-- read or change public.participants, or merge participants.
-- =====================================================================

drop policy if exists admin_all on public.participants;
drop policy if exists super_admin_all on public.participants;
create policy super_admin_all on public.participants for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.merge_participants(p_keep_code text, p_drop_code text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare moved int; skipped int;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can merge participants.' using errcode = '42501';
  end if;
  if p_keep_code = p_drop_code then
    raise exception 'Codes must differ.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from participants where code = p_keep_code)
     or not exists (select 1 from participants where code = p_drop_code) then
    raise exception 'Both participant codes must exist.' using errcode = 'P0001';
  end if;
  update responses r set participant_code = p_keep_code
   where r.participant_code = p_drop_code
     and not exists (select 1 from responses k
                      where k.participant_code = p_keep_code and k.session_id = r.session_id);
  get diagnostics moved = row_count;
  delete from responses where participant_code = p_drop_code;
  get diagnostics skipped = row_count;
  delete from participants where code = p_drop_code;
  return jsonb_build_object('moved', moved, 'dropped_duplicates', skipped);
end;
$$;

insert into public.schema_migrations (filename) values ('0005_participants_super_admin.sql') on conflict do nothing;
