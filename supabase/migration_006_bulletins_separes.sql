-- Migration 006 : bulletins séparés, consentement dédié, anti-fraude, réserve électorale, purge.
--
-- 1. Les réponses et le vote quittent la table des profils pour une table « ballots » distincte.
--    Un bulletin n'est relié à son compte que par une empreinte HMAC-SHA256 de l'identifiant,
--    calculée avec une clé secrète conservée dans Supabase Vault (chiffrée). Ni l'e-mail ni
--    l'identifiant du compte ne figurent dans la table des bulletins.
-- 2. La table des bulletins n'est lisible par aucun utilisateur : tout passe par des fonctions
--    qui ne renvoient jamais d'e-mail (pseudo dans un groupe, lignes anonymes en global).
-- 3. Consentement explicite et dédié obligatoire pour enregistrer un bulletin (horodaté).
-- 4. Anti-fraude : un bulletin par compte, 5 modifications par jour au plus, adhésions et
--    créations de groupes limitées, comptes en double (même adresse avec « + » ou points Gmail)
--    non comptés, adresses jetables et relais d'alias non comptés.
-- 5. Réserve électorale : aucun enregistrement ni résultat la veille et le jour de chaque tour
--    jusqu'à 20 h (heure de Paris).
-- 6. Purge : le 9 mai 2027, seuls les totaux nationaux par candidat sont archivés, tous les
--    bulletins sont supprimés.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Clé secrète de hachage (Supabase Vault, chiffrée au repos) ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ballot_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ballot_pepper',
                                'Clé HMAC reliant un bulletin à son compte (ne jamais divulguer)');
  end if;
end $$;

create or replace function public.ballot_key(p_user uuid)
returns text
language sql security definer set search_path = public, extensions, vault stable as $$
  select encode(extensions.hmac(p_user::text,
                (select decrypted_secret from vault.decrypted_secrets where name = 'ballot_pepper'), 'sha256'), 'hex');
$$;
revoke all on function public.ballot_key(uuid) from public, anon, authenticated;

-- ---------- Table des bulletins ----------
create table if not exists public.ballots (
  key text primary key,                       -- HMAC de l'identifiant du compte (jamais l'identifiant lui-même)
  answers jsonb,
  axes jsonb,
  top_candidate text,
  top_pct int,
  chosen_candidate text,
  consent_at timestamptz not null,            -- consentement explicite au traitement de l'opinion politique
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edits_day date not null default current_date,
  edits_today int not null default 1
);
alter table public.ballots enable row level security;            -- aucune politique : illisible via l'API
revoke all on public.ballots from anon, authenticated;

