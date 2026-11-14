-- =====================================================================
-- Course Session Feedback App — Supabase schema
-- Mirrors the spec's Google Sheet tabs as Postgres tables:
--   Settings, Courses (cohorts), Sessions, Questions,
--   Participants (private), Responses, Summary (views).
--
-- Security model
--   * The public (anon) role has NO direct access to any table.
--   * Participants interact only through SECURITY DEFINER functions
--     (get_app_config, check_participant, register_participant,
--      list_open_sessions, submit_feedback). These never return
--     names, contacts or participant codes.
--   * The owner signs in with Supabase Auth; e-mails listed in
--     public.admins get read/write access via RLS + admin functions.
--
-- Safe to re-run (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Admins (owner accounts)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(auth.jwt() ->> 'email')
  );
$$;

-- ---------------------------------------------------------------------
-- Settings  (key / value)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('app_title', 'Session Feedback'),
  ('min_responses_for_summary', '5'),
  ('question_set_version', '1'),
  ('privacy_why',
   'Your name and your mobile number or email are collected only so that this app can recognise you in future sessions, which saves you from registering again. They are not used for any other purpose.'),
  ('privacy_how',
   E'Your details are kept confidential and are never shared with anyone.\nYour name, mobile number and email never appear in any report or summary.\nYour ratings are stored against an internal code, not your name or contact.\nFeedback is used only to improve the sessions and courses.'),
  ('consent_text', 'I agree to my details being used as described above.'),
  ('contact_hint', 'Enter either your mobile number or your email. Use the same one in every session.'),
  ('comment_prompt', 'Anything you''d like to add about this session?')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Courses / cohorts  (a repeat run of a course is a new cohort)
-- ---------------------------------------------------------------------
create table if not exists public.cohorts (
  id bigint generated always as identity primary key,
  course_name text not null,
  cohort text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (course_name, cohort)
);

-- ---------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  cohort_id bigint not null references public.cohorts(id) on delete restrict,
  session_number int not null,
  title text not null,
  session_date date,
  topic text,
  feedback_open boolean not null default false,
  materials_url text,
  created_at timestamptz not null default now(),
  unique (cohort_id, session_number)
);

-- ---------------------------------------------------------------------
-- Questions  (6 fixed statements, 1–5 scale)
-- ---------------------------------------------------------------------
create table if not exists public.questions (
  position smallint primary key check (position between 1 and 6),
  dimension text not null,
  statement text not null,
  scale_min smallint not null default 1,
  scale_max smallint not null default 5,
  active boolean not null default true,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.questions (position, dimension, statement) values
  (1, 'Clarity', 'The concepts in this session were explained clearly.'),
  (2, 'Worked examples', 'The worked examples and demonstrations helped me understand the ideas.'),
  (3, 'Doubt clearance', 'I had enough opportunity to ask questions, and my doubts were addressed.'),
  (4, 'Interaction and participation', 'The session was interactive, with discussion and activities that kept me engaged.'),
  (5, 'Materials', 'The materials and resources shared (notes, code, website) were useful.'),
  (6, 'Confidence (perceived learning)', 'I feel confident applying what was covered in this session.')
on conflict (position) do nothing;

-- Any change to wording / active flag bumps the global question-set version.
create or replace function public.bump_question_version()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v int;
begin
  if (new.statement is distinct from old.statement)
     or (new.dimension is distinct from old.dimension)
     or (new.active is distinct from old.active) then
    update public.settings
       set value = (value::int + 1)::text, updated_at = now()
     where key = 'question_set_version'
     returning value::int into v;
    new.version := v;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_question_version on public.questions;
create trigger trg_bump_question_version
  before update on public.questions
  for each row execute function public.bump_question_version();

-- ---------------------------------------------------------------------
-- Participants (PRIVATE) — internal code P001, P002, ...
-- ---------------------------------------------------------------------
create sequence if not exists public.participant_code_seq;

create table if not exists public.participants (
  id bigint generated always as identity primary key,
  code text not null unique
    default ('P' || lpad(nextval('public.participant_code_seq')::text, 3, '0')),
  name text not null,
  contact text not null unique,          -- normalised e-mail or phone
  contact_type text not null check (contact_type in ('email', 'mobile')),
  cohort_id bigint references public.cohorts(id) on delete set null,
  consent boolean not null check (consent),
  registered_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Responses — participant CODE only, never name/contact
-- ---------------------------------------------------------------------
create table if not exists public.responses (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null default now(),
  cohort_id bigint not null references public.cohorts(id),
  session_id bigint not null references public.sessions(id) on delete restrict,
  participant_code text not null references public.participants(code) on update cascade,
  q1 smallint check (q1 between 1 and 5),
  q2 smallint check (q2 between 1 and 5),
  q3 smallint check (q3 between 1 and 5),
  q4 smallint check (q4 between 1 and 5),
  q5 smallint check (q5 between 1 and 5),
  q6 smallint check (q6 between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  question_set_version int not null,
  unique (session_id, participant_code)   -- one response per participant per session
);

create index if not exists responses_session_idx on public.responses(session_id);

-- ---------------------------------------------------------------------
-- Row Level Security: anon gets nothing; admins get full access.
-- ---------------------------------------------------------------------
alter table public.admins       enable row level security;
alter table public.settings     enable row level security;
alter table public.cohorts      enable row level security;
alter table public.sessions     enable row level security;
alter table public.questions    enable row level security;
alter table public.participants enable row level security;
alter table public.responses    enable row level security;

revoke all on public.admins, public.settings, public.cohorts, public.sessions,
              public.questions, public.participants, public.responses
  from anon;

do $$
declare t text;
begin
  foreach t in array array['settings','cohorts','sessions','questions','participants','responses'] loop
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  drop policy if exists admin_read on public.admins;
  create policy admin_read on public.admins for select to authenticated using (public.is_admin());
end $$;

grant select, insert, update, delete on public.settings, public.cohorts, public.sessions,
  public.questions, public.participants, public.responses to authenticated;
grant select on public.admins to authenticated;
grant usage on sequence public.participant_code_seq to authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Normalise contact: e-mail -> lower-case; mobile -> digits (keeps leading +).
-- Returns NULL when the format is invalid.
create or replace function public.normalize_contact(p_contact text, out contact text, out contact_type text)
language plpgsql immutable
as $$
declare c text := btrim(coalesce(p_contact, ''));
begin
  if position('@' in c) > 0 then
    c := lower(c);
    if c ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
      contact := c; contact_type := 'email';
    end if;
  else
    c := regexp_replace(c, '[\s\-\(\)\.]', '', 'g');
    if c ~ '^\+?[0-9]{7,15}$' then
      contact := c; contact_type := 'mobile';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Public (participant) API — SECURITY DEFINER, minimal outputs
-- ---------------------------------------------------------------------

-- App config: settings (public subset), active cohorts, active questions.
create or replace function public.get_app_config()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'settings', (select jsonb_object_agg(key, value) from settings
                  where key in ('app_title','privacy_why','privacy_how','consent_text',
                                'contact_hint','comment_prompt','question_set_version')),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', id, 'course_name', course_name, 'cohort', cohort)
                  order by course_name, cohort)
                from cohorts where active), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
                  'position', position, 'dimension', dimension, 'statement', statement,
                  'scale_min', scale_min, 'scale_max', scale_max) order by position)
                from questions where active), '[]'::jsonb)
  );
