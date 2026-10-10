-- ============================================================
--  CTA BAGES · Temporización de los tests
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  - Cada test puede tener: sin límite · tiempo total · tiempo por pregunta.
--  - El servidor mide el tiempo real desde que el árbitro abre el test
--    (tabla committee_runs), así el límite no depende solo del navegador.
-- ============================================================

alter table public.committee_tests
  add column if not exists timer_mode text not null default 'none',
  add column if not exists time_minutes int,
  add column if not exists seconds_per_question int;

alter table public.committee_tests drop constraint if exists committee_tests_timer_chk;
alter table public.committee_tests add constraint committee_tests_timer_chk check (
  timer_mode in ('none', 'total', 'perQuestion')
  and (time_minutes is null or time_minutes between 1 and 600)
  and (seconds_per_question is null or seconds_per_question between 5 and 3600)
);

-- Cuándo empezó cada árbitro su intento actual (solo se toca desde las funciones).
create table if not exists public.committee_runs (
  test_id    uuid not null references public.committee_tests(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (test_id, user_id)
);
alter table public.committee_runs enable row level security;
revoke all on public.committee_runs from anon, authenticated;

-- ---------- committee_my_tests: añade la configuración de tiempo ----------
drop function if exists public.committee_my_tests();
create function public.committee_my_tests()
returns table(
  id uuid, title text, month text, opens_at timestamptz, closes_at timestamptz,
  max_attempts int, attempts_used int, best_score int, best_total int, total_questions int,
  timer_mode text, time_minutes int, seconds_per_question int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  return query
  select t.id, t.title, t.month, t.opens_at, t.closes_at, t.max_attempts,
         (select count(*)::int from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.score)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.total)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select count(*)::int from public.committee_test_questions q where q.test_id = t.id),
         t.timer_mode, t.time_minutes, t.seconds_per_question
  from public.committee_tests t
  where t.published
  order by t.opens_at desc;
end $$;

revoke all on function public.committee_my_tests() from public, anon;
grant execute on function public.committee_my_tests() to authenticated;

-- ---------- committee_get_test: devuelve la configuración y marca el inicio ----------
create or replace function public.committee_get_test(p_test_id uuid)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  t    public.committee_tests;
  used int;
  qs   json;
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  select * into t from public.committee_tests where id = p_test_id and published;
  if not found then raise exception 'not_found'; end if;
  if t.opens_at > now() then raise exception 'not_open'; end if;
  if t.closes_at is not null and t.closes_at <= now() then raise exception 'closed'; end if;
  select count(*) into used from public.committee_attempts where test_id = p_test_id and user_id = auth.uid();
  if used >= t.max_attempts then raise exception 'no_attempts_left'; end if;
  select json_agg(json_build_object('pos', q.pos, 'question', q.question, 'options', q.options, 'rule', q.rule) order by q.pos)
    into qs from public.committee_test_questions q where q.test_id = p_test_id;

  insert into public.committee_runs(test_id, user_id, started_at)
  values (p_test_id, auth.uid(), now())
  on conflict (test_id, user_id) do update set started_at = now();

  return json_build_object(
    'id', t.id, 'title', t.title, 'max_attempts', t.max_attempts, 'attempts_used', used,
    'timer_mode', t.timer_mode, 'time_minutes', t.time_minutes, 'seconds_per_question', t.seconds_per_question,
    'questions', coalesce(qs, '[]'::json)
  );
end $$;

-- ---------- committee_submit_attempt: comprueba el límite de tiempo ----------
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
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  select * into t from public.committee_tests where id = p_test_id and published;
  if not found then raise exception 'not_found'; end if;
  if t.opens_at > now() then raise exception 'not_open'; end if;
  if t.closes_at is not null and t.closes_at <= now() then raise exception 'closed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || auth.uid()::text, 0));

  select count(*) into used from public.committee_attempts where test_id = p_test_id and user_id = auth.uid();
  if used >= t.max_attempts then raise exception 'no_attempts_left'; end if;

  select count(*), count(*) filter (where p_answers ->> q.pos::text = q.correct)
    into tot, sc
  from public.committee_test_questions q where q.test_id = p_test_id;
  if tot = 0 then raise exception 'no_questions'; end if;

  -- Tiempo real medido por el servidor (si por algún motivo no hay inicio, se usa el del navegador).
  select r.started_at into started from public.committee_runs r where r.test_id = p_test_id and r.user_id = auth.uid();
  if started is not null then
    dur := greatest(0, extract(epoch from (now() - started))::int);
    if t.timer_mode = 'total' and t.time_minutes is not null then
      limit_sec := t.time_minutes * 60;
    elsif t.timer_mode = 'perQuestion' and t.seconds_per_question is not null then
      limit_sec := t.seconds_per_question * tot;
    end if;
    -- 30 s de margen para la latencia de la red.
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

revoke all on function public.committee_get_test(uuid) from public, anon;
grant execute on function public.committee_get_test(uuid) to authenticated;
revoke all on function public.committee_submit_attempt(uuid, jsonb, int) from public, anon;
grant execute on function public.committee_submit_attempt(uuid, jsonb, int) to authenticated;