-- Reprise des portraits déjà enregistrés (consentement = date de validation, via la case cochée à l'inscription)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'answers') then
    insert into public.ballots (key, answers, axes, top_candidate, top_pct, chosen_candidate, consent_at, completed_at)
      select public.ballot_key(p.id), p.answers, p.axes, p.top_candidate, p.top_pct, p.chosen_candidate, p.completed_at, p.completed_at
      from public.profiles p where p.completed_at is not null
    on conflict (key) do nothing;
    alter table public.profiles drop column answers, drop column axes, drop column top_candidate,
                                drop column top_pct, drop column chosen_candidate, drop column completed_at;
  end if;
end $$;

-- ---------- Réserve électorale ----------
create or replace function public.in_freeze()
returns boolean
language sql stable as $$
  select (now() at time zone 'Europe/Paris') >= timestamp '2027-04-17 00:00' and (now() at time zone 'Europe/Paris') < timestamp '2027-04-18 20:00'
      or (now() at time zone 'Europe/Paris') >= timestamp '2027-05-01 00:00' and (now() at time zone 'Europe/Paris') < timestamp '2027-05-02 20:00';
$$;
grant execute on function public.in_freeze() to anon, authenticated;

-- ---------- Comptes en double et adresses non comptées ----------
create or replace function public.email_norm(e text)
returns text
language sql immutable as $$
  select case when d in ('gmail.com', 'googlemail.com') then replace(l, '.', '') || '@gmail.com' else l || '@' || d end
  from (select split_part(split_part(lower(e), '@', 1), '+', 1) as l, split_part(lower(e), '@', 2) as d) x;
$$;
revoke all on function public.email_norm(text) from public, anon, authenticated;

insert into public.disposable_domains (domain) values
  -- relais d'alias illimités (création de comptes multiples)
  ('simplelogin.com'),('simplelogin.fr'),('aleeas.com'),('slmail.me'),('8alias.com'),('8shield.net'),('anonaddy.com'),('anonaddy.me'),('addy.io'),
  ('duck.com'),('mozmail.com'),('relay.firefox.com'),('33mail.net'),('erine.email'),('spamgourmet.net'),('spamgourmet.org'),
  -- Proton (à la demande de l'éditeur : adresses créées sans vérification d'identité)
  ('proton.me'),('protonmail.com'),('protonmail.ch'),('pm.me'),
  -- jetables supplémentaires
  ('guerrillamail.de'),('guerrillamail.biz'),('yopmail.org'),('mailinator.org'),('mailinator2.com'),('temp-mail.net'),('tempmail.plus'),
  ('tempmailaddress.com'),('tempmail.email'),('tempemail.co'),('temporarymail.com'),('throwam.com'),('mailnull.com'),('mailtothis.com'),
  ('trbvm.com'),('getairmail.com'),('emailnax.com'),('mailbox92.biz'),('cuvox.de'),('dayrep.com'),('einrot.de'),('fleckens.hu'),
  ('gustr.com'),('jourrapide.com'),('rhyta.com'),('superrito.com'),('teleworm.us'),('armyspy.com'),('linshiyouxiang.net'),('chacuo.net'),
  ('mail.tm'),('mailgun.io'),('inbox.lv'),('fexbox.org'),('fexpost.com'),('rover.info'),('tuta.io')
on conflict do nothing;

-- Un compte est compté si : e-mail confirmé, adresse non jetable, ancienneté suffisante, et premier
-- compte pour cette adresse normalisée (x+1@gmail.com, x.y@gmail.com… ne comptent qu'une fois)
create or replace function public.is_trusted(p_user uuid)
returns boolean
language sql security definer set search_path = public, auth stable as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user
      and u.email_confirmed_at is not null
      and lower(split_part(u.email, '@', 2)) not in (select domain from public.disposable_domains)
      and u.created_at <= now() - make_interval(days => (select min_account_days from public.app_settings))
      and not exists (select 1 from auth.users o
                      where o.id <> u.id and o.created_at < u.created_at
                        and public.email_norm(o.email) = public.email_norm(u.email))
  );
$$;
revoke all on function public.is_trusted(uuid) from public, anon, authenticated;

-- ---------- Bulletin du compte connecté ----------
create or replace function public.my_ballot()
returns table (answers jsonb, axes jsonb, top_candidate text, top_pct int, chosen_candidate text,
               completed_at timestamptz, consent_at timestamptz)
language sql security definer set search_path = public stable as $$
  select b.answers, b.axes, b.top_candidate, b.top_pct, b.chosen_candidate, b.completed_at, b.consent_at
  from ballots b where auth.uid() is not null and b.key = public.ballot_key(auth.uid());
$$;

create or replace function public.save_ballot(p_answers jsonb, p_axes jsonb, p_top text, p_pct int, p_chosen text, p_consent boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare k text; b ballots%rowtype;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if public.in_freeze() then raise exception 'réserve électorale : enregistrement suspendu jusqu''à la fermeture des bureaux de vote'; end if;
  if p_consent is not true then raise exception 'consentement requis'; end if;
  if p_chosen is null or char_length(p_chosen) > 40 or char_length(coalesce(p_top, '')) > 40 then raise exception 'choix invalide'; end if;
  k := public.ballot_key(auth.uid());
  select * into b from ballots where key = k;
  if found then
    if b.edits_day = current_date and b.edits_today >= 5 then
      raise exception 'trop de modifications aujourd''hui : réessayez demain';
    end if;
    update ballots set answers = p_answers, axes = p_axes, top_candidate = p_top, top_pct = p_pct,
                       chosen_candidate = p_chosen, consent_at = now(), updated_at = now(),
                       edits_today = case when edits_day = current_date then edits_today + 1 else 1 end,
                       edits_day = current_date
      where key = k;
  else
    insert into ballots (key, answers, axes, top_candidate, top_pct, chosen_candidate, consent_at)
      values (k, p_answers, p_axes, p_top, p_pct, p_chosen, now());
  end if;
end $$;

create or replace function public.delete_my_ballot()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  delete from ballots where key = public.ballot_key(auth.uid());
end $$;

-- ---------- Résultats (jamais d'e-mail ; seuls les comptes fiables) ----------
create or replace function public.group_results(p_group uuid)
returns table (pseudo text, chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb,
               completed boolean, joined_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if public.in_freeze() then raise exception 'réserve électorale : résultats masqués jusqu''à 20 h'; end if;
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then
    if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then
      raise exception 'accès réservé aux membres du groupe';
    end if;
    if not exists (select 1 from ballots where key = public.ballot_key(auth.uid())) then
      raise exception 'portrait requis';
    end if;
  end if;
  return query
    select p.pseudo, b.chosen_candidate, b.top_candidate, b.top_pct, b.axes, b.answers, b.key is not null, m.joined_at
    from group_members m
    join profiles p on p.id = m.user_id
    left join ballots b on b.key = public.ballot_key(m.user_id)
    where m.group_id = p_group and public.is_trusted(m.user_id)
    order by m.joined_at;
end $$;

create or replace function public.global_results()
returns table (chosen_candidate text, top_candidate text, top_pct int, axes jsonb, answers jsonb, users int, groups int)
language plpgsql security definer set search_path = public, auth stable as $$
begin
  if public.in_freeze() then raise exception 'réserve électorale : résultats masqués jusqu''à 20 h'; end if;
  if not exists (select 1 from ballots where key = public.ballot_key(auth.uid())) then
    raise exception 'portrait requis';
  end if;
  return query
    with ok as (select b.* from auth.users u join ballots b on b.key = public.ballot_key(u.id)
                where b.chosen_candidate is not null and public.is_trusted(u.id))
    select ok.chosen_candidate, ok.top_candidate, ok.top_pct, ok.axes, ok.answers,
           (select count(*)::int from ok), (select count(*)::int from groups)
    from ok order by random();
end $$;

-- ---------- Limites d'usage (anti-campagnes coordonnées) ----------
create or replace function public.join_group(p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare g groups%rowtype;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if (select count(*) from group_members where user_id = auth.uid() and joined_at > now() - interval '1 day') >= 20 then
    raise exception 'trop de groupes rejoints aujourd''hui';
  end if;
  select * into g from groups where code = p_code;
  if not found then raise exception 'lien invalide'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g.name;
end $$;

create or replace function public.limit_group_creation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from groups where owner = new.owner and created_at > now() - interval '1 day') >= 10 then
    raise exception 'trop de groupes créés aujourd''hui';
  end if;
  return new;
end $$;
drop trigger if exists limit_group_creation on public.groups;
create trigger limit_group_creation before insert on public.groups for each row execute function public.limit_group_creation();

-- ---------- Suppression du compte : le bulletin part aussi ----------
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  delete from public.ballots where key = public.ballot_key(auth.uid());
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Purge après l'élection : seuls les totaux nationaux sont conservés ----------
create table if not exists public.results_archive (
  id bigserial primary key,
  election text not null,
  candidate text,
  votes int not null,
  archived_at timestamptz not null default now()
);
alter table public.results_archive enable row level security;
revoke all on public.results_archive from anon, authenticated;

create or replace function public.purge_ballots()
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if now() < timestamptz '2027-05-09 00:00+02' then raise exception 'purge prévue le 9 mai 2027'; end if;
  insert into results_archive (election, candidate, votes)
    select 'presidentielle-2027', b.chosen_candidate, count(*)::int
    from auth.users u join ballots b on b.key = public.ballot_key(u.id)
    where b.chosen_candidate is not null and public.is_trusted(u.id)
    group by b.chosen_candidate;
  delete from ballots;
end $$;
revoke all on function public.purge_ballots() from public, anon, authenticated;

-- ---------- Droits ----------
revoke all on function public.my_ballot() from public, anon;
revoke all on function public.save_ballot(jsonb, jsonb, text, int, text, boolean) from public, anon;
revoke all on function public.delete_my_ballot() from public, anon;
revoke all on function public.group_results(uuid) from public, anon;
revoke all on function public.global_results() from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.my_ballot() to authenticated;
grant execute on function public.save_ballot(jsonb, jsonb, text, int, text, boolean) to authenticated;
grant execute on function public.delete_my_ballot() to authenticated;
grant execute on function public.group_results(uuid) to authenticated;
grant execute on function public.global_results() to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Purge planifiée (pg_cron), exécutée séparément le 10 novembre 2026 :
-- create extension if not exists pg_cron with schema pg_catalog;
-- select cron.schedule('purge-bulletins-2027', '0 3 9 5 *', $$select public.purge_ballots()$$);
