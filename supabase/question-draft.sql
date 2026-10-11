-- =====================================================================
-- WEREF · Preguntas en borrador (retiradas del juego)
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra ni cambia ninguna pregunta.
--
-- Qué hace:
--   * Añade la marca "draft" a las preguntas del banco compartido.
--   * Una pregunta en borrador sigue en la Base de datos (la ven los
--     administradores), pero NO aparece en la web: ni en tests, ni en
--     Repaso, ni en VAR, ni en los tests del comité hasta que se vuelva a
--     publicar.
-- =====================================================================

alter table public.shared_questions
  add column if not exists draft boolean not null default false;
