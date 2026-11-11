-- Migration 007 : pseudos anonymes pour tous les participants.
-- 1. Remplace tout pseudo existant par un pseudo de la forme « anonymeNNN ».
-- 2. Interdit, côté base, tout autre pseudo (même si un client modifié tentait d'en envoyer un).
update public.profiles
   set pseudo = 'anonyme' || (100 + floor(random() * 9900))::int
 where pseudo !~ '^anonyme[0-9]{3,6}$';

alter table public.profiles drop constraint if exists profiles_pseudo_anonyme;
alter table public.profiles add constraint profiles_pseudo_anonyme check (pseudo ~ '^anonyme[0-9]{3,6}$');

-- 3. Les métadonnées de compte ne contiennent plus de pseudo choisi (nettoyage des anciens comptes).
update auth.users
   set raw_user_meta_data = raw_user_meta_data - 'pseudo'
 where raw_user_meta_data ? 'pseudo'
   and coalesce(raw_user_meta_data->>'pseudo', '') !~ '^anonyme[0-9]{3,6}$';
