-- =====================================================================
-- WEREF · Banco de preguntas compartido
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos existentes.
--
-- Qué guarda:
--   * Las preguntas nuevas que añade el administrador (reglas, Glosario y
--     Árbitros Asistentes), para que las vean TODOS los usuarios.
--   * Los cambios del administrador sobre las preguntas que ya vienen con la
--     web (editar el texto o eliminarla): se aplican a todos los usuarios.
--
-- Seguridad:
--   * Cualquier usuario con sesión puede LEER el banco.
--   * Solo el administrador (info@we-ref.com) puede añadir, cambiar o borrar.
-- =====================================================================

create table if not exists public.shared_questions (
  id          text primary key,
  domain      text not null check (domain in ('law', 'glossary', 'assistants')),
  rule        int,
  question    text,
  options     jsonb,
  correct     text check (correct in ('a', 'b', 'c', 'd')),
  explanation text,
  difficulty  text not null default 'normal',
  deleted     boolean not null default false,
  created_at  bigint,
  updated_at  bigint
);

alter table public.shared_questions enable row level security;

create or replace function public.is_weref_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'info@we-ref.com';
$$;

drop policy if exists "shared_questions_read" on public.shared_questions;
create policy "shared_questions_read" on public.shared_questions
  for select to authenticated using (true);

drop policy if exists "shared_questions_admin_insert" on public.shared_questions;
create policy "shared_questions_admin_insert" on public.shared_questions
  for insert to authenticated with check (public.is_weref_admin());

drop policy if exists "shared_questions_admin_update" on public.shared_questions;
create policy "shared_questions_admin_update" on public.shared_questions
  for update to authenticated using (public.is_weref_admin()) with check (public.is_weref_admin());

drop policy if exists "shared_questions_admin_delete" on public.shared_questions;
create policy "shared_questions_admin_delete" on public.shared_questions
  for delete to authenticated using (public.is_weref_admin());
