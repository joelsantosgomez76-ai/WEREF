-- ============================================================
--  Árbitros Asistentes → Regla 6
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  La sala «Árbitros Asistentes» desaparece: todas sus preguntas pasan a la
--  Regla 6 (Los Otros Miembros del Equipo Arbitral). La web ya las lee como
--  Regla 6 aunque no se ejecute esto; el SQL deja los datos igual en la base.
-- ============================================================

update public.shared_questions
   set domain = 'law',
       rule = 6,
       updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
 where domain = 'assistants';
