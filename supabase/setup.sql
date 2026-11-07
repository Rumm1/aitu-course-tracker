-- Run once in this project's Supabase SQL Editor. Existing data is retained.
begin;
create table if not exists public.course_tracker_data (
 user_id uuid not null references auth.users(id) on delete cascade,
 space text not null check (length(space) between 1 and 180),
 revision bigint not null default 1 check (revision > 0),
 data jsonb not null check (jsonb_typeof(data) = 'object'),
 updated_at timestamptz not null default now(),
 primary key (user_id, space)
);
alter table public.course_tracker_data enable row level security;
revoke all on public.course_tracker_data from anon;
grant select, insert, update on public.course_tracker_data to authenticated;
drop policy if exists tracker_read_own on public.course_tracker_data;
create policy tracker_read_own on public.course_tracker_data for select to authenticated
 using ((select auth.uid()) = user_id);
drop policy if exists tracker_insert_own on public.course_tracker_data;
create policy tracker_insert_own on public.course_tracker_data for insert to authenticated
 with check ((select auth.uid()) = user_id);
drop policy if exists tracker_update_own on public.course_tracker_data;
create policy tracker_update_own on public.course_tracker_data for update to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.save_course_tracker(p_space text, p_revision bigint, p_data jsonb)
returns setof public.course_tracker_data
language plpgsql security invoker set search_path = public
as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>5242880
    or jsonb_typeof(p_data->'records') is distinct from 'object'
    or jsonb_typeof(p_data->'settings') is distinct from 'object'
    or jsonb_typeof(p_data->'customCourses') is distinct from 'array'
 then raise exception 'Invalid tracker document' using errcode='22023'; end if;
 if p_revision=0 then
  return query insert into public.course_tracker_data(user_id,space,data)
   values(auth.uid(),p_space,p_data) on conflict do nothing returning *;
 else
  return query update public.course_tracker_data set data=p_data,revision=revision+1,updated_at=now()
   where user_id=auth.uid() and space=p_space and revision=p_revision returning *;
 end if;
 if not found then raise exception 'Tracker changed on another device; reload and merge' using errcode='40001'; end if;
end;
$$;
revoke all on function public.save_course_tracker(text,bigint,jsonb) from public,anon;
grant execute on function public.save_course_tracker(text,bigint,jsonb) to authenticated;
commit;

-- Must show row_security_enabled=true and exactly three owner policies.
select relrowsecurity as row_security_enabled from pg_class where oid='public.course_tracker_data'::regclass;
select policyname,cmd,roles from pg_policies where schemaname='public' and tablename='course_tracker_data';
