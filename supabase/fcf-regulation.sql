-- =====================================================================
-- WEREF · Apartado "Reglament General FCF" (solo Base de datos)
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra ni cambia ninguna pregunta existente.
--
-- Qué hace:
--   * Permite guardar preguntas del ámbito "fcf" en el banco compartido.
--   * Esas preguntas SOLO las pueden leer los administradores (maestro y
--     desarrolladores): la web y los usuarios normales no las reciben nunca.
--     Se usan desde la Base de datos para montar los tests de CTA BAGES.
-- =====================================================================

-- 1) Admitir el ámbito 'fcf' (se quita la restricción antigua sobre "domain").
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.shared_questions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%domain%'
  loop
    execute format('alter table public.shared_questions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.shared_questions
  add constraint shared_questions_domain_check
  check (domain in ('law', 'glossary', 'assistants', 'fcf'));

-- 2) Lectura: todos ven el banco, salvo las del Reglament General FCF (solo administradores).
drop policy if exists "shared_questions_read" on public.shared_questions;
create policy "shared_questions_read" on public.shared_questions
  for select to authenticated
  using (domain <> 'fcf' or public.is_weref_admin());
