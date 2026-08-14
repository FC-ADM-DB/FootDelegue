-- Schéma FootDelegue — à coller et exécuter dans l'éditeur SQL de ton projet Supabase
-- (Project > SQL Editor > New query)

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null default '5v5',
  materiel jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  opponent text,
  date date,
  status text not null default 'prevu',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  label text not null,
  responsable text default '',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table tasks enable row level security;

-- Seuls les comptes connectés (toi et ta femme) peuvent lire/écrire.
-- Comme il n'y a que vous deux et que vous partagez tout, il n'y a pas de
-- notion de "propriétaire" par équipe : un compte connecté = accès à tout.
create policy "acces_connectes" on teams for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "acces_connectes" on players for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "acces_connectes" on matches for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "acces_connectes" on tasks for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
