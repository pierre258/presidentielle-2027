/* Configuration de la rubrique « Petit vote entre amis » (comptes et groupes).
   Renseigner l'URL du projet Supabase et sa clé publique « anon » (Project Settings → API).
   La clé anon est faite pour être publique : la sécurité repose sur les règles du fichier
   supabase/schema.sql. Ne JAMAIS mettre ici la clé « service_role ». */
/* Identifiant de lecteur Dailymotion (Player ID, ex. "x1ab2"), créé gratuitement dans Dailymotion Studio →
   Lecteurs. Indispensable pour intégrer les vidéos Dailymotion et le direct de Public Sénat. Vide : le direct
   s'ouvre sur publicsenat.fr et les vidéos Dailymotion de Buzz renvoient vers dailymotion.com. */
window.DM_PLAYER = "";

window.FUN_CONFIG = {
  supabaseUrl: "https://arrldxzqslcmyobcrlzc.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFycmxkeHpxc2xjbXlvYmNybHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMjYyOTYsImV4cCI6MjEwOTgwMjI5Nn0.lE9bJB5WwR5u72VYhPThqOCdrMtMkksp3dQQeybyboo",
};
