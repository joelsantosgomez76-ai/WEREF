-- Banco de preguntas base en un almacén PRIVADO (antes era un archivo público de la web).
-- Lo lee cualquier usuario con sesión iniciada; solo los administradores pueden subirlo o cambiarlo.
-- El archivo se sube a mano en Storage > bank con el nombre: base-questions.json
-- Se puede ejecutar varias veces.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank', 'bank', false, 5242880, array['application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bank_read on storage.objects;
create policy bank_read on storage.objects
  for select to authenticated
  using (bucket_id = 'bank');

drop policy if exists bank_admin_write on storage.objects;
create policy bank_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'bank' and public.is_weref_admin())
  with check (bucket_id = 'bank' and public.is_weref_admin());
