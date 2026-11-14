-- =====================================================================
-- 0006 — Super admins can disable a participant's access
--
--  * participants.disabled (+ who/when, recorded automatically)
--  * A disabled participant cannot submit feedback (enforced by a trigger on
--    responses, so every path is covered) and sees no sessions.
--  * check_participant reports disabled=true (never a name) so the app can show
--    a polite "contact your instructor" message.
--  * Past feedback is untouched and stays in reports.
-- =====================================================================

alter table public.participants add column if not exists disabled boolean not null default false;
alter table public.participants add column if not exists disabled_at timestamptz;
alter table public.participants add column if not exists disabled_by text;

-- Record who changed access and when (cannot be spoofed from the client).
create or replace function public.participant_access_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.disabled is distinct from old.disabled then
    if new.disabled then
      new.disabled_at := now();
      new.disabled_by := lower(auth.jwt() ->> 'email');
    else
      new.disabled_at := null;
      new.disabled_by := null;
    end if;
  else
    new.disabled_at := old.disabled_at;
    new.disabled_by := old.disabled_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_participant_access_audit on public.participants;
create trigger trg_participant_access_audit
  before update on public.participants
  for each row execute function public.participant_access_audit();

-- Block feedback from disabled participants, whatever the path.
create or replace function public.response_block_disabled()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from participants where code = new.participant_code and disabled) then
    raise exception 'Your access to give feedback is currently disabled. Please contact your instructor.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_response_block_disabled on public.responses;
create trigger trg_response_block_disabled
  before insert on public.responses
  for each row execute function public.response_block_disabled();

revoke all on function public.participant_access_audit() from public, anon;
revoke all on function public.response_block_disabled() from public, anon;

-- Report disabled status (no names) so the app can explain.
create or replace function public.check_participant(p_contact text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare n record; p record;
begin
  select * into n from normalize_contact(p_contact);
  if n.contact is null then
    return jsonb_build_object('valid', false, 'registered', false);
  end if;
  select cohort_id, disabled into p from participants where contact = n.contact;
  return jsonb_build_object('valid', true, 'registered', found,
                            'cohort_id', case when found then p.cohort_id end,
                            'disabled', case when found then p.disabled else false end);
end;
$$;

-- Disabled participants see no sessions.
create or replace function public.list_open_sessions(p_contact text, p_cohort_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare n record; v_code text; v_disabled boolean;
begin
  select * into n from normalize_contact(p_contact);
  select code, disabled into v_code, v_disabled from participants where contact = n.contact;
  if coalesce(v_disabled, false) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'session_number', s.session_number, 'title', s.title,
      'session_date', s.session_date, 'topic', s.topic, 'materials_url', s.materials_url,
      'already_submitted', exists (select 1 from responses r
                                    where r.session_id = s.id and r.participant_code = v_code))
      order by s.session_number)
    from sessions s join cohorts c on c.id = s.cohort_id
    where s.cohort_id = p_cohort_id and s.feedback_open and c.active
  ), '[]'::jsonb);
end;
$$;

insert into public.schema_migrations (filename) values ('0006_participant_access.sql') on conflict do nothing;
