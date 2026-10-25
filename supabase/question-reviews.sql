-- "Revisada" compartida entre todas las cuentas de administración (maestro + desarrolladores)
-- y tiempo real para la Base de datos (preguntas compartidas + revisadas).

-- 0) Funciones de roles (idénticas a roles.sql; si ya existen no cambian nada).
create table if not exists public.user_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role = 'developer'),
  assigned_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

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

create or replace function public.is_weref_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.weref_role() in ('master', 'developer');
$$;

-- 1) Tabla de revisadas
create table if not exists public.question_reviews (
  qid         text primary key,
  reviewed_at bigint,
  reviewed_by uuid default auth.uid(),
  updated_at  bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

alter table public.question_reviews enable row level security;

drop policy if exists question_reviews_admin on public.question_reviews;
create policy question_reviews_admin on public.question_reviews
  for all to authenticated
  using (public.is_weref_admin())
  with check (public.is_weref_admin());

revoke all on public.question_reviews from anon;

-- Tiempo real: las tablas se publican en supabase_realtime (las políticas RLS siguen aplicándose a los eventos).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_reviews') then
    alter publication supabase_realtime add table public.question_reviews;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_questions') then
    alter publication supabase_realtime add table public.shared_questions;
  end if;
end $$;
