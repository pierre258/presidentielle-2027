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
