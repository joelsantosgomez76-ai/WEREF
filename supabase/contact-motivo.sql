-- Contacto: motivo de la consulta y regla/pregunta afectada.
-- NO está ejecutado. La web funciona sin esto: si las columnas no existen, el formulario
-- guarda el motivo dentro del mensaje. Ejecútalo en el SQL Editor de Supabase cuando quieras.

alter table public.contact_messages add column if not exists motivo text;
alter table public.contact_messages add column if not exists referencia text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_motivo_valid') then
    alter table public.contact_messages add constraint contact_messages_motivo_valid check (
      motivo is null or motivo in ('error', 'sugerencia', 'cuenta', 'privacidad', 'colaboraciones')
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_referencia_len') then
    alter table public.contact_messages add constraint contact_messages_referencia_len check (
      referencia is null or char_length(referencia) <= 200
    ) not valid;
  end if;
end
$$;

-- Comprobación de que el acceso anónimo es solo de escritura (ejecútala y revisa el resultado):
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'contact_messages';
-- Esperado: una única política con cmd = INSERT para anon/public, y ninguna de SELECT, UPDATE ni DELETE.
