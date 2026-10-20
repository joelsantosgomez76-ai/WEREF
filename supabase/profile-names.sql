-- ============================================================
--  Nombre del perfil que no se pisa al entrar con Google
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Al entrar con Google, Supabase vuelve a escribir el campo "full_name"
--  con el nombre completo de la cuenta de Google. Por eso un nombre borrado
--  en el perfil reaparecía. Ahora la web guarda el nombre editado en el
--  campo "first_name", que Google no toca, y estas funciones lo leen primero
--  (si no existe, usan el antiguo "full_name").
-- ============================================================

create or replace function public.committee_admin_members_detail()
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
         trim(coalesce(u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'full_name', ''))::text,
         trim(coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         trim(coalesce(u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         m.added_at,
         u.last_sign_in_at,
         m.category_id
  from public.committee_members m
  join auth.users u on u.id = m.user_id
  left join public.usernames n on n.user_id = m.user_id
  order by m.added_at;
end $$;

create or replace function public.committee_admin_list_members()
returns table(user_id uuid, email text, username text, full_name text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select m.user_id,
         u.email::text,
         n.username::text,
         trim(coalesce(u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         m.added_at
  from public.committee_members m
  join auth.users u on u.id = m.user_id
  left join public.usernames n on n.user_id = m.user_id
  order by m.added_at;
end $$;

create or replace function public.committee_admin_all_attempts()
returns table(
  test_id uuid, test_title text, month text, user_id uuid, email text, username text, full_name text,
  attempt_no int, score int, total int, duration_sec int, finished_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  return query
  select a.test_id, t.title, t.month, a.user_id,
         u.email::text,
         n.username::text,
         trim(coalesce(u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'full_name', '') || ' ' || coalesce(u.raw_user_meta_data ->> 'last_name', ''))::text,
         a.attempt_no, a.score, a.total, a.duration_sec, a.finished_at
  from public.committee_attempts a
  join public.committee_tests t on t.id = a.test_id
  join auth.users u on u.id = a.user_id
  left join public.usernames n on n.user_id = a.user_id
  order by a.finished_at desc;
end $$;

revoke all on function public.committee_admin_members_detail() from public, anon;
revoke all on function public.committee_admin_list_members()   from public, anon;
revoke all on function public.committee_admin_all_attempts()   from public, anon;
grant execute on function public.committee_admin_members_detail() to authenticated;
grant execute on function public.committee_admin_list_members()   to authenticated;
grant execute on function public.committee_admin_all_attempts()   to authenticated;
