-- ============================================================
--  CTA BAGES · Miembros con nombre y apellidos por separado
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Permite ordenar y mostrar a los miembros por APELLIDOS y luego NOMBRE,
--  y enseña la fecha de su último acceso. Solo lo puede ejecutar un
--  administrador del comité.
-- ============================================================

create or replace function public.committee_admin_members_detail()
returns table(
  user_id uuid, email text, username text,
  first_name text, last_name text, full_name text,
  added_at timestamptz, last_sign_in_at timestamptz
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
         u.last_sign_in_at
  from public.committee_members m
  join auth.users u on u.id = m.user_id
  left join public.usernames n on n.user_id = m.user_id
  order by m.added_at;
end $$;

revoke all on function public.committee_admin_members_detail() from public, anon;
grant execute on function public.committee_admin_members_detail() to authenticated;
