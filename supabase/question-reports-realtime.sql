-- Tiempo real para los avisos de preguntas (question_reports): cuando un usuario avisa de una pregunta,
-- o una cuenta admin descarta un aviso, el resto de cuentas admin lo ven sin recargar.
-- Las políticas RLS siguen aplicándose: solo las cuentas admin reciben estos eventos.
do $$
begin
  if to_regclass('public.question_reports') is not null
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'question_reports') then
    alter publication supabase_realtime add table public.question_reports;
  end if;
end $$;
