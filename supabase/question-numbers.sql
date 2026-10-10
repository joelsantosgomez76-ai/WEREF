-- =====================================================================
-- WEREF · Número único y permanente de cada pregunta
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no cambia números que ya estén asignados.
--
-- Cada pregunta recibe un número la primera vez que la ve un administrador
-- (las que existen hoy se numeran en el orden actual de la Base de datos, así
-- que los números que ya ves no cambian). Después:
--   * el número NUNCA cambia,
--   * el número NUNCA se reutiliza, aunque la pregunta se elimine,
--   * las preguntas nuevas reciben el siguiente número libre.
--
-- Seguridad: solo los administradores (maestro y desarrolladores) pueden
-- leerlos o asignarlos. Los usuarios normales no ven nada de esta tabla.
-- =====================================================================

create table if not exists public.question_numbers (
  qid text primary key,
  num int  not null unique
);

alter table public.question_numbers enable row level security;

revoke all on public.question_numbers from anon, authenticated;
grant select on public.question_numbers to authenticated;

drop policy if exists question_numbers_admin_read on public.question_numbers;
create policy question_numbers_admin_read on public.question_numbers
  for select to authenticated using (public.is_weref_admin());

-- Asigna número a las preguntas que aún no tienen (en el orden recibido).
-- Devuelve solo las asignadas ahora. Las que ya tenían número se ignoran.
create or replace function public.assign_question_numbers(p_qids text[])
returns table(out_qid text, out_num int)
language plpgsql volatile security definer set search_path = public as $$
declare
  base int;
begin
  if not public.is_weref_admin() then raise exception 'no_access'; end if;
  -- Un administrador a la vez, para que dos sesiones no se pisen.
  perform pg_advisory_xact_lock(727001);
  select coalesce(max(n.num), 0) into base from public.question_numbers n;

  return query
  with todo as (
    select u.q, min(u.ord) as ord
    from unnest(p_qids) with ordinality as u(q, ord)
    where u.q is not null and u.q <> ''
      and not exists (select 1 from public.question_numbers n where n.qid = u.q)
    group by u.q
  ),
  numbered as (
    select t.q, base + (row_number() over (order by t.ord))::int as num
    from todo t
  ),
  ins as (
    insert into public.question_numbers(qid, num)
    select q, num from numbered
    returning qid, num
  )
  select ins.qid, ins.num from ins;
end $$;

revoke all on function public.assign_question_numbers(text[]) from public, anon;
grant execute on function public.assign_question_numbers(text[]) to authenticated;
