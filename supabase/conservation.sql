-- To do projets : durées de conservation des données (RGPD)
-- À exécuter une fois dans Supabase > SQL Editor (le script crée la règle et la programme chaque nuit à 3 h 30 UTC).
--  * corbeille : 30 jours (tâches, demandes client, points ouverts, comptes rendus)
--  * contacts clients d'un projet archivé : 6 mois après l'archivage
--  * sauvegardes hebdomadaires : 12 semaines
create or replace function backup.apply_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  lim_trash bigint := ((extract(epoch from now()) - 30*86400) * 1000)::bigint;
  lim_arch  bigint := ((extract(epoch from now()) - 182*86400) * 1000)::bigint;
  n_t int; n_r int; n_o int; n_m int; n_c int; n_s int;
begin
  delete from public.tasks where deleted_at is not null and deleted_at < lim_trash; get diagnostics n_t = row_count;
  delete from public.client_requests where deleted_at is not null and deleted_at < lim_trash; get diagnostics n_r = row_count;
  delete from public.open_points where deleted_at is not null and deleted_at < lim_trash; get diagnostics n_o = row_count;
  delete from public.meetings where deleted_at is not null and deleted_at < lim_trash; get diagnostics n_m = row_count;
  delete from public.project_contacts c using public.projects p
    where c.project_id = p.id and p.archived and p.archived_at is not null and p.archived_at < lim_arch; get diagnostics n_c = row_count;
  delete from backup.snapshots where taken_at < now() - interval '12 weeks'; get diagnostics n_s = row_count;
  return jsonb_build_object('tasks',n_t,'requests',n_r,'points',n_o,'meetings',n_m,'contacts',n_c,'snapshots',n_s);
end $$;
revoke all on function backup.apply_retention() from public, anon, authenticated;
select cron.schedule('todo-projets-conservation', '30 3 * * *', 'select backup.apply_retention()');
-- Vérification : select backup.apply_retention();  (renvoie le nombre d'éléments effacés)

-- Droit à l'effacement : un utilisateur connecté peut supprimer son propre compte depuis l'appli
-- (« Données et confidentialité » puis « Supprimer mon compte »). Ses projets sont supprimés avec leur contenu
-- (y compris pour les personnes avec qui ils étaient partagés) ; il est retiré des projets partagés avec lui.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if uid is null then raise exception 'Non connecté'; end if;
  delete from public.project_members where email = mail;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
