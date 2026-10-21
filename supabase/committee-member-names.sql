-- ============================================================
--  CTA BAGES · Corregir el nombre y los apellidos de un miembro
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  Permite que un administrador del comité cambie el Nombre y los Apellidos de
--  un árbitro desde la tabla de Miembros (por ejemplo, cuando alguien escribió
--  todo el nombre en un solo campo). Solo funciona con personas que ya están
--  en Miembros; guarda en first_name (el que lee la web) y en full_name.
-- ============================================================

create or replace function public.committee_admin_set_member_name(p_user_id uuid, p_first text, p_last text)
returns void
language plpgsql security definer set search_path = public as $$
declare f text := btrim(coalesce(p_first, '')); l text := btrim(coalesce(p_last, ''));
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.committee_members m where m.user_id = p_user_id) then raise exception 'not_member'; end if;
  if char_length(f) < 2 or char_length(l) < 2 or char_length(f) > 100 or char_length(l) > 100 then raise exception 'bad_name'; end if;
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
         || jsonb_build_object('first_name', f, 'full_name', f, 'last_name', l)
   where id = p_user_id;
end $$;

revoke all on function public.committee_admin_set_member_name(uuid, text, text) from public, anon;
grant execute on function public.committee_admin_set_member_name(uuid, text, text) to authenticated;
