-- =====================================================================
-- 0004 — Feedback table + saved table views
--
--  * feedback_detail: one row per response with its answers (admin only).
--    No names or contacts — only the internal participant code.
--  * saved_views: named table layouts (column order, visibility, widths,
--    density, sort) per admin, so a view follows you across devices.
-- =====================================================================

create or replace view public.feedback_detail
with (security_invoker = true) as
select
  r.id as response_id,
  r.submitted_at,
  c.id as cohort_id, c.course_name, c.cohort,
  s.id as session_id, s.session_number, s.title as session_title, s.session_date,
  r.participant_code,
  r.comment,
  r.question_set_version,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'question_id', ra.question_id, 'version', ra.question_version, 'rating', ra.rating)
             order by ra.question_id)
    from public.response_answers ra where ra.response_id = r.id
  ), '[]'::jsonb) as answers
from public.responses r
join public.sessions s on s.id = r.session_id
join public.cohorts c on c.id = r.cohort_id;

revoke all on public.feedback_detail from anon;
grant select on public.feedback_detail to authenticated;

-- ---------------------------------------------------------------------
create table if not exists public.saved_views (
  id bigint generated always as identity primary key,
  owner_email text not null default lower(auth.jwt() ->> 'email'),
  table_key text not null check (char_length(table_key) between 1 and 60),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_email, table_key, name)
);

alter table public.saved_views enable row level security;
revoke all on public.saved_views from anon;
grant select, insert, update, delete on public.saved_views to authenticated;

-- Each admin sees and edits only their own views.
drop policy if exists own_views on public.saved_views;
create policy own_views on public.saved_views for all to authenticated
  using (public.is_admin() and owner_email = lower(auth.jwt() ->> 'email'))
  with check (public.is_admin() and owner_email = lower(auth.jwt() ->> 'email'));

insert into public.schema_migrations (filename) values ('0004_feedback_views.sql') on conflict do nothing;
