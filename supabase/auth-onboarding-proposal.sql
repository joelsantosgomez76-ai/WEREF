-- PROPUESTA (NO EJECUTADA): registro mínimo, onboarding y medición.
-- Se ejecuta en un solo bloque. Al final hay un bloque de vuelta atrás.

-- ============ 1) Onboarding (una fila por usuario) ============
create table if not exists public.profiles_onboarding (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  birth_date     date,
  situacion      text check (situacion in ('quiero_ser','en_formacion','arbitro_activo','entrenador_jugador','otro')),
  federacion     text check (char_length(federacion) <= 80),
  pais           text check (char_length(pais) <= 80),
  ciudad         text check (char_length(ciudad) <= 80),
  categoria      text check (char_length(categoria) <= 80),
  objetivo       text check (objetivo in ('examen_acceso','prueba_ascenso','repasar','curiosidad')),
  fecha_examen   date,
  canal          text check (char_length(canal) <= 80),
  paso_actual    int  not null default 1,
  saltado        boolean not null default false,
  completado_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.profiles_onboarding enable row level security;
drop policy if exists po_select_own on public.profiles_onboarding;
drop policy if exists po_insert_own on public.profiles_onboarding;
drop policy if exists po_update_own on public.profiles_onboarding;
drop policy if exists po_delete_own on public.profiles_onboarding;
create policy po_select_own on public.profiles_onboarding for select to authenticated using (user_id = auth.uid());
create policy po_insert_own on public.profiles_onboarding for insert to authenticated with check (user_id = auth.uid());
create policy po_update_own on public.profiles_onboarding for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy po_delete_own on public.profiles_onboarding for delete to authenticated using (user_id = auth.uid());
revoke all on public.profiles_onboarding from anon;

-- Edad mínima de 14 años y sello de actualización, en el servidor.
create or replace function public.po_validate() returns trigger language plpgsql as $$
begin
  if new.birth_date is not null and (new.birth_date > (current_date - interval '14 years')::date or new.birth_date < date '1900-01-01') then
    raise exception 'Debes tener 14 años o más para usar WEREF.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists po_validate_trg on public.profiles_onboarding;
create trigger po_validate_trg before insert or update on public.profiles_onboarding
  for each row execute function public.po_validate();

-- ============ 2) Fechas clave del usuario (independientes de las cookies) ============
create table if not exists public.user_milestones (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  registered_at           timestamptz not null default now(),
  email_verified_at       timestamptz,
  onboarding_completed_at timestamptz,
  level_test_at           timestamptz,
  first_test_at           timestamptz,
  last_seen_at            timestamptz
);
alter table public.user_milestones enable row level security;
drop policy if exists um_select_own on public.user_milestones;
create policy um_select_own on public.user_milestones for select to authenticated using (user_id = auth.uid());
revoke all on public.user_milestones from anon;
revoke insert, update, delete on public.user_milestones from authenticated;   -- solo se escribe con la función de abajo

create or replace function public.touch_milestone(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_milestones (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  if    p_name = 'email_verified' then update public.user_milestones set email_verified_at = coalesce(email_verified_at, now()) where user_id = auth.uid();
  elsif p_name = 'onboarding'     then update public.user_milestones set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where user_id = auth.uid();
  elsif p_name = 'level_test'     then update public.user_milestones set level_test_at = coalesce(level_test_at, now()) where user_id = auth.uid();
  elsif p_name = 'first_test'     then update public.user_milestones set first_test_at = coalesce(first_test_at, now()) where user_id = auth.uid();
  elsif p_name = 'seen'           then update public.user_milestones set last_seen_at = now() where user_id = auth.uid();
  else raise exception 'Hito no válido';
  end if;
end $$;
revoke all on function public.touch_milestone(text) from public, anon;
grant execute on function public.touch_milestone(text) to authenticated;

-- ============ 3) Aceptaciones (términos, privacidad, newsletter) con fecha y versión ============
create table if not exists public.consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('terms','privacy','newsletter')),
  version    text not null,
  accepted   boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.consents enable row level security;
