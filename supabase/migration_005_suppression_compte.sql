-- Migration 005 : « Supprimer mon compte » (droit à l'effacement, RGPD art. 17)
-- Supprime l'utilisateur connecté. Les tables profiles, groups et group_members
-- sont liées à auth.users avec « on delete cascade » : profil, portrait, vote,
-- groupes créés (et leurs membres) et adhésions disparaissent avec lui.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
