-- Reservaties appartement aan zee — databank en beveiliging.
-- Plak dit volledig in Supabase > SQL Editor > New query en klik Run.
-- Je mag het later opnieuw uitvoeren (bv. na het toevoegen van een partij).

create extension if not exists btree_gist;

-- ============================================================
-- Partijen
-- ============================================================
create table if not exists public.parties (
  key      text primary key,
  label    text not null,
  color    text not null,
  external boolean not null default false,
  sort     int not null default 0
);

-- Een partij toevoegen of hernoemen: pas deze lijst aan en voer het script opnieuw uit.
insert into public.parties (key, label, color, external, sort) values
  ('celine-matthias', 'Celine & Matthias', '#e07a5f', false, 1),
  ('nadine-johan',    'Nadine & Johan',    '#3d85c6', false, 2),
  ('mieke-denis',     'Mieke & Denis',     '#6aa84f', false, 3),
  ('nicolas-jef',     'Nicolas & Jef',     '#b366c4', false, 4),
  ('stefanie-jonas',  'Stefanie & Jonas',  '#d4a017', false, 5),
  ('mathis',          'Mathis',            '#16a2a2', false, 6),
  ('external',        'EXTERNAL',          '#3a3a3a', true,  99)
on conflict (key) do update
  set label = excluded.label, color = excluded.color, external = excluded.external, sort = excluded.sort;

-- ============================================================
-- Profielen (één per login)
-- ============================================================
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  name                 text not null default '',
  party                text references public.parties(key),
  is_admin             boolean not null default false,
  -- Nieuwe logins staan standaard UIT. Enkel wie via de beheerpagina is
  -- aangemaakt (of door jou aangezet) komt binnen.
  active               boolean not null default false,
  must_change_password boolean not null default true,
  phone                text,
  notify_whatsapp      boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Persoonlijke CallMeBot-sleutel: enkel leesbaar voor de eigenaar zelf.
create table if not exists public.whatsapp_keys (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  callmebot_key text not null
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Hulpfuncties voor de beveiliging
-- ============================================================
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and is_admin);
$$;

-- Mag de ingelogde gebruiker reservaties van deze partij maken/wijzigen?
-- Beheerder: alles. Familielid: enkel de eigen partij, nooit EXTERNAL.
create or replace function public.can_manage(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from profiles u join parties pa on pa.key = p
    where u.id = auth.uid() and u.active and u.party = p and not pa.external
  );
$$;

-- Gewone gebruikers mogen enkel naam, gsm en meldingen van zichzelf aanpassen.
create or replace function public.guard_profile()
returns trigger language plpgsql set search_path = public as $$
begin
  -- SQL Editor en de Edge Function (service_role) mogen alles.
  if current_user not in ('authenticated', 'anon')
     or coalesce(current_setting('egmont.bypass', true), '') = 'on' or public.is_admin() then
    return new;
  end if;
  if new.email is distinct from old.email or new.party is distinct from old.party
     or new.is_admin is distinct from old.is_admin or new.active is distinct from old.active
     or new.must_change_password is distinct from old.must_change_password then
    raise exception 'Dit mag enkel de beheerder aanpassen';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Na het kiezen van een eigen paswoord.
create or replace function public.password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('egmont.bypass', 'on', true);
  update profiles set must_change_password = false where id = auth.uid();
end $$;

-- Voor de "wakker houden"-taak (gratis Supabase-projecten pauzeren na een week stilte).
create or replace function public.ping()
returns int language sql as $$ select 1 $$;
grant execute on function public.ping() to anon;

