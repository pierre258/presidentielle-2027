-- Migration 002 : les membres d'un groupe voient aussi ses résultats (pseudos uniquement),
-- une fois leur propre portrait validé. Le créateur devient membre de ses groupes.
-- À exécuter dans Supabase → SQL Editor (sans risque si exécutée plusieurs fois).

-- Le créateur fait partie de ses propres groupes (groupes existants)
insert into public.group_members (group_id, user_id)
select id, owner from public.groups
on conflict do nothing;

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
grant execute on function public.my_joined_groups() to authenticated;
grant execute on function public.group_results(uuid) to authenticated;
