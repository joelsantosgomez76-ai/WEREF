-- =====================================================================
-- WEREF · CTA BAGES — mensajes del comité y CTA BAGES siempre abierto
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos existentes.
-- (Requiere haber ejecutado antes committee.sql.)
--
-- Qué hace:
--   * Crea la tabla de mensajes del comité: el administrador los prepara como
--     borrador y los publica; los árbitros miembros ven solo los publicados.
--   * Deja CTA BAGES siempre abierto: quita la comprobación de "abierto/cerrado"
--     que añadió cta-settings.sql (si lo habías ejecutado).
-- =====================================================================

create table if not exists public.committee_messages (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  published    boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.committee_messages enable row level security;

drop policy if exists committee_messages_admin on public.committee_messages;
create policy committee_messages_admin on public.committee_messages
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

drop policy if exists committee_messages_member on public.committee_messages;
create policy committee_messages_member on public.committee_messages
  for select to authenticated
  using (published and public.is_committee_member());

-- Miembro = estar en la lista de miembros (sin ninguna condición de abierto/cerrado).
create or replace function public.is_committee_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.committee_members m where m.user_id = auth.uid());
$$;

-- Si existía el interruptor de cta-settings.sql, lo dejamos en "abierto".
do $$
begin
  if to_regclass('public.committee_settings') is not null then
    update public.committee_settings set enabled = true where id = 1;
  end if;
end
$$;
