-- ============================================================
--  CTA BAGES · Biblioteca de exámenes: notas, quién lo subió, quién lo pasó a la app,
--  preguntas pasadas y tiempo real. Ejecutar UNA vez en Supabase → SQL Editor.
--  Es seguro repetirlo. Requiere haber ejecutado antes exams.sql.
-- ============================================================

alter table public.exam_files
  add column if not exists notes           text,
  add column if not exists q_total         int,
  add column if not exists q_done          int,
  add column if not exists created_by_name text,
  add column if not exists in_app_by_name  text,
  add column if not exists updated_at      timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_files_q_chk') then
    alter table public.exam_files
      add constraint exam_files_q_chk check ((q_total is null or q_total >= 0) and (q_done is null or q_done >= 0));
  end if;
end $$;

-- Apunta cuándo se pasó a la app y cuándo se tocó por última vez.
create or replace function public.exam_files_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.in_app then new.in_app_at := now(); else new.in_app_at := null; end if;
  elsif new.in_app is distinct from old.in_app then
    if new.in_app then new.in_app_at := now(); else new.in_app_at := null; new.in_app_by_name := null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists exam_files_sync_trg on public.exam_files;
create trigger exam_files_sync_trg
  before insert or update on public.exam_files
  for each row execute function public.exam_files_sync();

-- Tiempo real entre las cuentas de administración (las políticas RLS siguen aplicándose).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exam_files') then
    alter publication supabase_realtime add table public.exam_files;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exam_seasons') then
    alter publication supabase_realtime add table public.exam_seasons;
  end if;
end $$;
