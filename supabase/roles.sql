-- =====================================================================
-- WEREF · Roles de usuario
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos existentes.
--
-- Hay 3 roles:
--   * maestro      -> el usuario info@we-ref.com. Es único y gestiona toda la app.
--                     Es el único que puede asignar o quitar roles.
--   * desarrollador-> tiene acceso a todo (panel de administración, base de datos,
--                     sugerencias, Formación Comité...), pero no asigna roles ni
--                     puede bloquear o eliminar al maestro ni a otros desarrolladores.
--   * usuario      -> usuario normal. Es el rol por defecto de todo el mundo:
--                     solo se guardan en la tabla los desarrolladores.
-- =====================================================================

create table if not exists public.user_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role = 'developer'),
  assigned_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- Cada usuario solo puede leer su propia fila. Nadie escribe directamente:
-- los cambios pasan por weref_set_role (solo el maestro).
drop policy if exists "user_roles_read_own" on public.user_roles;
create policy "user_roles_read_own" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

-- ---------- Funciones ----------

create or replace function public.is_weref_master()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'info@we-ref.com';
$$;

create or replace function public.weref_role()
returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.is_weref_master() then 'master'
    when exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'developer') then 'developer'
    else 'user'
  end;
$$;

-- "Administrador" = maestro o desarrollador. Esta función ya la usan las políticas
-- del banco compartido de preguntas, así que los desarrolladores pasan a poder editarlo.
create or replace function public.is_weref_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.weref_role() in ('master', 'developer');
$$;

-- Lo mismo para Formación Comité (sus funciones comprueban esta).
create or replace function public.is_committee_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_weref_admin();
$$;

-- Solo el maestro puede asignar roles. p_role: 'developer' o 'user'.
create or replace function public.weref_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_weref_master() then
    raise exception 'Solo el usuario maestro puede cambiar roles';
  end if;
  if p_role not in ('developer', 'user') then
    raise exception 'Rol no válido';
  end if;
  if exists (select 1 from auth.users where id = p_user_id and email = 'info@we-ref.com') then
    raise exception 'El rol del usuario maestro no se puede cambiar';
  end if;
  if p_role = 'developer' then
    insert into public.user_roles (user_id, role) values (p_user_id, 'developer')
      on conflict (user_id) do update set role = 'developer', assigned_at = now();
  else
    delete from public.user_roles where user_id = p_user_id;
  end if;
end;
$$;

-- ---------- Acceso de los desarrolladores a sugerencias y reportes ----------
-- Políticas ADICIONALES (no tocan las que ya existen): suman permisos para el
-- maestro y los desarrolladores. Solo se crean si las tablas existen.
do $$
begin
  if to_regclass('public.suggestions') is not null then
    execute 'drop policy if exists "weref_admin_all_suggestions" on public.suggestions';
    execute 'create policy "weref_admin_all_suggestions" on public.suggestions for all to authenticated using (public.is_weref_admin()) with check (public.is_weref_admin())';
  end if;
  if to_regclass('public.question_reports') is not null then
    execute 'drop policy if exists "weref_admin_all_question_reports" on public.question_reports';
    execute 'create policy "weref_admin_all_question_reports" on public.question_reports for all to authenticated using (public.is_weref_admin()) with check (public.is_weref_admin())';
  end if;
end
$$;
