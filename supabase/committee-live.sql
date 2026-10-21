-- ============================================================
--  CTA BAGES · WeRef Live (juego de preguntas en directo para clase)
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  * live_games     → cada partida (sala): código, estado y pregunta actual.
--  * live_questions → preguntas de la partida (con la respuesta correcta: solo administradores).
--  * live_players   → quién ha entrado y su puntuación.
--  * live_answers   → qué ha contestado cada jugador, en cuánto tiempo y cuántos puntos.
--  Los jugadores NO leen las tablas: usan funciones que nunca les envían la respuesta
--  correcta antes de que acabe la pregunta. Es un juego aparte: no toca la asistencia
--  ni la clasificación.
-- ============================================================

-- 1) Tablas
create table if not exists public.live_games (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(btrim(title)) between 1 and 120),
  code           text not null,
  seconds        int  not null default 20 check (seconds between 5 and 120),
  status         text not null default 'lobby' check (status in ('lobby', 'question', 'reveal', 'finished')),
  cur            int  not null default -1,
  q_started_at   timestamptz,
  question_count int  not null default 0,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create unique index if not exists live_games_code_active on public.live_games (code) where status <> 'finished';

create table if not exists public.live_questions (
  game_id     uuid not null references public.live_games(id) on delete cascade,
  pos         int  not null,
  question    text not null,
  options     jsonb not null,
  correct     text not null check (correct in ('a', 'b', 'c', 'd')),
  rule        int,
  explanation text,
  qnum        int,
  primary key (game_id, pos)
);

create table if not exists public.live_players (
  game_id   uuid not null references public.live_games(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  score     int  not null default 0,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table if not exists public.live_answers (
  game_id     uuid not null,
  pos         int  not null,
  user_id     uuid not null,
  choice      text not null check (choice in ('a', 'b', 'c', 'd')),
  ms          int  not null,
  correct     boolean not null,
  points      int  not null default 0,
  answered_at timestamptz not null default now(),
  primary key (game_id, pos, user_id),
  foreign key (game_id, pos)     references public.live_questions(game_id, pos)  on delete cascade,
  foreign key (game_id, user_id) references public.live_players(game_id, user_id) on delete cascade
);

alter table public.live_games     enable row level security;
alter table public.live_questions enable row level security;
alter table public.live_players   enable row level security;
alter table public.live_answers   enable row level security;

-- Solo los administradores leen y escriben directamente; los jugadores usan las funciones de abajo.
drop policy if exists live_games_admin on public.live_games;
create policy live_games_admin on public.live_games for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());
drop policy if exists live_questions_admin on public.live_questions;
create policy live_questions_admin on public.live_questions for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());
drop policy if exists live_players_admin on public.live_players;
create policy live_players_admin on public.live_players for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());
drop policy if exists live_answers_admin on public.live_answers;
create policy live_answers_admin on public.live_answers for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

revoke all on public.live_games, public.live_questions, public.live_players, public.live_answers from anon;

-- 2) Fase real de una partida: pasado el tiempo, la pregunta pasa sola a "resultado"
create or replace function public.live_phase(g public.live_games)
returns text
language sql stable as $$
  select case
    when g.status = 'question' and now() >= g.q_started_at + make_interval(secs => g.seconds) then 'reveal'
    else g.status
  end;
$$;

-- 3) Administrador: crear la sala con sus preguntas
create or replace function public.live_create(p_title text, p_seconds int, p_questions jsonb)
returns json
language plpgsql security definer set search_path = public as $$
declare gid uuid; c text; n int; i int := 0; q jsonb;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 100 then
    raise exception 'bad_questions';
  end if;
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.live_games where code = c and status <> 'finished');
    i := i + 1; if i > 30 then raise exception 'no_code'; end if;
  end loop;
  n := jsonb_array_length(p_questions);
  insert into public.live_games (title, code, seconds, question_count)
  values (btrim(p_title), c, greatest(5, least(120, coalesce(p_seconds, 20))), n)
  returning id into gid;
  i := 0;
  for q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 2 and 4 then raise exception 'bad_questions'; end if;
    insert into public.live_questions (game_id, pos, question, options, correct, rule, explanation, qnum)
    values (gid, i, q ->> 'question', q -> 'options', q ->> 'correct',
            nullif(q ->> 'rule', '')::int, nullif(q ->> 'explanation', ''), nullif(q ->> 'qnum', '')::int);
    i := i + 1;
  end loop;
  return json_build_object('id', gid, 'code', c);
end $$;

