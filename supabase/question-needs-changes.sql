-- ============================================================
--  Base de datos · estado «Necesita cambios» de una pregunta
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--  Requiere haber ejecutado antes question-reviews.sql.
--
--  Una pregunta queda en uno de tres estados, compartidos por todas las cuentas de administración:
--    · Sin revisar        reviewed_at vacío   y needs_changes = false
--    · Revisada           reviewed_at con fecha y needs_changes = false
--    · Necesita cambios   reviewed_at vacío   y needs_changes = true
--  Lo que ya estaba revisado sigue igual (needs_changes empieza en false).
-- ============================================================

alter table public.question_reviews
  add column if not exists needs_changes boolean not null default false;
