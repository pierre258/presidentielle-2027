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
