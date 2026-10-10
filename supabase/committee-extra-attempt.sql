-- ============================================================
--  CTA BAGES · Dar otro intento a un árbitro
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Para cuando a un árbitro se le cierra el test de golpe o se le va
--  internet: el administrador le concede un intento extra desde el detalle
--  del test. Funciona aunque el test ya haya cerrado o ya no le queden
--  intentos. El resultado anterior se conserva (en la clasificación cuenta
--  el mejor intento).
-- ============================================================

create table if not exists public.committee_attempt_grants (
  test_id    uuid not null references public.committee_tests(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  extra      int  not null default 1 check (extra between 1 and 5),
  granted_at timestamptz not null default now(),
  primary key (test_id, user_id)
);

alter table public.committee_attempt_grants enable row level security;

revoke all on public.committee_attempt_grants from anon, authenticated;
grant select on public.committee_attempt_grants to authenticated;

drop policy if exists committee_attempt_grants_admin_read on public.committee_attempt_grants;
create policy committee_attempt_grants_admin_read on public.committee_attempt_grants
  for select to authenticated using (public.is_committee_admin());

-- Conceder un intento extra (hasta 5 por árbitro y test). Devuelve cuántos extra tiene ahora.
create or replace function public.committee_admin_grant_attempt(p_test_id uuid, p_user_id uuid)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.committee_tests t where t.id = p_test_id) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.committee_members m where m.user_id = p_user_id) then raise exception 'not_found'; end if;
  insert into public.committee_attempt_grants(test_id, user_id, extra)
  values (p_test_id, p_user_id, 1)
  on conflict (test_id, user_id)
  do update set extra = least(public.committee_attempt_grants.extra + 1, 5), granted_at = now()
  returning extra into n;
  return n;
end $$;

-- Quitar un intento extra concedido por error.
create or replace function public.committee_admin_revoke_attempt(p_test_id uuid, p_user_id uuid)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  update public.committee_attempt_grants
     set extra = extra - 1
   where test_id = p_test_id and user_id = p_user_id
   returning extra into n;
  if n is not null and n <= 0 then
    delete from public.committee_attempt_grants where test_id = p_test_id and user_id = p_user_id;
    n := 0;
  end if;
  return coalesce(n, 0);
end $$;

revoke all on function public.committee_admin_grant_attempt(uuid, uuid) from public, anon;
grant execute on function public.committee_admin_grant_attempt(uuid, uuid) to authenticated;
revoke all on function public.committee_admin_revoke_attempt(uuid, uuid) from public, anon;
grant execute on function public.committee_admin_revoke_attempt(uuid, uuid) to authenticated;

-- ---------- committee_my_tests: tiene en cuenta el intento extra ----------
create or replace function public.committee_my_tests()
returns table(
  id uuid, title text, month text, opens_at timestamptz, closes_at timestamptz,
  max_attempts int, attempts_used int, best_score int, best_total int, total_questions int,
  timer_mode text, time_minutes int, seconds_per_question int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  return query
  select t.id, t.title, t.month, t.opens_at,
         case when exists (select 1 from public.committee_attempt_grants g where g.test_id = t.id and g.user_id = auth.uid())
              then null else t.closes_at end,
         t.max_attempts + coalesce((select g.extra from public.committee_attempt_grants g where g.test_id = t.id and g.user_id = auth.uid()), 0),
         (select count(*)::int from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.score)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.total)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select count(*)::int from public.committee_test_questions q where q.test_id = t.id),
         t.timer_mode, t.time_minutes, t.seconds_per_question
  from public.committee_tests t
  where t.published
  order by t.opens_at desc;
end $$;