$$;

-- Is this contact already registered? Returns only {valid, registered, cohort_id}.
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
  select cohort_id into p from participants where contact = n.contact;
  return jsonb_build_object('valid', true, 'registered', found,
                            'cohort_id', case when found then p.cohort_id end);
end;
$$;

-- First-time registration. Idempotent for an existing contact.
create or replace function public.register_participant(
  p_name text, p_contact text, p_cohort_id bigint, p_consent boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare n record;
begin
  if not coalesce(p_consent, false) then
    raise exception 'Consent is required to register.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 120 then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  select * into n from normalize_contact(p_contact);
  if n.contact is null then
    raise exception 'Please enter a valid mobile number or email.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cohorts where id = p_cohort_id and active) then
    raise exception 'Please choose your course / cohort.' using errcode = 'P0001';
  end if;

  insert into participants (name, contact, contact_type, cohort_id, consent)
  values (btrim(p_name), n.contact, n.contact_type, p_cohort_id, true)
  on conflict (contact) do nothing;

  return jsonb_build_object('registered', true);
end;
$$;

-- Open sessions for a cohort, with an "already submitted" flag for this contact.
create or replace function public.list_open_sessions(p_contact text, p_cohort_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare n record; v_code text;
begin
  select * into n from normalize_contact(p_contact);
  select code into v_code from participants where contact = n.contact;
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

-- Submit feedback. Enforces: registered, session open, one per session, all items rated.
create or replace function public.submit_feedback(
  p_contact text, p_session_id bigint, p_ratings smallint[], p_comment text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  n record; v_code text; s record; v_version int; q record;
  r smallint[] := array[null,null,null,null,null,null]::smallint[];
begin
  select * into n from normalize_contact(p_contact);
  select code into v_code from participants where contact = n.contact;
  if v_code is null then
    raise exception 'We could not find your registration. Please register first.' using errcode = 'P0001';
  end if;

  select s2.* into s from sessions s2 join cohorts c on c.id = s2.cohort_id
   where s2.id = p_session_id and s2.feedback_open and c.active;
  if not found then
    raise exception 'Feedback for this session is closed.' using errcode = 'P0001';
  end if;

  if exists (select 1 from responses where session_id = p_session_id and participant_code = v_code) then
    raise exception 'You have already submitted feedback for this session.' using errcode = 'P0001';
  end if;

  if p_ratings is null or array_length(p_ratings, 1) <> 6 then
    raise exception 'Invalid ratings.' using errcode = 'P0001';
  end if;
  for q in select position, scale_min, scale_max from questions where active loop
    if p_ratings[q.position] is null
       or p_ratings[q.position] < q.scale_min or p_ratings[q.position] > q.scale_max then
      raise exception 'Please rate every statement.' using errcode = 'P0001';
    end if;
    r[q.position] := p_ratings[q.position];
  end loop;

  select value::int into v_version from settings where key = 'question_set_version';

  insert into responses (cohort_id, session_id, participant_code,
                         q1, q2, q3, q4, q5, q6, comment, question_set_version)
  values (s.cohort_id, s.id, v_code, r[1], r[2], r[3], r[4], r[5], r[6],
          nullif(btrim(coalesce(p_comment, '')), ''), coalesce(v_version, 1));

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    raise exception 'You have already submitted feedback for this session.' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- Summary (admin only) — averages hidden below the minimum response count
-- ---------------------------------------------------------------------
create or replace view public.session_summary
with (security_invoker = true) as
with m as (select coalesce((select value::int from public.settings
                             where key = 'min_responses_for_summary'), 5) as min_n)
select
  c.id as cohort_id, c.course_name, c.cohort,
  s.id as session_id, s.session_number, s.title, s.session_date, s.topic, s.feedback_open,
  r.question_set_version,
  count(r.id)::int as response_count,
  (count(r.id) >= m.min_n) as averages_visible,
  case when count(r.id) >= m.min_n then round(avg(r.q1), 2) end as q1_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q2), 2) end as q2_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q3), 2) end as q3_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q4), 2) end as q4_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q5), 2) end as q5_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q6), 2) end as q6_avg,
  case when count(r.id) >= m.min_n
       then round((avg(r.q1)+avg(r.q2)+avg(r.q3)+avg(r.q4)+avg(r.q5)+avg(r.q6))/6, 2) end as overall_avg
