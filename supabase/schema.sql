-- Rubrique « Fun » : comptes, portraits idéologiques et groupes partagés par lien.
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run.
-- Confidentialité : un utilisateur ne voit que son propre profil ; le créateur d'un lien et
-- les membres ayant validé leur portrait voient, pour leur groupe, les pseudos, le candidat
-- choisi et les réponses au quiz (jamais les e-mails).

-- 1. Profils (un par compte)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  pseudo text not null check (char_length(pseudo) between 2 and 30),
  answers jsonb,               -- réponses au quiz {question_id: -2..2}
  axes jsonb,                  -- position sur les 5 axes {-1..1}
  top_candidate text,          -- candidat le plus proche selon le quiz
  top_pct int,
  chosen_candidate text,       -- candidat choisi par l'utilisateur (« indecis » possible)
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2. Groupes (un lien de partage = un groupe)
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_at timestamptz not null default now()
);

-- 3. Membres d'un groupe (personnes arrivées par le lien)
create table if not exists public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Profils : chacun lit et modifie uniquement le sien
drop policy if exists "profil: lecture perso" on public.profiles;
create policy "profil: lecture perso" on public.profiles for select using (id = auth.uid());
drop policy if exists "profil: création perso" on public.profiles;
create policy "profil: création perso" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profil: mise à jour perso" on public.profiles;
create policy "profil: mise à jour perso" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Groupes : le créateur voit, crée et supprime les siens
drop policy if exists "groupe: lecture créateur" on public.groups;
create policy "groupe: lecture créateur" on public.groups for select using (owner = auth.uid());
drop policy if exists "groupe: création" on public.groups;
create policy "groupe: création" on public.groups for insert with check (owner = auth.uid());
drop policy if exists "groupe: suppression créateur" on public.groups;
create policy "groupe: suppression créateur" on public.groups for delete using (owner = auth.uid());

-- Membres : on voit ses propres adhésions ; on peut quitter un groupe
drop policy if exists "membre: lecture perso" on public.group_members;
create policy "membre: lecture perso" on public.group_members for select using (user_id = auth.uid());
drop policy if exists "membre: quitter" on public.group_members;
create policy "membre: quitter" on public.group_members for delete using (user_id = auth.uid());

-- Fonction publique : infos d'invitation à partir du code du lien (nom du groupe + pseudo du créateur)
create or replace function public.group_invite(p_code text)
returns table (name text, owner_pseudo text)
language sql security definer set search_path = public stable as $$
  select g.name, coalesce(p.pseudo, 'Un utilisateur')
  from groups g left join profiles p on p.id = g.owner
  where g.code = p_code;
$$;

