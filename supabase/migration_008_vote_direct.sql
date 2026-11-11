-- Migration 008 : vote direct depuis un lien de groupe, sans questionnaire.
--
-- 1. Un invité choisit son candidat puis crée son compte : le vote est enregistré dès l'inscription,
--    AVANT la confirmation de l'adresse e-mail (déclencheur sur auth.users). Le choix transmis à
--    l'inscription est aussitôt effacé des métadonnées du compte : il n'est conservé que dans la
--    table des bulletins, reliée au compte par l'empreinte HMAC (jamais par l'e-mail).
-- 2. Résultats d'un groupe : les votes des adresses non encore confirmées sont comptés
--    (les adresses jetables et les comptes en double restent exclus).
-- 3. « Le vote des participants » (tous groupes confondus) : inchangé, seuls les comptes à
--    l'adresse e-mail confirmée sont comptés (is_trusted).
-- 4. Un bulletin peut ne contenir que le choix du candidat (questionnaire facultatif).

-- ---------- Compté dans un groupe : adresse non jetable et premier compte pour cette adresse ----------
create or replace function public.is_group_counted(p_user uuid)
returns boolean
language sql security definer set search_path = public, auth stable as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user
      and lower(split_part(u.email, '@', 2)) not in (select domain from public.disposable_domains)
      and not exists (select 1 from auth.users o
                      where o.id <> u.id and o.created_at < u.created_at
                        and public.email_norm(o.email) = public.email_norm(u.email))
  );
$$;
revoke all on function public.is_group_counted(uuid) from public, anon, authenticated;

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
      raise exception 'vote requis';
    end if;
  end if;
  return query
    select p.pseudo, b.chosen_candidate, b.top_candidate, b.top_pct, b.axes, b.answers, b.key is not null, m.joined_at
    from group_members m
    join profiles p on p.id = m.user_id
    left join ballots b on b.key = public.ballot_key(m.user_id)
    where m.group_id = p_group and public.is_group_counted(m.user_id)
    order by m.joined_at;
end $$;
revoke all on function public.group_results(uuid) from public, anon;
grant execute on function public.group_results(uuid) to authenticated;

-- ---------- Vote transmis à l'inscription ----------
-- Métadonnées attendues : pending_vote (identifiant du candidat, « indecis » ou « blanc »),
-- vote_consent = true (consentement explicite au traitement de l'opinion politique), pending_group (code du lien).
create or replace function public.vote_at_signup()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v text := new.raw_user_meta_data ->> 'pending_vote';
  c text := new.raw_user_meta_data ->> 'pending_group';
  ps text := new.raw_user_meta_data ->> 'pseudo';
  gid uuid;
begin
  if v is null then return new; end if;
  -- le choix ne reste jamais dans les métadonnées du compte (reliées à l'e-mail)
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'pending_vote' - 'vote_consent' where id = new.id;
  if (new.raw_user_meta_data ->> 'vote_consent') is distinct from 'true'
     or v !~ '^[a-z0-9_-]{2,40}$' or public.in_freeze() then
    return new;
  end if;
  begin -- bloc protégé : une erreur annule le vote, jamais l'inscription ni l'effacement ci-dessus
  if ps is null or ps !~ '^anonyme[0-9]{3,6}$' then
    ps := 'anonyme' || (100 + floor(random() * 9900))::int;
  end if;
  insert into public.profiles (id, pseudo) values (new.id, ps) on conflict (id) do nothing;
  insert into public.ballots (key, chosen_candidate, consent_at)
    values (public.ballot_key(new.id), v, now()) on conflict (key) do nothing;
  if c is not null then
    select id into gid from public.groups where code = c;
    if gid is not null then
      insert into public.group_members (group_id, user_id) values (gid, new.id) on conflict do nothing;
    end if;
  end if;
  exception when others then null;
  end;
  return new;
end $$;
revoke all on function public.vote_at_signup() from public, anon, authenticated;

drop trigger if exists vote_at_signup on auth.users;
create trigger vote_at_signup after insert on auth.users
  for each row execute function public.vote_at_signup();
