-- =====================================================================
-- WEREF · Formación del Comité (Bages)
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos existentes.
--
-- Modelo de seguridad:
--   * El administrador es el usuario con email info@we-ref.com (el mismo "usuario
--     master" que usa el resto de la web).
--   * Los miembros del comité se eligen a mano. Solo ellos ven los tests.
--   * Las respuestas correctas viven en committee_test_questions, tabla que SOLO
--     lee el administrador. Los miembros reciben las preguntas sin la solución y
--     la corrección se hace en el servidor (committee_submit_attempt).
--   * Las respuestas correctas solo se muestran a los miembros cuando el test
--     ha cerrado (o enseguida si el test no tiene fecha de cierre).
--   * La clasificación solo la ve el administrador.
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.committee_members (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.committee_tests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  month        text,
  opens_at     timestamptz not null default now(),
  closes_at    timestamptz,
  max_attempts int not null default 1 check (max_attempts >= 1),
  published    boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.committee_test_questions (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.committee_tests(id) on delete cascade,
  pos         int not null,
  question    text not null,
  options     jsonb not null,
  correct     text not null check (correct in ('a','b','c','d')),
  rule        int,
  explanation text,
  unique (test_id, pos)
);

create table if not exists public.committee_attempts (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references public.committee_tests(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempt_no   int not null,
  score        int not null,
  total        int not null,
  duration_sec int,
  answers      jsonb not null,
  finished_at  timestamptz not null default now(),
  unique (test_id, user_id, attempt_no)
);

create index if not exists committee_attempts_user_idx on public.committee_attempts(user_id);
create index if not exists committee_attempts_test_idx on public.committee_attempts(test_id);

alter table public.committee_members        enable row level security;
alter table public.committee_tests          enable row level security;
alter table public.committee_test_questions enable row level security;
alter table public.committee_attempts       enable row level security;

-- ---------- Funciones auxiliares ----------

create or replace function public.is_committee_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'info@we-ref.com';
$$;

create or replace function public.is_committee_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.committee_members m where m.user_id = auth.uid());
$$;

-- ---------- Políticas (lo que se puede leer/escribir directamente) ----------

drop policy if exists committee_members_admin on public.committee_members;
create policy committee_members_admin on public.committee_members
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

drop policy if exists committee_members_self on public.committee_members;
create policy committee_members_self on public.committee_members
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists committee_tests_admin on public.committee_tests;
create policy committee_tests_admin on public.committee_tests
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

drop policy if exists committee_tests_member on public.committee_tests;
create policy committee_tests_member on public.committee_tests
  for select to authenticated
  using (published and public.is_committee_member());

-- Las preguntas con su solución: SOLO el administrador.
drop policy if exists committee_questions_admin on public.committee_test_questions;
create policy committee_questions_admin on public.committee_test_questions
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

-- Los intentos solo se crean desde committee_submit_attempt (no hay política de insert).
drop policy if exists committee_attempts_admin on public.committee_attempts;
create policy committee_attempts_admin on public.committee_attempts
  for select to authenticated
  using (public.is_committee_admin());

drop policy if exists committee_attempts_self on public.committee_attempts;
create policy committee_attempts_self on public.committee_attempts
  for select to authenticated
  using (user_id = auth.uid());

-- ---------- Funciones para cualquier usuario ----------

create or replace function public.committee_status()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'is_admin',  public.is_committee_admin(),
    'is_member', public.is_committee_member()
  );
$$;

-- Corrección/solución de un intento. Uso interno (no se concede a ningún rol).
create or replace function public.committee_build_review(p_test_id uuid, p_answers jsonb)
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'pos',         q.pos,
           'question',    q.question,
           'options',     q.options,
           'correct',     q.correct,
           'chosen',      p_answers ->> q.pos::text,
           'rule',        q.rule,
           'explanation', q.explanation
         ) order by q.pos), '[]'::json)
  from public.committee_test_questions q
  where q.test_id = p_test_id;
$$;

