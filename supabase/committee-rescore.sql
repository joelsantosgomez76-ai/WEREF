-- ============================================================
--  CTA BAGES · Recalcular los resultados de un test
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Si corriges un test ya publicado (por ejemplo, cambias la respuesta
--  correcta de una pregunta), esto vuelve a corregir los intentos que ya
--  estaban hechos con las preguntas actuales. Solo lo puede ejecutar un
--  administrador del comité. Devuelve cuántos intentos se han recalculado.
-- ============================================================

create or replace function public.committee_admin_rescore_test(p_test_id uuid)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;

  with s as (
    select a.id,
           count(q.pos)::int as tot,
           (count(q.pos) filter (where a.answers ->> q.pos::text = q.correct))::int as sc
    from public.committee_attempts a
    join public.committee_test_questions q on q.test_id = a.test_id
    where a.test_id = p_test_id
    group by a.id
  )
  update public.committee_attempts t
     set score = s.sc, total = s.tot
    from s
   where t.id = s.id;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.committee_admin_rescore_test(uuid) from public, anon;
grant execute on function public.committee_admin_rescore_test(uuid) to authenticated;
