-- =====================================================================
--  To do projets : base de données en ligne (Supabase)
--  À coller en une fois dans Supabase > SQL Editor > New query, puis "Run".
--  Le script peut être relancé sans risque : il ne supprime aucune donnée.
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.projects (
  id          text primary key default gen_random_uuid()::text,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  name        text not null,
  color       text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  email      text not null check (email = lower(email)),
  added_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (project_id, email)
);

create table if not exists public.tasks (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  title       text not null,
  priority    text not null default 'normale' check (priority in ('haute','normale','basse')),
  due         date,
  status      text not null default 'todo' check (status in ('todo','doing','done')),
  note        text not null default '',
  who         text not null default '',
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  done_at     bigint,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_by  text not null default lower(coalesce(auth.jwt() ->> 'email', ''))
);

create index if not exists tasks_project_idx   on public.tasks(project_id);
create index if not exists members_email_idx   on public.project_members(email);
create index if not exists projects_owner_idx  on public.projects(owner);

-- ---------- Fonctions d'accès ----------
-- E-mail de l'utilisateur connecté
create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- L'utilisateur connecté est-il propriétaire du projet ?
create or replace function public.is_owner(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = pid and owner = auth.uid())
$$;

-- L'utilisateur connecté a-t-il accès au projet (propriétaire ou invité) ?
create or replace function public.can_access(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and (p.owner = auth.uid()
           or exists (select 1 from public.project_members m
                      where m.project_id = p.id and m.email = public.my_email()))
  )
$$;

-- ---------- Règles d'accès (chacun ne voit que ses projets et ceux partagés avec lui) ----------
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks           enable row level security;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
-- (owner = auth.uid() est indispensable : lors d'un enregistrement, le projet n'est pas encore visible par can_access)
create policy projects_select on public.projects for select to authenticated using (owner = auth.uid() or public.can_access(id));
create policy projects_insert on public.projects for insert to authenticated with check (owner = auth.uid());
create policy projects_update on public.projects for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy projects_delete on public.projects for delete to authenticated using (owner = auth.uid());

drop policy if exists members_select on public.project_members;
drop policy if exists members_insert on public.project_members;
drop policy if exists members_delete on public.project_members;
create policy members_select on public.project_members for select to authenticated using (public.can_access(project_id));
create policy members_insert on public.project_members for insert to authenticated with check (public.is_owner(project_id));
-- le propriétaire retire un invité, ou un invité quitte le projet
create policy members_delete on public.project_members for delete to authenticated using (public.is_owner(project_id) or email = public.my_email());

drop policy if exists tasks_all on public.tasks;
create policy tasks_all on public.tasks for all to authenticated
  using (public.can_access(project_id)) with check (public.can_access(project_id));

-- Le propriétaire et l'adresse e-mail d'un projet ne peuvent pas être modifiés après création
create or replace function public.keep_owner() returns trigger
language plpgsql as $$
begin
  new.owner := old.owner;
  new.owner_email := old.owner_email;
  return new;
end $$;
drop trigger if exists projects_keep_owner on public.projects;
create trigger projects_keep_owner before update on public.projects
  for each row execute function public.keep_owner();

grant select, insert, update, delete on public.projects, public.project_members, public.tasks to authenticated;
revoke all on public.projects, public.project_members, public.tasks from anon;

-- ---------- Temps réel ----------
do $$
declare t text;
begin
  foreach t in array array['projects','project_members','tasks'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Contrôle du domaine des adresses e-mail à l'inscription ----------
-- Liste vide = toutes les adresses sont acceptées. Pour restreindre : array['mecalux.com'].
create or replace function public.check_signup_domain() returns trigger
language plpgsql security definer set search_path = public as $$
declare allowed text[] := array[]::text[];
begin
  if coalesce(array_length(allowed, 1), 0) > 0
     and lower(split_part(coalesce(new.email, ''), '@', 2)) <> all (allowed) then
    raise exception 'Adresse e-mail non autorisée (domaine)';
  end if;
  return new;
end $$;
drop trigger if exists check_signup_domain on auth.users;
create trigger check_signup_domain before insert on auth.users
  for each row execute function public.check_signup_domain();

-- ---------- Durcissement (recommandations de l'analyse de sécurité Supabase) ----------
alter function public.my_email() set search_path = public;
alter function public.keep_owner() set search_path = public;
revoke execute on function public.check_signup_domain() from public, anon, authenticated;
revoke execute on function public.can_access(text) from public, anon;
revoke execute on function public.is_owner(text) from public, anon;
grant execute on function public.can_access(text) to authenticated;
grant execute on function public.is_owner(text) to authenticated;
