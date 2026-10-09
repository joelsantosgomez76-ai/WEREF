-- =====================================================================
-- WEREF · CTA BAGES — ajustes del Panel de Formación
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos existentes.
-- (Requiere haber ejecutado antes committee.sql.)
--
-- Qué permite:
--   * Mostrar u ocultar CTA BAGES a los árbitros miembros (modo "trabajar en cubierto").
--     Con el módulo oculto, solo los administradores (maestro y desarrolladores) lo ven.
--   * Un mensaje opcional para los miembros, que se muestra arriba en CTA BAGES.
-- =====================================================================

create table if not exists public.committee_settings (
  id           int primary key default 1 check (id = 1),
  enabled      boolean not null default true,
  announcement text,
  updated_at   timestamptz not null default now()
);

insert into public.committee_settings (id) values (1) on conflict (id) do nothing;

alter table public.committee_settings enable row level security;

-- Cualquier usuario con sesión puede leer los ajustes (solo hay dos datos, no son sensibles).
drop policy if exists committee_settings_read on public.committee_settings;
create policy committee_settings_read on public.committee_settings
  for select to authenticated using (true);

-- Solo los administradores pueden cambiarlos.
drop policy if exists committee_settings_admin on public.committee_settings;
create policy committee_settings_admin on public.committee_settings
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

-- Un miembro solo "es miembro" mientras el módulo esté visible (los administradores
-- siempre pasan). Todas las funciones del comité comprueban esto en el servidor, así
-- que ocultar CTA BAGES bloquea también el acceso directo a los tests.
create or replace function public.is_committee_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.committee_members m where m.user_id = auth.uid())
     and (
       coalesce((select s.enabled from public.committee_settings s where s.id = 1), true)
       or public.is_committee_admin()
     );
$$;