drop policy if exists consents_select_own on public.consents;
drop policy if exists consents_insert_own on public.consents;
create policy consents_select_own on public.consents for select to authenticated using (user_id = auth.uid());
create policy consents_insert_own on public.consents for insert to authenticated with check (user_id = auth.uid());
revoke all on public.consents from anon;
revoke update, delete on public.consents from authenticated;                  -- es un registro: solo se añaden filas

-- ============ 4) Test de nivel (resultado por usuario) ============
create table if not exists public.level_test_results (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  taken_at  timestamptz not null default now(),
  correct   int not null check (correct between 0 and 10),
  total     int not null check (total between 1 and 10),
  by_rule   jsonb not null default '{}'::jsonb
);
alter table public.level_test_results enable row level security;
drop policy if exists ltr_select_own on public.level_test_results;
drop policy if exists ltr_insert_own on public.level_test_results;
create policy ltr_select_own on public.level_test_results for select to authenticated using (user_id = auth.uid());
create policy ltr_insert_own on public.level_test_results for insert to authenticated with check (user_id = auth.uid());
revoke all on public.level_test_results from anon;

-- ============ 5) Al crear una cuenta: edad mínima en el servidor + datos iniciales ============
-- Registro con correo: exige fecha de nacimiento válida y 14 años o más (si no, el registro falla).
-- Registro con Google: no se exige aquí (Google no da la fecha); se pide en un paso intermedio y la valida po_validate.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b date;
  prov text := coalesce(new.raw_app_meta_data->>'provider', 'email');
  tv text := new.raw_user_meta_data->>'terms_version';
begin
  insert into public.user_milestones (user_id, registered_at) values (new.id, now()) on conflict (user_id) do nothing;
  if prov = 'email' then
    begin b := (new.raw_user_meta_data->>'birthdate')::date; exception when others then b := null; end;
    if b is null or b > (current_date - interval '14 years')::date or b < date '1900-01-01' then
      raise exception 'Debes tener 14 años o más para registrarte.';
    end if;
    insert into public.profiles_onboarding (user_id, birth_date) values (new.id, b)
      on conflict (user_id) do update set birth_date = excluded.birth_date;
    if tv is not null then
      insert into public.consents (user_id, kind, version) values (new.id, 'terms', tv), (new.id, 'privacy', tv);
    end if;
    if lower(coalesce(new.raw_user_meta_data->>'marketing_opt_in', 'false')) = 'true' then
      insert into public.consents (user_id, kind, version) values (new.id, 'newsletter', coalesce(tv, 'sin-version'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists weref_on_auth_user_created on auth.users;
create trigger weref_on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Al verificar el correo, se anota la fecha.
create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.user_milestones set email_verified_at = new.email_confirmed_at where user_id = new.id and email_verified_at is null;
  return new;
end $$;
drop trigger if exists weref_on_auth_user_confirmed on auth.users;
create trigger weref_on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ============ 6) Usuarios que ya existen: fechas conocidas ============
insert into public.user_milestones (user_id, registered_at, email_verified_at, last_seen_at)
select id, created_at, email_confirmed_at, last_sign_in_at from auth.users
on conflict (user_id) do nothing;

-- ============ VUELTA ATRÁS (solo si algo fallara; es seguro: no toca cuentas ni datos de estudio) ============
-- drop trigger if exists weref_on_auth_user_created on auth.users;
-- drop trigger if exists weref_on_auth_user_confirmed on auth.users;
-- (las tablas nuevas se pueden dejar o borrar con drop table ... cascade)

-- ============ COMPROBACIONES que hay que ejecutar ANTES (solo lectura) ============
-- ¿Está aplicado security-hardening.sql?
--   select proname from pg_proc where proname = 'username_available';                       -- debe devolver 1 fila
--   select policyname, cmd from pg_policies where tablename = 'usernames';                    -- solo usernames_select_own (SELECT) + el INSERT propio
-- ¿Hay ya algún trigger sobre auth.users?
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
