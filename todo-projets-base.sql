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

-- ---------- Étapes, répétition et commentaires ----------
-- Étapes (check-list) et répétition sur les tâches
alter table public.tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists repeat jsonb;

-- Accès à une tâche (via son projet)
create or replace function public.can_access_task(tid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks t where t.id = tid and public.can_access(t.project_id))
$$;
revoke execute on function public.can_access_task(text) from public, anon;
grant execute on function public.can_access_task(text) to authenticated;

-- Commentaires
create table if not exists public.task_comments (
  id           text primary key default gen_random_uuid()::text,
  task_id      text not null references public.tasks(id) on delete cascade,
  author_email text not null default public.my_email(),
  body         text not null check (length(body) between 1 and 4000),
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists task_comments_task_idx on public.task_comments(task_id);
alter table public.task_comments enable row level security;
drop policy if exists comments_select on public.task_comments;
create policy comments_select on public.task_comments for select to authenticated
  using (public.can_access_task(task_id));
drop policy if exists comments_insert on public.task_comments;
create policy comments_insert on public.task_comments for insert to authenticated
  with check (author_email = public.my_email() and public.can_access_task(task_id));
drop policy if exists comments_delete on public.task_comments;
create policy comments_delete on public.task_comments for delete to authenticated
  using (author_email = public.my_email());
grant select, insert, delete on public.task_comments to authenticated;
revoke all on public.task_comments from anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='task_comments') then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end $$;

-- ---------- Lien du calendrier Outlook publié (un par utilisateur, privé) ----------
create table if not exists public.user_calendar (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ics_url    text not null check (ics_url ~ '^https://' and length(ics_url) < 2000),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.user_calendar enable row level security;
drop policy if exists user_calendar_own on public.user_calendar;
create policy user_calendar_own on public.user_calendar for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.user_calendar to authenticated;
revoke all on public.user_calendar from anon;

-- ---------- Profils (prénom et nom) ----------
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email      text not null unique default public.my_email(),
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name  text not null check (length(trim(last_name)) between 1 and 80),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
-- L'identifiant et l'e-mail viennent toujours de la session, jamais du navigateur
create or replace function public.profiles_force_identity() returns trigger
language plpgsql set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.email := public.my_email();
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  return new;
end $$;
drop trigger if exists profiles_force_identity on public.profiles;
create trigger profiles_force_identity before insert or update on public.profiles
  for each row execute function public.profiles_force_identity();
-- Peut-on voir le profil d'une adresse ? Oui si l'on partage au moins un projet avec elle
create or replace function public.shares_project_with(e text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where public.can_access(p.id)
      and (p.owner_email = lower(e)
           or exists (select 1 from public.project_members m where m.project_id = p.id and m.email = lower(e)))
  )
$$;
revoke execute on function public.shares_project_with(text) from public, anon;
grant execute on function public.shares_project_with(text) to authenticated;
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.shares_project_with(email));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ---------- Familles de tâches (par projet) ----------
alter table public.tasks add column if not exists family text;
create table if not exists public.project_families (
  id         text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists project_families_project_idx on public.project_families(project_id);
alter table public.project_families enable row level security;
drop policy if exists families_select on public.project_families;
create policy families_select on public.project_families for select to authenticated using (public.can_access(project_id));
drop policy if exists families_insert on public.project_families;
create policy families_insert on public.project_families for insert to authenticated with check (public.can_access(project_id));
drop policy if exists families_update on public.project_families;
create policy families_update on public.project_families for update to authenticated using (public.can_access(project_id)) with check (public.can_access(project_id));
drop policy if exists families_delete on public.project_families;
create policy families_delete on public.project_families for delete to authenticated using (public.can_access(project_id));
grant select, insert, update, delete on public.project_families to authenticated;
revoke all on public.project_families from anon;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_families') then
    alter publication supabase_realtime add table public.project_families;
  end if;
end $$;

-- ---------- Corbeille, statut « En attente », archivage et historique ----------
alter table public.tasks add column if not exists deleted_at bigint;
alter table public.tasks add column if not exists waiting boolean not null default false;
alter table public.tasks add column if not exists waiting_for text not null default '';
alter table public.projects add column if not exists archived boolean not null default false;

-- Historique des modifications des tâches (écrit uniquement par le serveur)
create table if not exists public.task_history (
  id          bigint generated always as identity primary key,
  task_id     text not null references public.tasks(id) on delete cascade,
  actor_email text not null default '',
  at          bigint not null default (extract(epoch from now()) * 1000)::bigint,
  field       text not null,
  old_value   text,
  new_value   text
);
create index if not exists task_history_task_idx on public.task_history(task_id);
alter table public.task_history enable row level security;
drop policy if exists history_select on public.task_history;
create policy history_select on public.task_history for select to authenticated
  using (public.can_access_task(task_id));
grant select on public.task_history to authenticated;
revoke all on public.task_history from anon;

create or replace function public.task_checklist_summary(c jsonb) returns text
language sql immutable set search_path = public as $$
  select case when c is null or jsonb_typeof(c) <> 'array' or jsonb_array_length(c) = 0 then ''
    else (select count(*) from jsonb_array_elements(c) e where (e->>'done') = 'true')::text || '/' || jsonb_array_length(c)::text end
$$;

create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := public.my_email();
  os text; ns text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_history(task_id, actor_email, field, new_value) values (new.id, who, 'created', new.title);
    return new;
  end if;
  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.task_history(task_id, actor_email, field) values (new.id, who, 'deleted');
  elsif old.deleted_at is not null and new.deleted_at is null then
    insert into public.task_history(task_id, actor_email, field) values (new.id, who, 'restored');
  end if;
  if new.title is distinct from old.title then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'title', old.title, new.title);
  end if;
  os := case when old.status = 'todo' and old.waiting then 'waiting' else old.status end;
  ns := case when new.status = 'todo' and new.waiting then 'waiting' else new.status end;
  if ns is distinct from os then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'status', os, ns);
  end if;
  if new.due is distinct from old.due then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'due', old.due::text, new.due::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'priority', old.priority, new.priority);
  end if;
  if new.who is distinct from old.who then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'who', old.who, new.who);
  end if;
  if new.project_id is distinct from old.project_id then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value)
    values (new.id, who, 'project', (select name from public.projects where id = old.project_id), (select name from public.projects where id = new.project_id));
  end if;
  if new.family is distinct from old.family then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value)
    values (new.id, who, 'family', (select name from public.project_families where id = old.family), (select name from public.project_families where id = new.family));
  end if;
  if new.waiting_for is distinct from old.waiting_for then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value) values (new.id, who, 'waitingFor', old.waiting_for, new.waiting_for);
  end if;
  if new.note is distinct from old.note then
    insert into public.task_history(task_id, actor_email, field) values (new.id, who, 'note');
  end if;
  if new.checklist is distinct from old.checklist then
    insert into public.task_history(task_id, actor_email, field, old_value, new_value)
    values (new.id, who, 'checklist', public.task_checklist_summary(old.checklist), public.task_checklist_summary(new.checklist));
  end if;
  return new;
end $$;
revoke execute on function public.log_task_change() from public, anon, authenticated;
drop trigger if exists tasks_history on public.tasks;
create trigger tasks_history after insert or update on public.tasks
  for each row execute function public.log_task_change();