-- Rejoindre un groupe à partir du code (utilisateur connecté)
create or replace function public.join_group(p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare g groups%rowtype;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select * into g from groups where code = p_code;
  if not found then raise exception 'lien invalide'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g.name;
end $$;

-- Groupes rejoints : on renvoie aussi l'identifiant et le rôle
drop function if exists public.my_joined_groups();
create function public.my_joined_groups()
returns table (group_id uuid, name text, owner_pseudo text, is_owner boolean, members int, joined_at timestamptz)
language sql security definer set search_path = public stable as $$
  select g.id, g.name, coalesce(p.pseudo, '?'), g.owner = auth.uid(),
         (select count(*)::int from group_members x where x.group_id = g.id), m.joined_at
  from group_members m join groups g on g.id = m.group_id left join profiles p on p.id = g.owner
  where m.user_id = auth.uid() order by m.joined_at desc;
$$;

-- Résultats : créateur, ou membre ayant validé son portrait ; jamais d'e-mail
create or replace function public.group_results(p_group uuid)
returns table (pseudo text, chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb,
               completed boolean, joined_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then
    if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then
      raise exception 'accès réservé aux membres du groupe';
    end if;
    if not exists (select 1 from profiles where id = auth.uid() and completed_at is not null) then
      raise exception 'portrait requis';
    end if;
  end if;
  return query
    select p.pseudo, p.chosen_candidate, p.top_candidate, p.top_pct, p.axes, p.answers,
           p.completed_at is not null, m.joined_at
    from group_members m join profiles p on p.id = m.user_id
    where m.group_id = p_group
    order by m.joined_at;
end $$;

revoke all on function public.group_results(uuid) from public;
grant execute on function public.group_invite(text) to anon, authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.my_joined_groups() to authenticated;
grant execute on function public.group_results(uuid) to authenticated;

-- Migration 003 : résultats « Tous les groupes » = tous les utilisateurs ayant validé leur
-- portrait et choisi un candidat. Anonyme : aucun pseudo ni e-mail n'est renvoyé.
-- Accessible aux utilisateurs connectés ayant eux-mêmes validé leur portrait.

create or replace function public.global_results()
returns table (chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb,
               users int, groups int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and completed_at is not null) then
    raise exception 'portrait requis';
  end if;
  return query
    select p.chosen_candidate, p.top_candidate, p.top_pct, p.axes, p.answers,
           (select count(*)::int from profiles x where x.completed_at is not null and x.chosen_candidate is not null),
           (select count(*)::int from groups)
    from profiles p
    where p.completed_at is not null and p.chosen_candidate is not null
    order by random();  -- ordre aléatoire : impossible de relier une ligne à une inscription
end $$;

revoke all on function public.global_results() from public;
grant execute on function public.global_results() to authenticated;

-- Migration 004 : sécurité et fiabilité des votes.
--  • Ne comptent que les comptes dont l'e-mail est CONFIRMÉ (lien reçu par e-mail).
--  • Les adresses jetables (yopmail, mailinator…) ne sont jamais comptées.
--  • Ancienneté minimale du compte réglable (app_settings.min_account_days, 0 par défaut).
--  • Fonctions non exécutables par les visiteurs anonymes.
-- Les e-mails restent uniquement dans auth.users (géré par Supabase, inaccessible par l'API
-- publique) : aucune table ni fonction de l'application ne les expose.

-- Réglages (une seule ligne, lisible uniquement par les fonctions internes)
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  min_account_days int not null default 0 check (min_account_days between 0 and 365)
);
insert into public.app_settings (id) values (true) on conflict do nothing;
alter table public.app_settings enable row level security;   -- aucune politique : invisible via l'API

-- Domaines d'adresses jetables (liste éditable)
create table if not exists public.disposable_domains (domain text primary key);
alter table public.disposable_domains enable row level security;   -- invisible via l'API
insert into public.disposable_domains (domain) values
  ('yopmail.com'),('yopmail.fr'),('yopmail.net'),('cool.fr.nf'),('jetable.fr.nf'),('courriel.fr.nf'),('moncourrier.fr.nf'),
  ('mailinator.com'),('mailinator.net'),('guerrillamail.com'),('guerrillamail.info'),('guerrillamail.net'),('guerrillamail.org'),
  ('guerrillamailblock.com'),('sharklasers.com'),('grr.la'),('pokemail.net'),('spam4.me'),('10minutemail.com'),('10minutemail.net'),
  ('10minutemail.co.uk'),('temp-mail.org'),('temp-mail.io'),('tempmail.com'),('tempmail.net'),('tempmail.dev'),('tempmailo.com'),
  ('tempail.com'),('tempinbox.com'),('tempr.email'),('trashmail.com'),('trashmail.de'),('trashmail.net'),('trashmail.io'),
  ('throwawaymail.com'),('getnada.com'),('nada.email'),('maildrop.cc'),('dispostable.com'),('fakeinbox.com'),('mintemail.com'),
  ('mytemp.email'),('moakt.com'),('emailondeck.com'),('mohmal.com'),('burnermail.io'),('spamgourmet.com'),('mailnesia.com'),
  ('mailcatch.com'),('jetable.org'),('mail-temporaire.fr'),('mail-temporaire.com'),('tmail.ws'),('tmpmail.org'),('tmpmail.net'),
  ('minuteinbox.com'),('emailfake.com'),('crazymailing.com'),('inboxkitten.com'),('mailpoof.com'),('discard.email'),
  ('33mail.com'),('spambox.us'),('mailtemp.info'),('emailtemporanea.net'),('fakemail.net'),('mailforspam.com'),('mvrht.net'),
  ('owlymail.com'),('byom.de'),('wegwerfmail.de'),('einrot.com'),('dropmail.me'),('10mail.org'),('emltmp.com'),('tmpeml.com'),
  ('tmpbox.net'),('laafd.com'),('dcctb.com'),('rteet.com'),('vjuum.com'),('ezztt.com'),('mailbox.in.ua'),('yomail.info'),
  ('anonbox.net'),('mail7.io'),('harakirimail.com'),('mailsac.com'),('mailexpire.com'),('incognitomail.org'),('spamex.com')
on conflict do nothing;

-- Un compte est « fiable » si : e-mail confirmé, adresse non jetable, ancienneté suffisante
create or replace function public.is_trusted(p_user uuid)
returns boolean
language sql security definer set search_path = public, auth stable as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user
      and u.email_confirmed_at is not null
      and lower(split_part(u.email, '@', 2)) not in (select domain from public.disposable_domains)
      and u.created_at <= now() - make_interval(days => (select min_account_days from public.app_settings))
  );
