-- ============================================================
--  CTA BAGES · Categorías de árbitros + ajustes generales del módulo
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  * Permite crear categorías (árbitro de categoría, situación especial,
--    primer año…) y asignar una a cada miembro desde la tabla de Miembros.
--  * Guarda los valores por defecto de un test nuevo (Configuración).
--  Todo esto solo lo ven y lo cambian los administradores del comité.
-- ============================================================

-- 1) Categorías
create table if not exists public.committee_member_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  color      text not null default '#FF6A2B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists committee_member_categories_name_uq
  on public.committee_member_categories (lower(btrim(name)));

alter table public.committee_member_categories enable row level security;

drop policy if exists committee_member_categories_admin on public.committee_member_categories;
create policy committee_member_categories_admin on public.committee_member_categories
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

revoke all on public.committee_member_categories from anon;

-- 2) Categoría de cada miembro (si se borra la categoría, el miembro queda sin categoría)
alter table public.committee_members
  add column if not exists category_id uuid references public.committee_member_categories(id) on delete set null;

-- 3) Valores por defecto de un test nuevo
do $$
begin
  if to_regclass('public.committee_settings') is not null then
    alter table public.committee_settings add column if not exists defaults jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- 4) Lista de miembros con su categoría
drop function if exists public.committee_admin_members_detail();
create function public.committee_admin_members_detail()
returns table(
  user_id uuid, email text, username text,
  first_name text, last_name text, full_name text,
  added_at timestamptz, last_sign_in_at timestamptz, category_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select m.user_id,
         u.email::text,
         n.username::text,
         trim(coalesce(u.raw_user_meta_data ->> 'full_name', ''))::text,
         trim(coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         trim(coalesce(u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         m.added_at,
         u.last_sign_in_at,
         m.category_id
  from public.committee_members m
  join auth.users u on u.id = m.user_id
  left join public.usernames n on n.user_id = m.user_id
  order by m.added_at;
end $$;

revoke all on function public.committee_admin_members_detail() from public, anon;
grant execute on function public.committee_admin_members_detail() to authenticated;

-- 5) Asignar (o quitar, con null) la categoría a uno o varios miembros. Devuelve cuántos se han cambiado.
create or replace function public.committee_admin_set_members_category(p_user_ids uuid[], p_category_id uuid)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if p_category_id is not null
     and not exists (select 1 from public.committee_member_categories c where c.id = p_category_id) then
    raise exception 'not_found';
  end if;
  update public.committee_members set category_id = p_category_id where user_id = any(p_user_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.committee_admin_set_members_category(uuid[], uuid) from public, anon;
grant execute on function public.committee_admin_set_members_category(uuid[], uuid) to authenticated;
