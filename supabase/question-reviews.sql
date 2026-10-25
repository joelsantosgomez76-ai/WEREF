-- "Revisada" compartida entre todas las cuentas de administración (maestro + desarrolladores)
-- y tiempo real para la Base de datos (preguntas compartidas + revisadas).

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
