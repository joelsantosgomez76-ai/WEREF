-- =====================================================================
-- WEREF · Refuerzo de seguridad (privacidad de usuarios)
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos.
--
-- Qué corrige:
--   * La tabla "usernames" la podía leer cualquier visitante sin iniciar sesión
--     (listado de todos los nombres de usuario y sus identificadores). Ahora solo
--     se puede leer la fila propia (y el administrador).
--   * Para comprobar si un nombre está libre al registrarse se usa una función
--     que solo responde sí/no.
--   * La tabla de clasificación "leaderboard_scores" ya no la lee quien no ha
--     iniciado sesión.
-- =====================================================================

-- 1) Función "¿está libre este nombre de usuario?" (sí/no, sin listar a nadie).
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.usernames u where lower(u.username) = lower(trim(p_username))
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- 2) usernames: lectura solo de la fila propia (o administrador).
do $$
declare r record;
begin
  if to_regclass('public.usernames') is not null then
    for r in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'usernames' and cmd = 'SELECT' loop
      execute format('drop policy %I on public.usernames', r.policyname);
    end loop;
    execute 'create policy usernames_select_own on public.usernames for select to authenticated
             using (user_id = auth.uid() or public.is_weref_admin())';
    execute 'revoke select on public.usernames from anon';
  end if;
end
$$;

-- 3) leaderboard_scores: solo usuarios con sesión.
do $$
begin
  if to_regclass('public.leaderboard_scores') is not null then
    execute 'revoke select on public.leaderboard_scores from anon';
  end if;
end
$$;
