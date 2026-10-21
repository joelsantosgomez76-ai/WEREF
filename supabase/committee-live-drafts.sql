-- ============================================================
--  CTA BAGES · Kahoot: partidas en borrador
--  Ejecutar UNA vez en Supabase → SQL Editor (después de committee-live.sql).
--  Es seguro repetirlo.
--
--  Permite guardar una partida como BORRADOR (sin código ni sala abierta), editarla
--  después y abrirla en clase cuando quieras, igual que los tests.
-- ============================================================

-- 1) Nuevo estado "borrador"; un borrador no tiene código hasta que se abre
alter table public.live_games drop constraint if exists live_games_status_check;
alter table public.live_games add constraint live_games_status_check
  check (status in ('draft', 'lobby', 'question', 'reveal', 'finished'));
alter table public.live_games alter column code drop not null;

-- 2) Generar un código de 6 cifras libre
create or replace function public.live_new_code()
returns text
language plpgsql as $$
declare c text; i int := 0;
begin
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.live_games where code = c and status <> 'finished');
    i := i + 1; if i > 30 then raise exception 'no_code'; end if;
  end loop;
  return c;
end $$;

-- 3) Guardar las preguntas de una partida (interno)
create or replace function public.live_set_questions(p_game uuid, p_questions jsonb)
returns void
language plpgsql as $$
declare i int := 0; q jsonb;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 100 then
    raise exception 'bad_questions';
  end if;
  delete from public.live_questions where game_id = p_game;
  for q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 2 and 4 then raise exception 'bad_questions'; end if;
    insert into public.live_questions (game_id, pos, question, options, correct, rule, explanation, qnum)
    values (p_game, i, q ->> 'question', q -> 'options', q ->> 'correct',
            nullif(q ->> 'rule', '')::int, nullif(q ->> 'explanation', ''), nullif(q ->> 'qnum', '')::int);
    i := i + 1;
  end loop;
  update public.live_games set question_count = i where id = p_game;
end $$;

-- 4) Crear (abierta o como borrador)
drop function if exists public.live_create(text, int, jsonb);
create or replace function public.live_create(p_title text, p_seconds int, p_questions jsonb, p_draft boolean default false)
returns json
language plpgsql security definer set search_path = public as $$
declare gid uuid; c text := null;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if not coalesce(p_draft, false) then c := public.live_new_code(); end if;
  insert into public.live_games (title, code, seconds, status, question_count)
  values (btrim(p_title), c, greatest(5, least(120, coalesce(p_seconds, 20))), case when coalesce(p_draft, false) then 'draft' else 'lobby' end, 0)
  returning id into gid;
  perform public.live_set_questions(gid, p_questions);
  return json_build_object('id', gid, 'code', c);
end $$;

-- 5) Editar un borrador
create or replace function public.live_update_draft(p_game uuid, p_title text, p_seconds int, p_questions jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.live_games where id = p_game and status = 'draft') then raise exception 'not_draft'; end if;
  update public.live_games set title = btrim(p_title), seconds = greatest(5, least(120, coalesce(p_seconds, 20))) where id = p_game;
  perform public.live_set_questions(p_game, p_questions);
end $$;

-- 6) Abrir un borrador: pasa a sala de espera con su código
create or replace function public.live_open_draft(p_game uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.live_games where id = p_game and status = 'draft' and question_count > 0) then raise exception 'not_draft'; end if;
  c := public.live_new_code();
  update public.live_games set status = 'lobby', code = c, cur = -1, created_at = now() where id = p_game;
  return json_build_object('id', p_game, 'code', c);
end $$;

-- 7) Un borrador nunca se puede arrancar, terminar ni unirse a él
create or replace function public.live_host_next(p_game uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare g public.live_games; ph text;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  select * into g from public.live_games where id = p_game for update;
  if not found then raise exception 'not_found'; end if;
  ph := public.live_phase(g);
  if ph in ('finished', 'draft') then return; end if;
  if ph = 'lobby' then
    if g.question_count > 0 then
      update public.live_games set status = 'question', cur = 0, q_started_at = now(), started_at = now() where id = g.id;
    end if;
  elsif ph = 'question' then
    update public.live_games set status = 'reveal' where id = g.id;
  else
    if g.cur + 1 >= g.question_count then
      update public.live_games set status = 'finished', finished_at = now() where id = g.id;
    else
      update public.live_games set status = 'question', cur = g.cur + 1, q_started_at = now() where id = g.id;
    end if;
  end if;
end $$;

create or replace function public.live_host_end(p_game uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  update public.live_games set status = 'finished', finished_at = coalesce(finished_at, now()) where id = p_game and status not in ('finished', 'draft');
end $$;

create or replace function public.live_join(p_code text)
returns json
language plpgsql security definer set search_path = public as $$
declare g public.live_games; nm text;
begin
  if auth.uid() is null or not (public.is_committee_member() or public.is_committee_admin()) then raise exception 'no_access'; end if;
  select * into g from public.live_games where code = btrim(p_code) and status not in ('finished', 'draft') limit 1;
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

create or replace function public.live_active()
returns json
language plpgsql stable security definer set search_path = public as $$
declare g public.live_games;
begin
  if auth.uid() is null or not (public.is_committee_member() or public.is_committee_admin()) then return null; end if;
  select * into g from public.live_games where status not in ('finished', 'draft') and created_at > now() - interval '12 hours'
   order by created_at desc limit 1;
  if not found then return null; end if;
  return json_build_object('title', g.title, 'code', g.code);
end $$;

revoke all on function public.live_new_code()                       from public, anon, authenticated;
revoke all on function public.live_set_questions(uuid, jsonb)       from public, anon, authenticated;
revoke all on function public.live_create(text, int, jsonb, boolean) from public, anon;
revoke all on function public.live_update_draft(uuid, text, int, jsonb) from public, anon;
revoke all on function public.live_open_draft(uuid)                 from public, anon;
revoke all on function public.live_host_next(uuid)                  from public, anon;
revoke all on function public.live_host_end(uuid)                   from public, anon;
revoke all on function public.live_join(text)                       from public, anon;
revoke all on function public.live_active()                         from public, anon;
grant execute on function public.live_create(text, int, jsonb, boolean) to authenticated;
grant execute on function public.live_update_draft(uuid, text, int, jsonb) to authenticated;
grant execute on function public.live_open_draft(uuid)              to authenticated;
grant execute on function public.live_host_next(uuid)               to authenticated;
grant execute on function public.live_host_end(uuid)                to authenticated;
grant execute on function public.live_join(text)                    to authenticated;
grant execute on function public.live_active()                      to authenticated;