$$;
revoke all on function public.is_trusted(uuid) from public, anon, authenticated;  -- usage interne uniquement

-- Statut du compte connecté (pour l'affichage : « votre vote sera compté le … »)
create or replace function public.my_status()
returns table (email_confirmed boolean, disposable boolean, counted boolean, counted_from timestamptz)
language sql security definer set search_path = public, auth stable as $$
  select u.email_confirmed_at is not null,
         lower(split_part(u.email, '@', 2)) in (select domain from public.disposable_domains),
         public.is_trusted(u.id),
         u.created_at + make_interval(days => (select min_account_days from public.app_settings))
  from auth.users u where u.id = auth.uid();
$$;

-- Résultats d'un groupe : seuls les comptes fiables sont comptés
create or replace function public.group_results(p_group uuid)
returns table (pseudo text, chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb,
               completed boolean, joined_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then
    if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then
      raise exception 'accès réservé aux membres du groupe';
    end if;
    if not exists (select 1 from profiles where id = auth.uid() and completed_at is not null) then
      raise exception 'portrait requis';
    end if;
  end if;
  return query
    select p.pseudo, p.chosen_candidate, p.top_candidate, p.top_pct, p.axes, p.answers,
           p.completed_at is not null, m.joined_at
    from group_members m join profiles p on p.id = m.user_id
    where m.group_id = p_group and public.is_trusted(p.id)
    order by m.joined_at;
end $$;

-- Résultats globaux : seuls les comptes fiables sont comptés (anonyme, sans pseudo)
create or replace function public.global_results()
returns table (chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb,
               users int, groups int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and completed_at is not null) then
    raise exception 'portrait requis';
  end if;
  return query
    with ok as (select p.* from profiles p
                where p.completed_at is not null and p.chosen_candidate is not null and public.is_trusted(p.id))
    select ok.chosen_candidate, ok.top_candidate, ok.top_pct, ok.axes, ok.answers,
           (select count(*)::int from ok), (select count(*)::int from groups)
    from ok order by random();
end $$;

-- Aucune fonction n'est exécutable par les visiteurs non connectés, sauf l'invitation
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.my_joined_groups() from public, anon;
revoke all on function public.group_results(uuid) from public, anon;
revoke all on function public.global_results() from public, anon;
revoke all on function public.my_status() from public, anon;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.my_joined_groups() to authenticated;
grant execute on function public.group_results(uuid) to authenticated;
grant execute on function public.global_results() to authenticated;
grant execute on function public.my_status() to authenticated;
grant execute on function public.group_invite(text) to anon, authenticated;