-- ============================================================
-- Reservaties
-- ============================================================
create table if not exists public.reservations (
  id         bigint generated always as identity primary key,
  party      text not null references public.parties(key),
  start_date date not null,                 -- aankomstdag
  end_date   date not null,                 -- vertrekdag
  note       text not null default '' check (char_length(note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vertrek_na_aankomst check (end_date > start_date),
  constraint max_120_nachten check (end_date - start_date <= 120),
  -- Twee reservaties kunnen nooit overlappen (vertrekdag = aankomstdag mag wel).
  constraint geen_overlap exclude using gist (daterange(start_date, end_date, '[)') with &&)
);

create or replace function public.stamp_reservation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stamp_reservation on public.reservations;
create trigger stamp_reservation before insert or update on public.reservations
  for each row execute function public.stamp_reservation();

-- ============================================================
-- Chat
-- ============================================================
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null default auth.uid(),
  is_system  boolean not null default false,   -- automatische melding over een reservatie
  actor_id   uuid references public.profiles(id) on delete set null, -- wie de actie deed
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_created on public.messages (id desc);

-- Elke wijziging aan een reservatie komt als bericht in de chat.
-- (Een Database Webhook op messages stuurt elk nieuw bericht door via WhatsApp.)
create or replace function public.reservation_to_chat()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce((select name from profiles where id = auth.uid()), 'iemand');
  txt text;
  fmt text := 'DD/MM/YYYY';
begin
  if tg_op = 'INSERT' then
    txt := format(E'🏖️ Nieuwe reservatie door %s\n%s: %s → %s (%s nachten)%s', who,
      (select label from parties where key = new.party), to_char(new.start_date, fmt), to_char(new.end_date, fmt),
      new.end_date - new.start_date, case when new.note <> '' then E'\n„' || new.note || '”' else '' end);
  elsif tg_op = 'UPDATE' then
    if (new.party, new.start_date, new.end_date, new.note) = (old.party, old.start_date, old.end_date, old.note) then
      return null;
    end if;
    txt := format(E'✏️ Reservatie gewijzigd door %s\nWas: %s: %s → %s\nNu: %s: %s → %s (%s nachten)%s', who,
      (select label from parties where key = old.party), to_char(old.start_date, fmt), to_char(old.end_date, fmt),
      (select label from parties where key = new.party), to_char(new.start_date, fmt), to_char(new.end_date, fmt),
      new.end_date - new.start_date, case when new.note <> '' then E'\n„' || new.note || '”' else '' end);
  else
    txt := format(E'🗑️ Reservatie geannuleerd door %s\n%s: %s → %s', who,
      (select label from parties where key = old.party), to_char(old.start_date, fmt), to_char(old.end_date, fmt));
  end if;
  insert into messages (user_id, is_system, actor_id, body) values (null, true, auth.uid(), txt);
  return null;
end $$;

drop trigger if exists reservation_to_chat on public.reservations;
create trigger reservation_to_chat after insert or update or delete on public.reservations
  for each row execute function public.reservation_to_chat();

-- ============================================================
-- Toegangsregels (Row Level Security)
-- ============================================================
alter table public.parties       enable row level security;
alter table public.profiles      enable row level security;
alter table public.whatsapp_keys enable row level security;
alter table public.reservations  enable row level security;
alter table public.messages      enable row level security;

drop policy if exists "leden zien partijen" on public.parties;
create policy "leden zien partijen" on public.parties for select to authenticated using (public.is_member());

drop policy if exists "eigen profiel of leden" on public.profiles;
create policy "eigen profiel of leden" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
drop policy if exists "eigen profiel of beheerder wijzigt" on public.profiles;
create policy "eigen profiel of beheerder wijzigt" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists "eigen sleutel" on public.whatsapp_keys;
create policy "eigen sleutel" on public.whatsapp_keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "leden zien reservaties" on public.reservations;
create policy "leden zien reservaties" on public.reservations for select to authenticated using (public.is_member());
drop policy if exists "reserveren voor eigen partij" on public.reservations;
create policy "reserveren voor eigen partij" on public.reservations for insert to authenticated
  with check (public.can_manage(party));
drop policy if exists "eigen partij wijzigen" on public.reservations;
create policy "eigen partij wijzigen" on public.reservations for update to authenticated
  using (public.can_manage(party)) with check (public.can_manage(party));
drop policy if exists "eigen partij annuleren" on public.reservations;
create policy "eigen partij annuleren" on public.reservations for delete to authenticated
  using (public.can_manage(party));

drop policy if exists "leden lezen chat" on public.messages;
create policy "leden lezen chat" on public.messages for select to authenticated using (public.is_member());
drop policy if exists "leden schrijven chat" on public.messages;
create policy "leden schrijven chat" on public.messages for insert to authenticated
  with check (public.is_member() and user_id = auth.uid() and not is_system and actor_id is null);
drop policy if exists "beheerder wist chat" on public.messages;
create policy "beheerder wist chat" on public.messages for delete to authenticated using (public.is_admin());

-- Live bijwerken van kalender en chat
do $$ begin
  alter publication supabase_realtime add table public.reservations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