-- 4) Administrador: estado completo para la pantalla del proyector
create or replace function public.live_host_state(p_game uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare g public.live_games; ph text; q public.live_questions; counts jsonb := '{}'::jsonb; answered int := 0;
        np int; top json; allrows json; names json; qj json := null;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  select * into g from public.live_games where id = p_game;
  if not found then raise exception 'not_found'; end if;
  ph := public.live_phase(g);
  select count(*) into np from public.live_players where game_id = g.id;
  if g.cur >= 0 then
    select * into q from public.live_questions where game_id = g.id and pos = g.cur;
    select count(*) into answered from public.live_answers where game_id = g.id and pos = g.cur;
    if ph in ('reveal', 'finished') then
      select coalesce(jsonb_object_agg(choice, n), '{}'::jsonb) into counts
      from (select choice, count(*) n from public.live_answers where game_id = g.id and pos = g.cur group by choice) s;
    end if;
    qj := json_build_object('question', q.question, 'options', q.options, 'rule', q.rule,
                            'correct', case when ph in ('reveal', 'finished') then q.correct else null end,
                            'explanation', case when ph = 'reveal' then q.explanation else null end);
  end if;
  select coalesce(json_agg(t), '[]'::json) into top from (
    select name, score, rank() over (order by score desc) as rank
    from public.live_players where game_id = g.id order by score desc, joined_at limit 5) t;
  select coalesce(json_agg(t), '[]'::json) into allrows from (
    select name, score, rank() over (order by score desc) as rank
    from public.live_players where game_id = g.id order by score desc, joined_at) t;
  select coalesce(json_agg(name order by joined_at), '[]'::json) into names from public.live_players where game_id = g.id;
  return json_build_object(
    'now', floor(extract(epoch from clock_timestamp()) * 1000),
    'title', g.title, 'code', g.code, 'seconds', g.seconds, 'status', g.status, 'phase', ph,
    'cur', g.cur, 'total', g.question_count,
    'q_started', case when g.q_started_at is null then null else floor(extract(epoch from g.q_started_at) * 1000) end,
    'question', qj, 'counts', counts, 'answered', answered, 'player_count', np,
    'names', names, 'top', top, 'all', case when ph = 'finished' then allrows else null end);
end $$;

-- 5) Administrador: avanzar (empezar / saltar a resultado / siguiente pregunta / terminar)
create or replace function public.live_host_next(p_game uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare g public.live_games; ph text;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  select * into g from public.live_games where id = p_game for update;
  if not found then raise exception 'not_found'; end if;
  ph := public.live_phase(g);
  if ph = 'finished' then return; end if;
  if ph = 'lobby' then
    if g.question_count > 0 then
      update public.live_games set status = 'question', cur = 0, q_started_at = now(), started_at = now() where id = g.id;
    end if;
  elsif ph = 'question' then
    update public.live_games set status = 'reveal' where id = g.id;
  else  -- resultado: siguiente pregunta o final
    if g.cur + 1 >= g.question_count then
      update public.live_games set status = 'finished', finished_at = now() where id = g.id;
    else
      update public.live_games set status = 'question', cur = g.cur + 1, q_started_at = now() where id = g.id;
    end if;
  end if;
end $$;

-- Pasar a resultado solo si seguimos en esa pregunta (evita saltarse una por una llamada doble)
create or replace function public.live_host_reveal(p_game uuid, p_pos int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  update public.live_games set status = 'reveal' where id = p_game and status = 'question' and cur = p_pos;
end $$;

create or replace function public.live_host_end(p_game uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  update public.live_games set status = 'finished', finished_at = coalesce(finished_at, now()) where id = p_game and status <> 'finished';
end $$;

-- 6) Jugador: entrar en una sala con su código
create or replace function public.live_join(p_code text)
returns json
language plpgsql security definer set search_path = public as $$
declare g public.live_games; nm text;
begin
  if auth.uid() is null or not (public.is_committee_member() or public.is_committee_admin()) then raise exception 'no_access'; end if;
  select * into g from public.live_games where code = btrim(p_code) and status <> 'finished' limit 1;
  if not found then raise exception 'game_not_found'; end if;
  select coalesce(
           nullif(btrim(coalesce(u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', '')), ''),
           n.username, 'Árbitro')
    into nm
  from auth.users u left join public.usernames n on n.user_id = u.id where u.id = auth.uid();
  insert into public.live_players (game_id, user_id, name) values (g.id, auth.uid(), left(coalesce(nm, 'Árbitro'), 60))
  on conflict (game_id, user_id) do update set name = excluded.name;
  return json_build_object('id', g.id, 'title', g.title);
end $$;

-- 7) Jugador: estado de la partida (sin la respuesta correcta hasta el resultado)
create or replace function public.live_state(p_game uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare g public.live_games; ph text; q public.live_questions; me public.live_players; a public.live_answers;
        answered int := 0; np int; top json; my_rank int; qj json := null; mine json := null;
begin
  if auth.uid() is null then raise exception 'no_access'; end if;
  select * into g from public.live_games where id = p_game;
  if not found then raise exception 'game_not_found'; end if;
  select * into me from public.live_players where game_id = g.id and user_id = auth.uid();
  if not found then raise exception 'not_joined'; end if;
  ph := public.live_phase(g);
  select count(*) into np from public.live_players where game_id = g.id;
  if g.cur >= 0 and ph in ('question', 'reveal') then
    select * into q from public.live_questions where game_id = g.id and pos = g.cur;
    select count(*) into answered from public.live_answers where game_id = g.id and pos = g.cur;
    qj := json_build_object('pos', q.pos, 'question', q.question, 'options', q.options, 'rule', q.rule,
                            'correct', case when ph = 'reveal' then q.correct else null end,
                            'explanation', case when ph = 'reveal' then q.explanation else null end);
    select * into a from public.live_answers where game_id = g.id and pos = g.cur and user_id = auth.uid();
    if found then
      mine := json_build_object('choice', a.choice, 'correct', case when ph = 'reveal' then a.correct else null end,
                                'points', case when ph = 'reveal' then a.points else null end);
    end if;
  end if;
  select count(*) + 1 into my_rank from public.live_players where game_id = g.id and score > me.score;
  select coalesce(json_agg(t), '[]'::json) into top from (
    select name, score, rank() over (order by score desc) as rank
    from public.live_players where game_id = g.id order by score desc, joined_at limit 5) t;
  return json_build_object(
    'now', floor(extract(epoch from clock_timestamp()) * 1000),
    'title', g.title, 'seconds', g.seconds, 'phase', ph, 'cur', g.cur, 'total', g.question_count,
    'q_started', case when g.q_started_at is null then null else floor(extract(epoch from g.q_started_at) * 1000) end,
    'question', qj, 'mine', mine, 'answered', answered, 'player_count', np,
    'name', me.name, 'score', me.score, 'rank', my_rank,
    'top', case when ph in ('reveal', 'finished') then top else '[]'::json end);
end $$;

-- 8) Jugador: contestar (el servidor calcula si es correcta y los puntos; nunca se los dice antes de tiempo)
create or replace function public.live_answer(p_game uuid, p_pos int, p_choice text)
returns json
language plpgsql security definer set search_path = public as $$
declare g public.live_games; q public.live_questions; el int; ok boolean; pts int := 0; n int;
begin
  if auth.uid() is null then raise exception 'no_access'; end if;
  if p_choice not in ('a', 'b', 'c', 'd') then raise exception 'bad_choice'; end if;
  select * into g from public.live_games where id = p_game;
  if not found then raise exception 'game_not_found'; end if;
  if not exists (select 1 from public.live_players where game_id = g.id and user_id = auth.uid()) then raise exception 'not_joined'; end if;
  if g.status <> 'question' or g.cur <> p_pos then raise exception 'closed'; end if;
  el := floor(extract(epoch from (clock_timestamp() - g.q_started_at)) * 1000);
  if el > g.seconds * 1000 + 1500 then raise exception 'closed'; end if;
  el := greatest(0, least(el, g.seconds * 1000));
  select * into q from public.live_questions where game_id = g.id and pos = p_pos;
  ok := (q.correct = p_choice);
  if ok then pts := round(1000 * (1 - (el::numeric / (g.seconds * 1000)) / 2)); end if;
  insert into public.live_answers (game_id, pos, user_id, choice, ms, correct, points)
  values (g.id, p_pos, auth.uid(), p_choice, el, ok, pts)
  on conflict (game_id, pos, user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('accepted', false); end if;
  update public.live_players set score = score + pts where game_id = g.id and user_id = auth.uid();
  return json_build_object('accepted', true);
end $$;

-- 9) Jugador: ¿hay alguna sala abierta ahora?
create or replace function public.live_active()
returns json
language plpgsql stable security definer set search_path = public as $$
declare g public.live_games;
begin
  if auth.uid() is null or not (public.is_committee_member() or public.is_committee_admin()) then return null; end if;
  select * into g from public.live_games where status <> 'finished' and created_at > now() - interval '12 hours'
   order by created_at desc limit 1;
  if not found then return null; end if;
  return json_build_object('title', g.title, 'code', g.code);
end $$;

revoke all on function public.live_phase(public.live_games) from public, anon;
revoke all on function public.live_create(text, int, jsonb) from public, anon;
revoke all on function public.live_host_state(uuid)         from public, anon;
revoke all on function public.live_host_next(uuid)          from public, anon;
revoke all on function public.live_host_reveal(uuid, int)   from public, anon;
revoke all on function public.live_host_end(uuid)           from public, anon;
revoke all on function public.live_join(text)               from public, anon;
revoke all on function public.live_state(uuid)              from public, anon;
revoke all on function public.live_answer(uuid, int, text)  from public, anon;
revoke all on function public.live_active()                 from public, anon;
grant execute on function public.live_phase(public.live_games) to authenticated;
grant execute on function public.live_create(text, int, jsonb) to authenticated;
grant execute on function public.live_host_state(uuid)         to authenticated;
grant execute on function public.live_host_next(uuid)          to authenticated;
grant execute on function public.live_host_reveal(uuid, int)   to authenticated;
grant execute on function public.live_host_end(uuid)           to authenticated;
grant execute on function public.live_join(text)               to authenticated;
grant execute on function public.live_state(uuid)              to authenticated;
grant execute on function public.live_answer(uuid, int, text)  to authenticated;
grant execute on function public.live_active()                 to authenticated;