-- ---------- committee_get_test ----------
create or replace function public.committee_get_test(p_test_id uuid)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  t         public.committee_tests;
  used      int;
  qs        json;
  g_extra   int;
  has_grant boolean;
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  select * into t from public.committee_tests where id = p_test_id and published;
  if not found then raise exception 'not_found'; end if;
  select coalesce(max(g.extra), 0), count(*) > 0 into g_extra, has_grant
    from public.committee_attempt_grants g where g.test_id = p_test_id and g.user_id = auth.uid();
  if t.opens_at > now() then raise exception 'not_open'; end if;
  if t.closes_at is not null and t.closes_at <= now() and not has_grant then raise exception 'closed'; end if;
  select count(*) into used from public.committee_attempts where test_id = p_test_id and user_id = auth.uid();
  if used >= t.max_attempts + g_extra then raise exception 'no_attempts_left'; end if;
  select json_agg(json_build_object('pos', q.pos, 'question', q.question, 'options', q.options, 'rule', q.rule) order by q.pos)
    into qs from public.committee_test_questions q where q.test_id = p_test_id;

  insert into public.committee_runs(test_id, user_id, started_at)
  values (p_test_id, auth.uid(), now())
  on conflict (test_id, user_id) do update set started_at = now();

  return json_build_object(
    'id', t.id, 'title', t.title, 'max_attempts', t.max_attempts + g_extra, 'attempts_used', used,
    'timer_mode', t.timer_mode, 'time_minutes', t.time_minutes, 'seconds_per_question', t.seconds_per_question,
    'shuffle_mode', t.shuffle_mode,
    'questions', coalesce(qs, '[]'::json)
  );
end $$;

-- ---------- committee_submit_attempt ----------
create or replace function public.committee_submit_attempt(p_test_id uuid, p_answers jsonb, p_duration int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  t         public.committee_tests;
  used      int;
  sc        int;
  tot       int;
  new_no    int;
  started   timestamptz;
  dur       int;
  limit_sec int;
  g_extra   int;
  has_grant boolean;
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  select * into t from public.committee_tests where id = p_test_id and published;
  if not found then raise exception 'not_found'; end if;
  select coalesce(max(g.extra), 0), count(*) > 0 into g_extra, has_grant
    from public.committee_attempt_grants g where g.test_id = p_test_id and g.user_id = auth.uid();
  if t.opens_at > now() then raise exception 'not_open'; end if;
  if t.closes_at is not null and t.closes_at <= now() and not has_grant then raise exception 'closed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || auth.uid()::text, 0));

  select count(*) into used from public.committee_attempts where test_id = p_test_id and user_id = auth.uid();
  if used >= t.max_attempts + g_extra then raise exception 'no_attempts_left'; end if;

  select count(*), count(*) filter (where p_answers ->> q.pos::text = q.correct)
    into tot, sc
  from public.committee_test_questions q where q.test_id = p_test_id;
  if tot = 0 then raise exception 'no_questions'; end if;

  select r.started_at into started from public.committee_runs r where r.test_id = p_test_id and r.user_id = auth.uid();
  if started is not null then
    dur := greatest(0, extract(epoch from (now() - started))::int);
    if t.timer_mode = 'total' and t.time_minutes is not null then
      limit_sec := t.time_minutes * 60;
    elsif t.timer_mode = 'perQuestion' and t.seconds_per_question is not null then
      limit_sec := t.seconds_per_question * tot;
    end if;
    if limit_sec is not null and dur > limit_sec + 30 then raise exception 'time_up'; end if;
  else
    dur := coalesce(p_duration, 0);
  end if;
  dur := least(greatest(dur, 0), 86400);

  new_no := used + 1;
  insert into public.committee_attempts(test_id, user_id, attempt_no, score, total, duration_sec, answers)
  values (p_test_id, auth.uid(), new_no, sc, tot, dur, coalesce(p_answers, '{}'::jsonb));

  delete from public.committee_runs where test_id = p_test_id and user_id = auth.uid();

  return json_build_object(
    'score', sc, 'total', tot, 'attempt_no', new_no,
    'review', case when t.closes_at is null then public.committee_build_review(p_test_id, p_answers) else null end
  );
end $$;

revoke all on function public.committee_my_tests() from public, anon;
grant execute on function public.committee_my_tests() to authenticated;
revoke all on function public.committee_get_test(uuid) from public, anon;
grant execute on function public.committee_get_test(uuid) to authenticated;
revoke all on function public.committee_submit_attempt(uuid, jsonb, int) from public, anon;
grant execute on function public.committee_submit_attempt(uuid, jsonb, int) to authenticated;