from public.sessions s
join public.cohorts c on c.id = s.cohort_id
cross join m
left join public.responses r on r.session_id = s.id
group by c.id, c.course_name, c.cohort, s.id, s.session_number, s.title, s.session_date,
         s.topic, s.feedback_open, r.question_set_version, m.min_n;

-- Per-cohort roll-up for comparing across courses / runs (same question-set version only).
create or replace view public.cohort_summary
with (security_invoker = true) as
with m as (select coalesce((select value::int from public.settings
                             where key = 'min_responses_for_summary'), 5) as min_n)
select
  c.id as cohort_id, c.course_name, c.cohort, r.question_set_version,
  count(distinct r.session_id)::int as sessions_with_feedback,
  count(r.id)::int as response_count,
  (count(r.id) >= m.min_n) as averages_visible,
  case when count(r.id) >= m.min_n then round(avg(r.q1), 2) end as q1_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q2), 2) end as q2_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q3), 2) end as q3_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q4), 2) end as q4_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q5), 2) end as q5_avg,
  case when count(r.id) >= m.min_n then round(avg(r.q6), 2) end as q6_avg,
  case when count(r.id) >= m.min_n
       then round((avg(r.q1)+avg(r.q2)+avg(r.q3)+avg(r.q4)+avg(r.q5)+avg(r.q6))/6, 2) end as overall_avg
from public.cohorts c
cross join m
join public.responses r on r.cohort_id = c.id
group by c.id, c.course_name, c.cohort, r.question_set_version, m.min_n;

-- Comments per session, without identity.
create or replace view public.session_comments
with (security_invoker = true) as
select r.session_id, r.submitted_at, r.comment
from public.responses r
where r.comment is not null;

revoke all on public.session_summary, public.cohort_summary, public.session_comments from anon;
grant select on public.session_summary, public.cohort_summary, public.session_comments to authenticated;

-- Merge two participant records (e.g. someone switched mobile <-> email).
-- Responses of p_drop_code move to p_keep_code unless that would duplicate a session.
create or replace function public.merge_participants(p_keep_code text, p_drop_code text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare moved int; skipped int;
begin
  if not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if p_keep_code = p_drop_code then
    raise exception 'Codes must differ.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------
revoke all on function public.get_app_config()                                  from public;
revoke all on function public.check_participant(text)                           from public;
revoke all on function public.register_participant(text, text, bigint, boolean) from public;
revoke all on function public.list_open_sessions(text, bigint)                   from public;
revoke all on function public.submit_feedback(text, bigint, smallint[], text)    from public;
revoke all on function public.merge_participants(text, text)                     from public;

-- Supabase grants EXECUTE to anon by default; take back the admin-only ones.
revoke execute on function public.merge_participants(text, text)                  from anon;
revoke execute on function public.normalize_contact(text)                         from anon;

grant execute on function public.get_app_config()                                  to anon, authenticated;
grant execute on function public.check_participant(text)                           to anon, authenticated;
grant execute on function public.register_participant(text, text, bigint, boolean) to anon, authenticated;
grant execute on function public.list_open_sessions(text, bigint)                   to anon, authenticated;
grant execute on function public.submit_feedback(text, bigint, smallint[], text)    to anon, authenticated;
grant execute on function public.merge_participants(text, text)                     to authenticated;
grant execute on function public.is_admin()                                         to authenticated;