create or replace function public.committee_my_tests()
returns table(
  id uuid, title text, month text, opens_at timestamptz, closes_at timestamptz,
  max_attempts int, attempts_used int, best_score int, best_total int, total_questions int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  return query
  select t.id, t.title, t.month, t.opens_at, t.closes_at, t.max_attempts,
         (select count(*)::int from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.score)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select max(a.total)  from public.committee_attempts a where a.test_id = t.id and a.user_id = auth.uid()),
         (select count(*)::int from public.committee_test_questions q where q.test_id = t.id)
  from public.committee_tests t
  where t.published
  order by t.opens_at desc;
end $$;

-- Devuelve las preguntas SIN la solución, solo si el test está abierto y quedan intentos.
create or replace function public.committee_get_test(p_test_id uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
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
  return json_build_object(
    'id', t.id, 'title', t.title, 'max_attempts', t.max_attempts, 'attempts_used', used,
    'questions', coalesce(qs, '[]'::json)
  );
end $$;

-- Corrige en el servidor y guarda el intento. p_answers = {"1":"a","2":"c",...}
create or replace function public.committee_submit_attempt(p_test_id uuid, p_answers jsonb, p_duration int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  t      public.committee_tests;
  used   int;
  sc     int;
  tot    int;
  new_no int;
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

  new_no := used + 1;
  insert into public.committee_attempts(test_id, user_id, attempt_no, score, total, duration_sec, answers)
  values (p_test_id, auth.uid(), new_no, sc, tot, least(greatest(coalesce(p_duration, 0), 0), 86400), coalesce(p_answers, '{}'::jsonb));

  return json_build_object(
    'score', sc, 'total', tot, 'attempt_no', new_no,
    'review', case when t.closes_at is null then public.committee_build_review(p_test_id, p_answers) else null end
  );
end $$;

-- Ver las respuestas correctas de tu último intento (solo cuando el test ha cerrado).
create or replace function public.committee_get_review(p_test_id uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  t public.committee_tests;
  a public.committee_attempts;
begin
  if not public.is_committee_member() then raise exception 'no_access'; end if;
  select * into t from public.committee_tests where id = p_test_id and published;
  if not found then raise exception 'not_found'; end if;
  if t.closes_at is not null and t.closes_at > now() then raise exception 'review_not_available'; end if;
  select * into a from public.committee_attempts
   where test_id = p_test_id and user_id = auth.uid() order by attempt_no desc limit 1;
  if not found then raise exception 'no_attempt'; end if;
  return json_build_object(
    'title', t.title, 'score', a.score, 'total', a.total,
    'review', public.committee_build_review(p_test_id, a.answers)
  );
end $$;

-- ---------- Funciones solo para el administrador ----------

create or replace function public.committee_admin_list_members()
returns table(user_id uuid, email text, username text, full_name text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select m.user_id,
         u.email::text,
         n.username::text,
         trim(coalesce(u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         m.added_at
  from public.committee_members m
  join auth.users u on u.id = m.user_id
  left join public.usernames n on n.user_id = m.user_id
  order by m.added_at;
end $$;

create or replace function public.committee_admin_add_member(p_email text)
returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then return json_build_object('ok', false, 'error', 'not_registered'); end if;
  insert into public.committee_members(user_id) values (uid) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function public.committee_admin_remove_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  delete from public.committee_members where user_id = p_user_id;
end $$;

-- Crea el test (queda como BORRADOR, sin publicar) con todas sus preguntas.
-- p_questions = [{"question":"..","options":["..","..","..",".."],"correct":"a","rule":12,"explanation":".."}, ...]
create or replace function public.committee_admin_create_test(
  p_title text, p_month text, p_opens timestamptz, p_closes timestamptz, p_max_attempts int, p_questions jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  q   jsonb;
  i   int := 0;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'no_questions';
  end if;
  insert into public.committee_tests(title, month, opens_at, closes_at, max_attempts)
  values (trim(p_title), nullif(trim(coalesce(p_month, '')), ''), coalesce(p_opens, now()), p_closes, greatest(coalesce(p_max_attempts, 1), 1))
  returning id into tid;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    insert into public.committee_test_questions(test_id, pos, question, options, correct, rule, explanation)
    values (tid, i, q ->> 'question', q -> 'options', lower(q ->> 'correct'), nullif(q ->> 'rule', '')::int, nullif(q ->> 'explanation', ''));
  end loop;
  return tid;
end $$;

create or replace function public.committee_admin_all_attempts()
returns table(
  test_id uuid, test_title text, month text, user_id uuid, email text, username text, full_name text,
  attempt_no int, score int, total int, duration_sec int, finished_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select a.test_id, t.title, t.month, a.user_id,
         u.email::text,
         n.username::text,
         trim(coalesce(u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         a.attempt_no, a.score, a.total, a.duration_sec, a.finished_at
  from public.committee_attempts a
  join public.committee_tests t on t.id = a.test_id
  join auth.users u on u.id = a.user_id
  left join public.usernames n on n.user_id = a.user_id
  order by a.finished_at desc;
end $$;

-- % de acierto de cada pregunta de un test.
create or replace function public.committee_admin_question_stats(p_test_id uuid)
returns table(pos int, question text, rule int, answered int, correct_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select q.pos, q.question, q.rule,
         count(a.id)::int,
         (count(a.id) filter (where a.answers ->> q.pos::text = q.correct))::int
  from public.committee_test_questions q
  left join public.committee_attempts a on a.test_id = q.test_id
  where q.test_id = p_test_id
  group by q.pos, q.question, q.rule
  order by q.pos;
end $$;

-- % de acierto por regla de todo el comité (puntos débiles).
create or replace function public.committee_admin_rule_stats()
returns table(rule int, answered int, correct_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select q.rule,
         count(a.id)::int,
         (count(a.id) filter (where a.answers ->> q.pos::text = q.correct))::int
  from public.committee_test_questions q
  join public.committee_attempts a on a.test_id = q.test_id
  where q.rule is not null
  group by q.rule
  order by q.rule;
end $$;

-- ---------- Permisos de ejecución ----------
-- Solo usuarios con sesión iniciada; los administradores se comprueban dentro de cada función.

revoke all on function public.committee_build_review(uuid, jsonb) from public, anon, authenticated;

revoke all on function public.is_committee_admin()                    from public, anon;
revoke all on function public.is_committee_member()                   from public, anon;
revoke all on function public.committee_status()                      from public, anon;
revoke all on function public.committee_my_tests()                    from public, anon;
revoke all on function public.committee_get_test(uuid)                from public, anon;
revoke all on function public.committee_submit_attempt(uuid, jsonb, int) from public, anon;
revoke all on function public.committee_get_review(uuid)              from public, anon;
revoke all on function public.committee_admin_list_members()          from public, anon;
revoke all on function public.committee_admin_add_member(text)        from public, anon;
revoke all on function public.committee_admin_remove_member(uuid)     from public, anon;
revoke all on function public.committee_admin_create_test(text, text, timestamptz, timestamptz, int, jsonb) from public, anon;
revoke all on function public.committee_admin_all_attempts()          from public, anon;
revoke all on function public.committee_admin_question_stats(uuid)    from public, anon;
revoke all on function public.committee_admin_rule_stats()            from public, anon;

grant execute on function public.is_committee_admin()                    to authenticated;
grant execute on function public.is_committee_member()                   to authenticated;
grant execute on function public.committee_status()                      to authenticated;
grant execute on function public.committee_my_tests()                    to authenticated;
grant execute on function public.committee_get_test(uuid)                to authenticated;
grant execute on function public.committee_submit_attempt(uuid, jsonb, int) to authenticated;
grant execute on function public.committee_get_review(uuid)              to authenticated;
grant execute on function public.committee_admin_list_members()          to authenticated;
grant execute on function public.committee_admin_add_member(text)        to authenticated;
grant execute on function public.committee_admin_remove_member(uuid)     to authenticated;
grant execute on function public.committee_admin_create_test(text, text, timestamptz, timestamptz, int, jsonb) to authenticated;
grant execute on function public.committee_admin_all_attempts()          to authenticated;
grant execute on function public.committee_admin_question_stats(uuid)    to authenticated;
grant execute on function public.committee_admin_rule_stats()            to authenticated;
