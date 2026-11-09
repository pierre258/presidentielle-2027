# Présidentielle 2027 — Le Tracker

Site statique (HTML/CSS/JS, sans build) + scripts Python (bibliothèque standard uniquement)
qui régénèrent les données plusieurs fois par jour via GitHub Actions.

## Rubriques
| Rubrique | Source | Fichier |
|---|---|---|
| Sondages, moyenne sur 7/14/30 j + courbe d'évolution | Page Wikipédia « Liste de sondages… 2027 » | `data/polls.json` |
| Réseaux sociaux (course animée sur 10 s, filtres réseau/période) | API YouTube + acteurs Apify (X, Instagram, TikTok, Facebook) | `data/social.json` |
| Bad buzz / bons buzz des 7 derniers jours (vidéos YouTube intégrées) | Google Actualités RSS + recherche YouTube, classés par Claude | `data/buzz.json` |
| Programmes + comparateur à 2 candidats | Rédigés à la main | `data/programmes.json` |
| Photos | Wikimedia Commons (API Wikipédia) | `data/photos.json` |

`data/candidates.json` est le fichier maître : ajouter un candidat = ajouter une entrée
(nom, couleur, page Wikipédia, libellés de sondage, identifiants réseaux sociaux).

## Lancer en local
```bash
python3 -m http.server 8765
```
puis ouvrir http://localhost:8765. Mettre à jour les données à la main :
```bash
python3 scripts/update_polls.py && python3 scripts/update_photos.py && python3 scripts/update_buzz.py
```

## Mise en ligne (GitHub Pages, gratuit)
1. Créer un dépôt GitHub et y pousser ce dossier.
2. Settings → Pages → « Deploy from a branch » → `main` / racine.
3. Settings → Secrets and variables → Actions → ajouter :
   - `ANTHROPIC_API_KEY` : classement intelligent des buzz (sinon : mots-clés, moins fiable)
   - `YOUTUBE_API_KEY` : abonnés YouTube (gratuit, Google Cloud Console → YouTube Data API v3)
   - `APIFY_TOKEN` : abonnés X / Instagram / TikTok / Facebook (quelques centimes par jour)
4. Actions → « Mise à jour des données » → Run workflow (premier relevé).
5. Nom de domaine (optionnel) : Settings → Pages → Custom domain.

Le workflow tourne à 5 h, 11 h, 17 h et 22 h UTC (réseaux sociaux une fois par jour).

## À savoir
- **Historique réseaux sociaux** : la série de janvier à aujourd'hui est une *estimation*
  (`scripts/seed_social.py`), signalée sur le site. Au premier relevé réel, elle est recalée
  automatiquement sur les vrais chiffres, puis chaque jour ajoute un point réel.
- **Identifiants réseaux sociaux** dans `candidates.json` : à vérifier un par un (certains
  candidats n'ont pas de compte sur toutes les plateformes).
- **Programmes** : synthèse indicative, à relire et mettre à jour à mesure que les programmes
  officiels sont publiés.
