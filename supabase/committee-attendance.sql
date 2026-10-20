-- ============================================================
--  CTA BAGES · Asistencia a las clases presenciales
--  Ejecutar UNA vez en Supabase → SQL Editor. Es seguro repetirlo.
--
--  * committee_sessions   → una fila por clase (la fecha).
--  * committee_attendance → una fila por alumno presente (si no hay fila, no vino).
--  * committee_checkin    → código temporal del QR (solo lo toca el servidor).
--  * Cada alumno solo puede leer SU asistencia; los administradores ven y editan todo.
--  * El QR cambia de código cada pocos segundos y solo vale el mismo día de la clase,
--    así una foto del QR enviada a alguien que no está en el aula no sirve.
-- ============================================================

-- 1) Clases
create table if not exists public.committee_sessions (
  id         uuid primary key default gen_random_uuid(),
  class_date date not null unique,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- 2) Asistencia (solo se guardan los presentes)
create table if not exists public.committee_attendance (
  session_id uuid not null references public.committee_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  method     text not null default 'manual' check (method in ('manual', 'qr')),
  marked_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists committee_attendance_user_idx on public.committee_attendance (user_id);

-- 3) Código temporal del QR
create table if not exists public.committee_checkin (
  session_id uuid primary key references public.committee_sessions(id) on delete cascade,
  token      text not null,
  prev_token text,
  rotated_at timestamptz not null default now(),
  open_until timestamptz not null
);

alter table public.committee_sessions   enable row level security;
alter table public.committee_attendance enable row level security;
alter table public.committee_checkin    enable row level security;

-- Día (hora de Madrid) en que se dio de alta el alumno: las clases anteriores no le cuentan.
create or replace function public.committee_my_start_date()
returns date
language sql stable security definer set search_path = public as $$
  select (m.added_at at time zone 'Europe/Madrid')::date
  from public.committee_members m where m.user_id = auth.uid();
$$;
revoke all on function public.committee_my_start_date() from public, anon;
grant execute on function public.committee_my_start_date() to authenticated;

drop policy if exists committee_sessions_read on public.committee_sessions;
create policy committee_sessions_read on public.committee_sessions
  for select to authenticated
  using (
    public.is_committee_admin()
    or (public.is_committee_member() and (
          class_date >= public.committee_my_start_date()
          or exists (select 1 from public.committee_attendance a where a.session_id = committee_sessions.id and a.user_id = auth.uid())
       ))
  );

drop policy if exists committee_sessions_admin on public.committee_sessions;
create policy committee_sessions_admin on public.committee_sessions
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

drop policy if exists committee_attendance_read on public.committee_attendance;
create policy committee_attendance_read on public.committee_attendance
  for select to authenticated
  using ((user_id = auth.uid() and public.is_committee_member()) or public.is_committee_admin());

drop policy if exists committee_attendance_admin on public.committee_attendance;
create policy committee_attendance_admin on public.committee_attendance
  for all to authenticated
  using (public.is_committee_admin()) with check (public.is_committee_admin());

-- committee_checkin no tiene políticas: nadie la lee directamente, solo las funciones de abajo.
revoke all on public.committee_sessions   from anon;
revoke all on public.committee_attendance from anon;
revoke all on public.committee_checkin    from anon, authenticated;

-- 4) Porcentaje mínimo de asistencia (aviso en rojo)
do $$
begin
  if to_regclass('public.committee_settings') is not null then
    alter table public.committee_settings add column if not exists attendance_threshold int not null default 75;
  end if;
end $$;

-- 5) Administrador: genera (y renueva) el código del QR. Solo el mismo día de la clase.
create or replace function public.committee_checkin_token(p_session uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare d date; t text; v timestamptz;
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  select class_date into d from public.committee_sessions where id = p_session;
  if d is null then raise exception 'not_found'; end if;
  if d <> (now() at time zone 'Europe/Madrid')::date then raise exception 'not_today'; end if;
  t := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v := now() + interval '3 minutes';
  insert into public.committee_checkin (session_id, token, prev_token, rotated_at, open_until)
  values (p_session, t, null, now(), v)
  on conflict (session_id) do update
    set prev_token = public.committee_checkin.token,
        token      = excluded.token,
        rotated_at = now(),
        open_until = excluded.open_until;
  return json_build_object('token', t, 'open_until', v);
end $$;

create or replace function public.committee_checkin_close(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_committee_admin() then raise exception 'no_access'; end if;
  delete from public.committee_checkin where session_id = p_session;
end $$;

-- 6) Alumno: registra su asistencia con el código del QR
create or replace function public.committee_checkin(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare c record; d date; n int;
begin
  if auth.uid() is null or not public.is_committee_member() then raise exception 'no_access'; end if;
  if p_token is null or length(p_token) < 8 then raise exception 'invalid_code'; end if;
  select * into c from public.committee_checkin k
   where k.open_until > now()
     and (k.token = p_token or (k.prev_token = p_token and k.rotated_at > now() - interval '45 seconds'))
   limit 1;
  if not found then raise exception 'invalid_code'; end if;
  select class_date into d from public.committee_sessions where id = c.session_id;
  if d is null or d <> (now() at time zone 'Europe/Madrid')::date then raise exception 'invalid_code'; end if;
  insert into public.committee_attendance (session_id, user_id, method)
  values (c.session_id, auth.uid(), 'qr')
  on conflict (session_id, user_id) do nothing;
  get diagnostics n = row_count;
  return json_build_object('session_id', c.session_id, 'class_date', d, 'already', n = 0);
end $$;

revoke all on function public.committee_checkin_token(uuid) from public, anon;
revoke all on function public.committee_checkin_close(uuid) from public, anon;
revoke all on function public.committee_checkin(text)       from public, anon;
grant execute on function public.committee_checkin_token(uuid) to authenticated;
grant execute on function public.committee_checkin_close(uuid) to authenticated;
grant execute on function public.committee_checkin(text)       to authenticated;
