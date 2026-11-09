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
