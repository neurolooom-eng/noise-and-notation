-- Admin roles. Today every listed admin has full access (public.is_admin());
-- the role column records who is a super admin, ahead of finer-grained RBAC.
-- Safe to re-run.

alter table public.admins
  add column if not exists role text not null default 'admin';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_check') then
    alter table public.admins
      add constraint admins_role_check check (role in ('super_admin', 'admin'));
  end if;
end $$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(auth.jwt() ->> 'email') and a.role = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin() from public;
revoke execute on function public.is_super_admin() from anon;
grant execute on function public.is_super_admin() to authenticated;
