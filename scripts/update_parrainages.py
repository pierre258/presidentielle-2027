#!/usr/bin/env python3
"""Parrainages (présentations) des candidats à l'élection présidentielle, publiés par le
Conseil constitutionnel. Écrit data/parrainages.json.

2027 : le Conseil constitutionnel publie les parrainages au fil de l'eau (deux fois par
  semaine en 2022) dès l'ouverture de la période de recueil, qui commence avec la
  publication du décret de convocation des électeurs (au plus tard le 7 février 2027) et
  s'achève le 6e vendredi avant le 1er tour (18 avril 2027), soit le 12 mars 2027 à 18 h.
  Le script essaie les URL de FEED_URLS_2027 ; tant qu'aucune ne renvoie un CSV valide,
  le statut reste « pas_ouvert » (ou l'état précédent est conservé).
2022 (archive) : https://presidentielle2022.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv
  CSV « ; », UTF-8, colonnes : Civilité ; Nom ; Prénom ; Mandat ; Circonscription ;
  Département ; Candidat (« NOM Prénom ») ; Date de publication (JJ/MM/AAAA).
  L'archive est recalculée seulement si elle est absente du fichier existant.
« departements » = nombre de valeurs distinctes de la colonne Département (départements,
collectivités d'outre-mer, « Français de l'étranger », « Parlement européen »), tel que
publié ; la règle légale (500 parrainages, au moins 30 départements ou collectivités,
pas plus de 10 % dans un même) est appréciée par le Conseil constitutionnel.
En cas d'erreur réseau, les données existantes sont conservées. Bibliothèque standard uniquement.
"""
import collections
import csv
import datetime as dt
import io
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/parrainages.json"
UA = "Presidentielle2027Tracker/1.0 (site d'information ; contact via le dépôt du projet)"
SITE_2027 = "https://presidentielle2027.conseil-constitutionnel.fr"
# URL du CSV 2027 : à ajuster dès que le Conseil constitutionnel publie le lien exact.
FEED_URLS_2027 = [
    SITE_2027 + "/telechargement/parrainagestotal.csv",
    SITE_2027 + "/les-parrainages/telechargement/parrainagestotal.csv",
    "https://www.conseil-constitutionnel.fr/presidentielle2027/telechargement/parrainagestotal.csv",
]
PAGE_2027 = SITE_2027 + "/les-parrainages/"
URL_2022 = "https://presidentielle2022.conseil-constitutionnel.fr/telechargement/parrainagestotal.csv"
CLOTURE_PREVUE = "2027-03-12"   # 6e vendredi avant le 1er tour du 18 avril 2027 (18 h)
SEUIL = 500
TOP_PAR_DEP = 5                 # archive 2022 : nb de candidats gardés par département
DEPARTEMENTS = {
    "Ain": "01", "Aisne": "02", "Allier": "03", "Alpes-de-Haute-Provence": "04", "Hautes-Alpes": "05",
    "Alpes-Maritimes": "06", "Ardèche": "07", "Ardennes": "08", "Ariège": "09", "Aube": "10", "Aude": "11",
    "Aveyron": "12", "Bouches-du-Rhône": "13", "Calvados": "14", "Cantal": "15", "Charente": "16",
    "Charente-Maritime": "17", "Cher": "18", "Corrèze": "19", "Corse-du-Sud": "2A", "Haute-Corse": "2B",
    "Côte-d'Or": "21", "Côtes-d'Armor": "22", "Creuse": "23", "Dordogne": "24", "Doubs": "25", "Drôme": "26",
    "Eure": "27", "Eure-et-Loir": "28", "Finistère": "29", "Gard": "30", "Haute-Garonne": "31", "Gers": "32",
    "Gironde": "33", "Hérault": "34", "Ille-et-Vilaine": "35", "Indre": "36", "Indre-et-Loire": "37",
    "Isère": "38", "Jura": "39", "Landes": "40", "Loir-et-Cher": "41", "Loire": "42", "Haute-Loire": "43",
    "Loire-Atlantique": "44", "Loiret": "45", "Lot": "46", "Lot-et-Garonne": "47", "Lozère": "48",
    "Maine-et-Loire": "49", "Manche": "50", "Marne": "51", "Haute-Marne": "52", "Mayenne": "53",
    "Meurthe-et-Moselle": "54", "Meuse": "55", "Morbihan": "56", "Moselle": "57", "Nièvre": "58",
    "Nord": "59", "Oise": "60", "Orne": "61", "Pas-de-Calais": "62", "Puy-de-Dôme": "63",
    "Pyrénées-Atlantiques": "64", "Hautes-Pyrénées": "65", "Pyrénées-Orientales": "66", "Bas-Rhin": "67",
    "Haut-Rhin": "68", "Rhône": "69", "Métropole de Lyon": "69M", "Haute-Saône": "70", "Saône-et-Loire": "71",
    "Sarthe": "72", "Savoie": "73", "Haute-Savoie": "74", "Paris": "75", "Seine-Maritime": "76",
    "Seine-et-Marne": "77", "Yvelines": "78", "Deux-Sèvres": "79", "Somme": "80", "Tarn": "81",
    "Tarn-et-Garonne": "82", "Var": "83", "Vaucluse": "84", "Vendée": "85", "Vienne": "86",
    "Haute-Vienne": "87", "Vosges": "88", "Yonne": "89", "Territoire de Belfort": "90", "Essonne": "91",
    "Hauts-de-Seine": "92", "Seine-Saint-Denis": "93", "Val-de-Marne": "94", "Val-d'Oise": "95",
    "Guadeloupe": "971", "Martinique": "972", "Guyane": "973", "La Réunion": "974", "Réunion": "974",
    "Saint-Pierre-et-Miquelon": "975", "Mayotte": "976", "Saint-Barthélemy": "977", "Saint-Martin": "978",
    "Saint-Martin / Saint-Barthélémy": "977-978", "Saint-Martin / Saint-Barthélemy": "977-978",
    "Wallis et Futuna": "986", "Wallis-et-Futuna": "986", "Polynésie française": "987",
    "Nouvelle-Calédonie": "988", "Français de l'étranger": "ZZ", "Français établis hors de France": "ZZ",
    "Parlement européen": "PE",
}
_DEP_NORM = {}


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[\s'’-]+", " ", s).strip().upper()


def dep_code(name):
    if not _DEP_NORM:
        _DEP_NORM.update({norm(k): v for k, v in DEPARTEMENTS.items()})
    return _DEP_NORM.get(norm(name), "")


def pretty_name(raw):
    """« PÉCRESSE Valérie » -> « Valérie Pécresse » (nom en capitales suivi du prénom)."""
    parts = raw.split()
    nom = [p for p in parts if p.isupper() and len(p) > 1 or p in ("DE", "LE", "LA", "D'")]
    prenom = [p for p in parts if p not in nom]
    if not nom or not prenom:
        return raw.strip()
    nom_txt = " ".join(nom).title().replace("D'", "d'")
    nom_txt = re.sub(r"\bDe\b", "de", nom_txt) if not nom_txt.startswith("De ") else nom_txt
    return f"{' '.join(prenom)} {nom_txt}"


def parse_csv(raw):
    text = raw.decode("utf-8-sig", "replace")
    if "<html" in text[:500].lower():
        raise ValueError("page HTML au lieu d'un CSV")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
    if not rows or "Candidat" not in rows[0]:
        raise ValueError("colonnes inattendues")
    return rows


def iso(d):
    try:
        return dt.datetime.strptime((d or "").strip(), "%d/%m/%Y").date().isoformat()
    except ValueError:
        return (d or "").strip()


def totals(rows):
    per = collections.defaultdict(lambda: {"total": 0, "deps": set()})
    for r in rows:
        p = per[r["Candidat"].strip()]
        p["total"] += 1
        p["deps"].add(r["Département"].strip())
    return per


def build_archive_2022():
    rows = parse_csv(fetch(URL_2022))
    per = totals(rows)
    tot = sorted(({"nom": pretty_name(k), "nom_source": k, "total": v["total"], "departements": len(v["deps"])}
                  for k, v in per.items()), key=lambda x: (-x["total"], x["nom"]))
    by_dep = collections.defaultdict(collections.Counter)
    for r in rows:
        dep = r["Département"].strip()
        by_dep[dep_code(dep) or dep][r["Candidat"].strip()] += 1
    par_dep = {code: [{"nom": pretty_name(k), "total": n} for k, n in c.most_common(TOP_PAR_DEP)]
               for code, c in sorted(by_dep.items())}
    dates = sorted(iso(r["Date de publication"]) for r in rows)
    return {"source": URL_2022, "parrainages": len(rows), "candidats": len(tot),
            "premiere_publication": dates[0], "derniere_publication": dates[-1],
            "top_par_departement": TOP_PAR_DEP, "totaux": tot, "par_departement": par_dep}


def candidate_matcher():
    cands = json.loads((ROOT / "data/candidates.json").read_text())["candidates"]
    keys = {frozenset(norm(c["name"]).split()): c["id"] for c in cands}

    def match(raw):
        return keys.get(frozenset(norm(raw).split()))
    return match


def main():
    today = dt.date.today()
    try:
        prev = json.loads(OUT.read_text())
    except (OSError, ValueError):
        prev = {}
    result = {
        "updated": today.isoformat(),
        "status": prev.get("status", "pas_ouvert"),
        "ouverture": prev.get("ouverture"),
        "cloture": prev.get("cloture") or CLOTURE_PREVUE,
        "seuil": SEUIL,
        "source": prev.get("source") or {"label": "Conseil constitutionnel — parrainages présidentielle 2027",
                                         "url": PAGE_2027},
        "calendrier": ("Recueil ouvert à la publication du décret de convocation des électeurs "
                       "(au plus tard le 7 février 2027) ; clôture le 12 mars 2027 à 18 h "
                       "(6e vendredi avant le 1er tour du 18 avril 2027). Publication des "
                       "parrainages au fil de l'eau par le Conseil constitutionnel."),
        "candidates": prev.get("candidates", {}),
        "parrains": prev.get("parrains", []),
        "archive_2022": prev.get("archive_2022"),
    }

    rows, feed = None, None
    for url in FEED_URLS_2027:
        try:
            rows, feed = parse_csv(fetch(url, timeout=30)), url
            break
        except Exception as e:  # noqa: BLE001
            print(f"2027 : {url} indisponible ({e.__class__.__name__}: {e})", file=sys.stderr)
    if rows:
        match = candidate_matcher()
        per = totals(rows)
        result["candidates"] = {}
        for raw, v in per.items():
            key = match(raw) or pretty_name(raw)
            result["candidates"][key] = {"total": v["total"], "departements": len(v["deps"])}
        result["parrains"] = [{
            "candidat": match(r["Candidat"]) or pretty_name(r["Candidat"]),
            "civilite": r.get("Civilité", "").strip(), "nom": r.get("Nom", "").strip(),
            "prenom": r.get("Prénom", "").strip(), "mandat": r.get("Mandat", "").strip(),
            "circonscription": r.get("Circonscription", "").strip(),
            "departement": r.get("Département", "").strip(), "dep_code": dep_code(r.get("Département", "")),
            "date": iso(r.get("Date de publication", "")),
        } for r in rows]
        dates = sorted(p["date"] for p in result["parrains"] if p["date"])
        if dates and not result["ouverture"]:
            result["ouverture"] = dates[0]
        result["status"] = "clos" if today.isoformat() > result["cloture"] else "en_cours"
        result["source"] = {"label": "Conseil constitutionnel — parrainages présidentielle 2027", "url": feed}
        print(f"2027 : {len(rows)} parrainages, {len(per)} candidats.")
    elif result["status"] == "en_cours" and today.isoformat() > result["cloture"]:
        result["status"] = "clos"

    if not result["archive_2022"]:
        try:
            result["archive_2022"] = build_archive_2022()
        except Exception as e:  # noqa: BLE001
            print(f"Archive 2022 indisponible ({e})", file=sys.stderr)
            if not prev:
                return 0
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    a = result["archive_2022"] or {}
    print(f"parrainages.json : statut {result['status']}, archive 2022 : "
          f"{a.get('parrainages', 0)} parrainages / {a.get('candidats', 0)} candidats.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
