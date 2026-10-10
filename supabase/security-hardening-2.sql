-- =====================================================================
-- WEREF · Refuerzo de seguridad (2) — revisión de políticas
--
-- Ejecutar UNA VEZ en Supabase -> SQL Editor -> New query -> pegar todo -> Run.
-- Es seguro repetirlo: no borra datos.
--
-- Qué corrige:
--   * Mensajes de contacto: cualquiera podía enviar mensajes sin límite (cada uno
--     dispara un email). Ahora hay límites de tamaño y de frecuencia.
--   * Clasificación: la política de lectura seguía abierta a visitantes; un usuario
--     podía poner el nombre que quisiera y puntuaciones imposibles.
--   * user_data: la política decía "público"; se limita a usuarios con sesión.
--   * Sugerencias: tamaño máximo del mensaje.
--   * Nombres de usuario y reportes: sin duplicados.
-- =====================================================================

-- ---------- 1) Mensajes de contacto: límites y freno anti-spam ----------
alter table public.contact_messages add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contact_messages_limits') then
    alter table public.contact_messages add constraint contact_messages_limits check (
      char_length(coalesce(name, '')) between 1 and 100
      and char_length(coalesce(email, '')) between 5 and 254
      and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and char_length(coalesce(message, '')) between 1 and 3000
    ) not valid;
  end if;
end
$$;

create or replace function public.contact_messages_rate_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Demasiados mensajes. Inténtalo más tarde.';
  end if;
  if (select count(*) from public.contact_messages
        where lower(email) = lower(new.email) and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Has enviado varios mensajes seguidos. Espera un rato.';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_messages_rate_limit_trg on public.contact_messages;
create trigger contact_messages_rate_limit_trg
  before insert on public.contact_messages
  for each row execute function public.contact_messages_rate_limit();

-- ---------- 2) Clasificación ----------
drop policy if exists "Anyone can view the leaderboard" on public.leaderboard_scores;
drop policy if exists leaderboard_select_authenticated on public.leaderboard_scores;
create policy leaderboard_select_authenticated on public.leaderboard_scores
  for select to authenticated using (true);

create or replace function public.leaderboard_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- El nombre que sale en la clasificación es siempre el nombre de usuario real.
  new.username := (select u.username from public.usernames u where u.user_id = new.user_id);
  if new.mode not in ('hearts', 'suddendeath', 'timeattack') then
    raise exception 'Modo no válido';
  end if;
  if new.score < 0 or new.score > (case when new.mode = 'timeattack' then 150 else 5000 end) then
    raise exception 'Puntuación no válida';
  end if;
  if new.points is not null and (new.points < 0 or new.points > 1000000) then
    raise exception 'Puntos no válidos';
  end if;
  return new;
end;
$$;

drop trigger if exists leaderboard_guard_trg on public.leaderboard_scores;
create trigger leaderboard_guard_trg
  before insert or update on public.leaderboard_scores
  for each row execute function public.leaderboard_guard();

-- ---------- 3) user_data: solo usuarios con sesión ----------
alter policy "Users manage their own data" on public.user_data to authenticated;

-- ---------- 4) Sugerencias: tamaño máximo ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suggestions_message_len') then
    alter table public.suggestions add constraint suggestions_message_len
      check (char_length(coalesce(message, '')) between 1 and 3000) not valid;
  end if;
end
$$;

-- ---------- 5) Sin duplicados (si ya hubiera duplicados, se avisa y se sigue) ----------
do $$
begin
  begin
    create unique index if not exists usernames_username_lower_key on public.usernames (lower(username));
  exception when others then
    raise notice 'No se pudo crear el índice único de nombres de usuario (puede haber duplicados): %', sqlerrm;
  end;
  begin
    create unique index if not exists question_reports_user_question_key on public.question_reports (user_id, question_id);
  exception when others then
    raise notice 'No se pudo crear el índice único de reportes (puede haber duplicados): %', sqlerrm;
  end;
end
$$;
