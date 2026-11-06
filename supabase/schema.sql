-- MaatMan: tabellen, toegangsregels en pagina's
-- ---------------------------------------------------------------------------
-- Eenmalig uitvoeren in de Supabase SQL-editor (Project > SQL Editor > New query),
-- in hetzelfde project als Marktmonitor en Leadbeheer.
--
-- VEREIST: supabase/page_access.sql uit de Scrappingtool-v2-repo is al gedraaid
-- (app_pages, user_page_access, has_page_access()).
--
-- Toegang
--   maatman.dashboard     Overzicht      lezen
--   maatman.calculator    Calculator     lezen
--   maatman.instellingen  Instellingen   lezen én wijzigen
-- Wie geen van deze drie pagina's heeft, kan de MaatMan-tabellen niet lezen,
-- ook niet met een eigen API-request (RLS hieronder). Nieuwe gebruikers krijgen
-- deze pagina's NIET standaard: een beheerder zet ze per persoon aan in admin.html.
--
-- Veilig om opnieuw te draaien.
-- ---------------------------------------------------------------------------

-- 1. Pagina's in het beheerpaneel -----------------------------------------
insert into public.app_pages (key, system, system_label, label, url, sort_order) values
  ('maatman.dashboard',    'maatman', 'Maatman', 'Overzicht',    'https://mathieu-butenaerts.github.io/maatman/',                   30),
  ('maatman.calculator',   'maatman', 'Maatman', 'Calculator',   'https://mathieu-butenaerts.github.io/maatman/calculator.html',    31),
  ('maatman.instellingen', 'maatman', 'Maatman', 'Instellingen', 'https://mathieu-butenaerts.github.io/maatman/instellingen.html',  32)
on conflict (key) do update set label = excluded.label, url = excluded.url, sort_order = excluded.sort_order;

-- 2. Hulpfuncties ----------------------------------------------------------
create or replace function public.maatman_can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_page_access('maatman.dashboard')
      or public.has_page_access('maatman.calculator')
      or public.has_page_access('maatman.instellingen');
$$;

create or replace function public.maatman_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_page_access('maatman.instellingen');
$$;

grant execute on function public.maatman_can_read() to authenticated;
grant execute on function public.maatman_can_edit() to authenticated;

-- 3. Tabellen ----------------------------------------------------------------
-- Id's zijn tekst die de app zelf maakt (bv. 'c-12924' = personeelsnummer uit
-- Oracle, 'p-104719' = projectnummer), zodat een nieuwe import dezelfde id's geeft.

