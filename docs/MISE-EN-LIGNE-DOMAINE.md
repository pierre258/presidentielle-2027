# Publier le site sur moyennedessondages2027.fr

Disponibilité vérifiée le 9 novembre 2026 auprès des registres officiels (AFNIC pour le .fr,
Verisign pour le .com) : `moyennedessondages2027.fr`, `moyennedessondages2027.com`,
`moyennedessondages.fr` et `moyennedessondages.com` étaient **libres**. À reconfirmer au moment
de l'achat.

Durée totale : environ 1 h de démarches, puis jusqu'à 24 h d'attente pour la propagation DNS.

---

## Étape 1 — Acheter le nom de domaine (vous, ~10 min)

1. Chez un registrar français : **OVHcloud**, **Gandi** ou **Infomaniak** (≈ 7 à 15 € / an pour
   un .fr, ≈ 12 à 18 € / an pour un .com).
2. Acheter **`moyennedessondages2027.fr`** (adresse principale).
3. Recommandé : acheter aussi **`moyennedessondages2027.com`** pour éviter qu'un tiers le prenne.
   En option, `moyennedessondages.fr` (sans 2027) pour réutiliser le site en 2032.
4. Ne prenez **aucune option d'hébergement web** : le site reste hébergé gratuitement par GitHub.
5. Activez la protection des données personnelles du titulaire (whois) si elle est proposée.

👉 Prévenez-moi une fois l'achat fait : je fais l'étape 3 et je vous guide pour l'étape 2.

## Étape 2 — Pointer le domaine vers GitHub (vous, dans l'espace client du registrar, ~10 min)

Dans la **zone DNS** du domaine `moyennedessondages2027.fr`, supprimez les enregistrements
`A` / `AAAA` créés par défaut (page « parking » du registrar), puis ajoutez :

| Type  | Nom (sous-domaine) | Valeur |
|-------|--------------------|--------|
| A     | (vide ou `@`)      | `185.199.108.153` |
| A     | (vide ou `@`)      | `185.199.109.153` |
| A     | (vide ou `@`)      | `185.199.110.153` |
| A     | (vide ou `@`)      | `185.199.111.153` |
| AAAA  | (vide ou `@`)      | `2606:50c0:8000::153` |
| AAAA  | (vide ou `@`)      | `2606:50c0:8001::153` |
| AAAA  | (vide ou `@`)      | `2606:50c0:8002::153` |
| AAAA  | (vide ou `@`)      | `2606:50c0:8003::153` |
| CNAME | `www`              | `pierre258.github.io.` |

Ce sont les adresses officielles de GitHub Pages.

Pour le `.com` : dans son propre espace, configurez une **redirection web permanente (301)**
vers `https://moyennedessondages2027.fr` (option « redirection » chez la plupart des registrars).

## Étape 3 — Brancher le site sur le domaine (moi, ~5 min)

- Ajout du fichier `CNAME` (contenu : `moyennedessondages2027.fr`) dans le dépôt.
- GitHub → Settings → Pages → **Custom domain** : `moyennedessondages2027.fr`, puis cocher
  **Enforce HTTPS** dès que GitHub a émis le certificat (quelques minutes à quelques heures).
- L'ancienne adresse `pierre258.github.io/presidentielle-2027` redirige alors automatiquement vers
  le nouveau domaine : les liens déjà partagés continuent de fonctionner.

⚠️ Je n'ajoute le fichier `CNAME` qu'**après** l'étape 2 : avant, il rendrait le site inaccessible.

## Étape 4 — Mettre à jour Supabase (moi)

- Authentication → URL Configuration → **Site URL** : `https://moyennedessondages2027.fr/`
- **Redirect URLs** : ajouter `https://moyennedessondages2027.fr/**` et
  `https://www.moyennedessondages2027.fr/**` (garder l'ancienne adresse quelques semaines).

## Étape 5 — Envoi des e-mails de confirmation (vous + moi, ~20 min) — indispensable avant le lancement

L'envoi intégré de Supabase est limité à **2 e-mails par heure** (non modifiable). Il faut un
service d'envoi. Recommandé : **Brevo** (français, gratuit jusqu'à 300 e-mails / jour).

Vous :
1. Créer un compte sur brevo.com (gratuit).
2. Brevo → *Expéditeurs, domaines et IP dédiées* → **Domaines** → ajouter
   `moyennedessondages2027.fr`. Brevo affiche 3 ou 4 enregistrements **TXT** (code Brevo, DKIM,
   DMARC) : les copier dans la zone DNS du registrar, puis cliquer « Authentifier ».
3. Brevo → *SMTP & API* → **Générer une clé SMTP**. Notez : serveur `smtp-relay.brevo.com`,
   port `587`, identifiant (affiché par Brevo) et la clé.

Vous, dans Supabase (je ne saisis jamais de mot de passe ni de clé) :
4. Authentication → Emails → **SMTP Settings** → activer *Custom SMTP* :
   - Sender email : `noreply@moyennedessondages2027.fr`
   - Sender name : `La moyenne des sondages 2027`
   - Host : `smtp-relay.brevo.com` · Port : `587`
   - Username / Password : l'identifiant et la clé SMTP de Brevo
5. Authentication → Rate Limits → **Emails / heure** : passer à `100` (ou plus).

Moi :
6. Modèle d'e-mail de confirmation en français (Authentication → Emails → Templates →
   *Confirm signup*) :

   > **Objet :** Confirmez votre inscription — La moyenne des sondages 2027
   >
   > Bonjour,
   >
   > Merci de votre inscription au « Petit vote entre amis ». Pour que votre portrait et votre vote
   > soient comptés, confirmez votre adresse e-mail en cliquant sur le lien ci-dessous :
   >
   > `<a href="{{ .ConfirmationURL }}">Confirmer mon adresse</a>`
   >
   > Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet e-mail.
   >
   > — L'équipe de moyennedessondages2027.fr

7. Test complet : inscription → e-mail reçu (et pas en spam) → lien → retour sur le site.

## Étape 6 — Avant de communiquer largement (recommandé)

- **Mentions légales et RGPD** : les opinions politiques sont des données sensibles. Il faut une
  page « Confidentialité » (données collectées, finalité, durée de conservation, hébergeurs :
  GitHub, Supabase en Europe, Brevo), une case de consentement explicite à l'inscription et un
  bouton « Supprimer mon compte ». Je peux les préparer.
- **Sondages — loi du 19 juillet 1977** : le site publie des moyennes de sondages réalisés par
  des instituts ; le « Petit vote entre amis » n'est **pas un sondage** (échantillon non
  représentatif), ce que le site indique déjà. Attention à la période de réserve : aucune
  publication de sondage la veille et le jour du scrutin (samedi 17 et dimanche 18 avril 2027).
- **Anti-robots** (optionnel) : activer un CAPTCHA Cloudflare Turnstile dans Supabase
  (Authentication → Attack Protection) si des inscriptions automatisées apparaissent.

## Récapitulatif des coûts

| Poste | Coût |
|-------|------|
| `moyennedessondages2027.fr` | ≈ 7–15 € / an |
| `moyennedessondages2027.com` (redirection) | ≈ 12–18 € / an |
| Hébergement (GitHub Pages) | gratuit |
| Base de données et comptes (Supabase, offre gratuite) | gratuit |
| E-mails (Brevo, ≤ 300 / jour) | gratuit |
| Données réseaux sociaux (Apify) | quelques € / mois |
