-- e-meyar student version: database schema.
-- Run in the NEW student Supabase project: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. Safe to run again (idempotent).
--
-- Security model (same as the teacher app): the server has only the anon key
-- and calls Supabase with the student's own JWT, so Row Level Security below
-- is the wall between students.

-- 1. Table ------------------------------------------------------------------

create table if not exists public.student_essays (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null default auth.uid()
                             references auth.users (id) on delete cascade,
  topic          text        not null,
  essay_text     text        not null,
  grading_result jsonb       not null,
  coaching       jsonb,
  final_score    numeric     not null,
  created_at     timestamptz default now()
);

-- History list: "my essays, newest first".
create index if not exists student_essays_user_created_idx
  on public.student_essays (user_id, created_at desc);

-- 2. Row Level Security -------------------------------------------------------

alter table public.student_essays enable row level security;

drop policy if exists "student_essays_select_own" on public.student_essays;
create policy "student_essays_select_own" on public.student_essays
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "student_essays_insert_own" on public.student_essays;
create policy "student_essays_insert_own" on public.student_essays
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "student_essays_delete_own" on public.student_essays;
create policy "student_essays_delete_own" on public.student_essays
  for delete to authenticated
  using (user_id = auth.uid());

-- Update: only the owner, and (by the column grant in step 3) only `coaching`.
-- grading_result, final_score, topic, essay_text etc. can never be changed.
drop policy if exists "student_essays_update_own_coaching" on public.student_essays;
create policy "student_essays_update_own_coaching" on public.student_essays
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3. Table privileges -----------------------------------------------------------
-- Supabase grants ALL on new public tables to anon and authenticated. RLS
-- policies cannot limit columns, so take that back and grant exactly what
-- the policies above allow. anon (not logged in) gets nothing.

revoke all on table public.student_essays from anon, authenticated;
grant select, insert, delete on table public.student_essays to authenticated;
grant update (coaching) on table public.student_essays to authenticated;

-- 4. Daily grading usage (Sprint 2) -------------------------------------------
-- One row per successful grade. The daily limit counts these rows, not
-- student_essays, because a student can delete essays. Students can add and
-- read their own rows only: no update, no delete policy (and no grant).

create table if not exists public.grading_usage (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);

create index if not exists grading_usage_user_created_idx
  on public.grading_usage (user_id, created_at desc);

alter table public.grading_usage enable row level security;

drop policy if exists "grading_usage_select_own" on public.grading_usage;
create policy "grading_usage_select_own" on public.grading_usage
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "grading_usage_insert_own" on public.grading_usage;
create policy "grading_usage_insert_own" on public.grading_usage
  for insert to authenticated
  with check (user_id = auth.uid());

revoke all on table public.grading_usage from anon, authenticated;
grant select, insert on table public.grading_usage to authenticated;

-- 5. Rewrites and practice (Sprint 3) -----------------------------------------
-- a. A rewrite points at the essay it rewrites. The insert check also makes
--    sure the parent belongs to the same student.

alter table public.student_essays
  add column if not exists parent_essay_id uuid null
  references public.student_essays (id) on delete set null;

drop policy if exists "student_essays_insert_own" on public.student_essays;
create policy "student_essays_insert_own" on public.student_essays
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      parent_essay_id is null
      or exists (
        -- "student_essays.parent_essay_id" = the NEW row. Unqualified, the
        -- name would resolve to p.parent_essay_id inside this subquery and
        -- the check would never pass.
        select 1 from public.student_essays p
        where p.id = student_essays.parent_essay_id and p.user_id = auth.uid()
      )
    )
  );

-- b. Practice sets: 3 questions on the most frequent error category of an
--    essay. Students add and read their own sets and may only fill in
--    answers, score and reported. No delete policy (and no grant), so the
--    daily practice count can't be reset.

create table if not exists public.practice_sets (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  essay_id   uuid        not null references public.student_essays (id) on delete cascade,
  category   text        not null,
  questions  jsonb       not null,
  answers    jsonb,
  score      int,
  reported   jsonb       default '[]',
  created_at timestamptz default now(),
  unique (essay_id, category)
);

create index if not exists practice_sets_user_created_idx
  on public.practice_sets (user_id, created_at desc);

alter table public.practice_sets enable row level security;

drop policy if exists "practice_sets_select_own" on public.practice_sets;
create policy "practice_sets_select_own" on public.practice_sets
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "practice_sets_insert_own" on public.practice_sets;
create policy "practice_sets_insert_own" on public.practice_sets
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.student_essays e
      where e.id = practice_sets.essay_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "practice_sets_update_own" on public.practice_sets;
create policy "practice_sets_update_own" on public.practice_sets
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.practice_sets from anon, authenticated;
grant select, insert on table public.practice_sets to authenticated;
grant update (answers, score, reported) on table public.practice_sets to authenticated;

-- 6. Check (read-only). The SQL Editor shows only the last result, so this is
-- one query. Expect, for student_essays: rls true; 4 policies
-- (select/insert/delete/update); authenticated SELECT, INSERT, DELETE and
-- UPDATE on coaching only. For grading_usage: rls true; 2 policies
-- (select/insert); authenticated SELECT, INSERT only. For practice_sets: rls
-- true; 3 policies (select/insert/update); authenticated SELECT, INSERT and
-- UPDATE on answers, reported, score only. student_essays also has the
-- parent_essay_id column. No anon rows.

select t.tbl as tbl, 'rls' as what, c.relrowsecurity::text as detail
from (values ('student_essays'), ('grading_usage'), ('practice_sets')) t(tbl)
join pg_class c on c.oid = ('public.' || t.tbl)::regclass
union all
select tablename, 'policy', policyname || ' (' || cmd || ')'
from pg_policies where schemaname = 'public' and tablename in ('student_essays', 'grading_usage', 'practice_sets')
union all
select table_name, 'table grant', grantee || ': ' || privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('student_essays', 'grading_usage', 'practice_sets')
  and grantee in ('anon', 'authenticated')
union all
select table_name, 'column grant', grantee || ': ' || privilege_type || ' (' || column_name || ')'
from information_schema.column_privileges
where table_schema = 'public' and table_name in ('student_essays', 'grading_usage', 'practice_sets')
  and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'
union all
select table_name, 'column', column_name || ' ' || data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'student_essays' and column_name = 'parent_essay_id'
order by 1, 2, 3;