create table if not exists public.maatman_consultants (
  id          text primary key,
  pfid        text,                         -- personeelsnummer
  name        text not null default '',
  level       text,                         -- functieniveau: TRA, JUN, MED, SPC, SEN, PRI, MAN
  pt          numeric not null default 1,   -- parttimefactor, 1 = fulltime
  salary      numeric,                      -- fulltime maandsalaris
  holiday_ft  numeric,                      -- vakantiegeld per maand, fulltime
  car         numeric,                      -- leaseauto per maand incl. btw, null = mobiliteitsbudget
  notes       jsonb not null default '[]',  -- meldingen uit de import
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

create table if not exists public.maatman_projects (
  id          text primary key,
  number      text,
  name        text,
  client      text,
  cao         numeric,                      -- code cao (kolom "Code CAO" in de salarisschalen)
  version     text not null default '',     -- '' = automatisch op peildatum
  scale       text,
  scale_pos   numeric,                      -- positie in schaal, null = standaard uit de aannames
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

create table if not exists public.maatman_allocations (
  id            text primary key,
  consultant_id text not null references public.maatman_consultants(id) on delete cascade,
  project_id    text not null references public.maatman_projects(id) on delete cascade,
  assign        numeric not null default 1, -- opdrachtpercentage, 1 = 100%
  scale         text,                       -- null = schaal van het project
  start_date    date,
  end_date      date,
  notes         jsonb not null default '[]',
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid()
);
create index if not exists maatman_allocations_consultant on public.maatman_allocations (consultant_id);
create index if not exists maatman_allocations_project    on public.maatman_allocations (project_id);

-- Eén rij met de gedeelde methode en aannames, plus de cao-schalen uit de laatste import.
create table if not exists public.maatman_settings (
  id          smallint primary key default 1 check (id = 1),
  settings    jsonb,                        -- aannames (bedragen, percentages, functieniveaus)
  toggles     jsonb,                        -- methodekeuzes
  method      text,                         -- 'excel' | 'strict' | 'custom'
  scales      jsonb,                        -- cao-schalen; null = ingebouwde schalen van de site
  import_info text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

-- Wie wat het laatst wijzigde
create or replace function public.maatman_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['maatman_consultants', 'maatman_projects', 'maatman_allocations', 'maatman_settings'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.maatman_touch()', t);
  end loop;
end $$;

-- 4. Row-level security ------------------------------------------------------
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array['maatman_consultants', 'maatman_projects', 'maatman_allocations', 'maatman_settings'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "maatman read"   on public.%I for select to authenticated using (public.maatman_can_read())', t);
    execute format('create policy "maatman insert" on public.%I for insert to authenticated with check (public.maatman_can_edit())', t);
    execute format('create policy "maatman update" on public.%I for update to authenticated using (public.maatman_can_edit()) with check (public.maatman_can_edit())', t);
    execute format('create policy "maatman delete" on public.%I for delete to authenticated using (public.maatman_can_edit())', t);
  end loop;
end $$;

-- 5. Import: alles in één keer vervangen ---------------------------------
-- Draait met de rechten van de gebruiker (security invoker), dus RLS geldt.
-- Eén transactie: mislukt er iets, dan blijft de oude stand staan.
create or replace function public.maatman_replace_all(
  p_consultants jsonb, p_projects jsonb, p_allocations jsonb, p_scales jsonb, p_import_info text
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.maatman_can_edit() then
    raise exception 'Geen toegang tot MaatMan-instellingen';
  end if;

  delete from public.maatman_allocations where true;
  delete from public.maatman_projects    where true;
  delete from public.maatman_consultants where true;

  insert into public.maatman_consultants (id, pfid, name, level, pt, salary, holiday_ft, car, notes)
  select x.id, x.pfid, coalesce(x.name, ''), x.level, coalesce(x.pt, 1), x.salary, x.holiday_ft, x.car, coalesce(x.notes, '[]'::jsonb)
  from jsonb_to_recordset(coalesce(p_consultants, '[]'::jsonb))
    as x(id text, pfid text, name text, level text, pt numeric, salary numeric, holiday_ft numeric, car numeric, notes jsonb);

  insert into public.maatman_projects (id, number, name, client, cao, version, scale, scale_pos)
  select x.id, x.number, x.name, x.client, x.cao, coalesce(x.version, ''), x.scale, x.scale_pos
  from jsonb_to_recordset(coalesce(p_projects, '[]'::jsonb))
    as x(id text, number text, name text, client text, cao numeric, version text, scale text, scale_pos numeric);

  insert into public.maatman_allocations (id, consultant_id, project_id, assign, scale, start_date, end_date, notes)
  select x.id, x.consultant_id, x.project_id, coalesce(x.assign, 1), x.scale, x.start_date, x.end_date, coalesce(x.notes, '[]'::jsonb)
  from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb))
    as x(id text, consultant_id text, project_id text, assign numeric, scale text, start_date date, end_date date, notes jsonb);

  insert into public.maatman_settings (id, scales, import_info) values (1, p_scales, p_import_info)
  on conflict (id) do update
    set scales = coalesce(excluded.scales, public.maatman_settings.scales),
        import_info = excluded.import_info;
end;
$$;

grant execute on function public.maatman_replace_all(jsonb, jsonb, jsonb, jsonb, text) to authenticated;

-- 6. Live bijwerken in open tabbladen ---------------------------------------
do $$
declare t text;
begin
  foreach t in array array['maatman_consultants', 'maatman_projects', 'maatman_allocations', 'maatman_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
