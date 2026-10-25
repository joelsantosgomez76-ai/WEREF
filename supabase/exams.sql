-- ============================================================
--  CTA BAGES · Archivo de exámenes en PDF (Panel de Formación → Exámenes)
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  * exam_seasons: las temporadas que crea el administrador.
--  * exam_files:   cada examen (PDF) de una temporada y categoría, con la marca
--                  "ya está en la app / base de datos".
--  * Almacén privado "exams" para los PDF.
--  Todo es solo para administración (maestro + desarrolladores).
--  Las categorías son las mismas de los miembros del comité.
-- ============================================================

create table if not exists public.exam_seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index if not exists exam_seasons_name_uq on public.exam_seasons (lower(btrim(name)));

create table if not exists public.exam_files (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.exam_seasons(id) on delete cascade,
  category_id uuid references public.committee_member_categories(id) on delete set null,
  title       text not null check (char_length(btrim(title)) between 1 and 160),
  exam_date   date,
  file_path   text not null,
  file_name   text,
  file_size   bigint,
  in_app      boolean not null default false,
  in_app_at   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists exam_files_season_idx on public.exam_files (season_id);

alter table public.exam_seasons enable row level security;
alter table public.exam_files   enable row level security;

drop policy if exists exam_seasons_admin on public.exam_seasons;
create policy exam_seasons_admin on public.exam_seasons
  for all to authenticated
  using (public.is_weref_admin()) with check (public.is_weref_admin());

drop policy if exists exam_files_admin on public.exam_files;
create policy exam_files_admin on public.exam_files
  for all to authenticated
  using (public.is_weref_admin()) with check (public.is_weref_admin());

revoke all on public.exam_seasons from anon;
revoke all on public.exam_files   from anon;

-- Almacén privado para los PDF (máximo 30 MB por archivo, solo PDF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exams', 'exams', false, 31457280, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists exams_admin_all on storage.objects;
create policy exams_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'exams' and public.is_weref_admin())
  with check (bucket_id = 'exams' and public.is_weref_admin());
