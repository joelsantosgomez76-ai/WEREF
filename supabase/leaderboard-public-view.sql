-- Clasificación: que el resto de usuarios solo vea lo que promete la Política de Privacidad
-- (nombre de usuario, puntos, posición y país), sin user_id.
-- Ejecutar en dos pasos, en este orden.

-- ============ PASO 1 (seguro, se puede ejecutar ya) ============
-- Crea una vista pública de la clasificación. No cambia nada de lo que ya funciona.
create or replace view public.leaderboard_public as
select
  mode,
  score,
  username,
  country,
  rank_name,
  points,
  updated_at,
  (user_id = auth.uid()) as is_me
from public.leaderboard_scores;

revoke all on public.leaderboard_public from public, anon;
grant select on public.leaderboard_public to authenticated;

-- ============ PASO 2 (solo DESPUÉS de publicar la versión nueva de la app) ============
-- Cada usuario pasa a leer en la tabla solo su propia fila; el resto va por la vista.
-- drop policy if exists leaderboard_select_authenticated on public.leaderboard_scores;
-- create policy leaderboard_select_own on public.leaderboard_scores
--   for select to authenticated using (user_id = auth.uid());

-- Comprobación (solo lectura): debe devolver filas y no mostrar user_id.
-- select * from public.leaderboard_public limit 3;
