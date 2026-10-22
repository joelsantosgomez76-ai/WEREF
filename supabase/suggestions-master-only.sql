-- ============================================================
--  Sugerencias: solo el usuario maestro
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Antes los desarrolladores podían leer, cambiar y borrar las sugerencias
--  (la política usaba is_weref_admin(), que incluye a los desarrolladores).
--  Ahora solo las gestiona el maestro (info@we-ref.com).
--  Los usuarios siguen pudiendo ENVIAR una sugerencia: esas políticas no se tocan.
-- ============================================================

do $$
begin
  if to_regclass('public.suggestions') is not null then
    execute 'drop policy if exists "weref_admin_all_suggestions" on public.suggestions';
    execute 'drop policy if exists "weref_master_all_suggestions" on public.suggestions';
    execute 'create policy "weref_master_all_suggestions" on public.suggestions for all to authenticated using (public.is_weref_master()) with check (public.is_weref_master())';
  end if;
end $$;

-- Comprobación: lista las políticas que quedan sobre las sugerencias
select policyname, cmd, roles::text as roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'suggestions'
 order by policyname;
