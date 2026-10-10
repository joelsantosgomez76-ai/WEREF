-- ============================================================
--  CTA BAGES · Orden de preguntas y respuestas de cada test
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Cada test puede ser:
--    fixed    → todos los árbitros ven las preguntas y las respuestas A–D
--               en el mismo orden (como hasta ahora).
--    shuffled → cada árbitro recibe preguntas y respuestas en un orden
--               distinto, para que no puedan ayudarse.
--  La corrección sigue haciéndose en el servidor con las letras originales.
-- ============================================================

alter table public.committee_tests
  add column if not exists shuffle_mode text not null default 'fixed';

alter table public.committee_tests drop constraint if exists committee_tests_shuffle_chk;
alter table public.committee_tests add constraint committee_tests_shuffle_chk
  check (shuffle_mode in ('fixed', 'shuffled'));

-- committee_get_test: devuelve además el modo de orden (mantiene la temporización).
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
    'shuffle_mode', t.shuffle_mode,
    'questions', coalesce(qs, '[]'::json)
  );
end $$;

revoke all on function public.committee_get_test(uuid) from public, anon;
grant execute on function public.committee_get_test(uuid) to authenticated;
