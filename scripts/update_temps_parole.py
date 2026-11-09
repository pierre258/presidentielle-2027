#!/usr/bin/env python3
"""Récupère les relevés de temps de parole des personnalités politiques publiés par l'Arcom
(hors période électorale, un fichier CSV par mois) et écrit data/temps_parole.json.

Source : https://www.arcom.fr/temps-parole/hors-elections/recherche/source/<année>
  La page embarque (JSON « drupal-settings-json », clé « tphpe ») la liste des fichiers
  du mois : « Temps de parole des personnalités politiques » (Export_web_Personnalites_
  avec_seuil_JJ-MM-AAAA_JJ-MM-AAAA.csv) et « des partis politiques » (Export_web_1T2T_...).
Format du CSV personnalités (séparateur « ; », UTF-8) :
  ligne 1 : « ; Appartenance ; TF1 ; TF1 ; TF1 ; France 2 ; ... » (chaîne / station)
  ligne 2 : type de service (Chaîne généraliste, Chaîne d'information, Radio)
  ligne 3 : type d'émission (JTF = journaux, MAG = magazines, PROG = autres programmes)
  lignes suivantes : « NOM Prénom ; parti ou fonction ; HH:MM:SS ou - ... »
  Une même personne peut apparaître sur plusieurs lignes (ex. « Ministre » puis parti) :
  les lignes sont additionnées.
Le temps de parole d'un candidat = son temps personnel (pas celui de son parti ni de ses
soutiens). part_pct = part du candidat dans le total des candidats suivis ce mois-là.
En cas d'erreur réseau, le fichier existant est conservé. Bibliothèque standard uniquement.
"""
import csv
import datetime as dt
import io
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/temps_parole.json"
BASE = "https://www.arcom.fr"
INDEX_URL = BASE + "/temps-parole/hors-elections/recherche/source/{year}"
UA = "Presidentielle2027Tracker/1.0 (site d'information ; contact via le dépôt du projet)"
HISTORY_START = (2025, 1)   # premier mois conservé dans « historique »
MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
           "Septembre", "Octobre", "Novembre", "Décembre"]
# Libellé Arcom (« NOM Prénom », normalisé sans accents, majuscules) -> id candidat
ARCOM_NAMES = {
    "LE PEN MARINE": "lepen", "BARDELLA JORDAN": "bardella", "MELENCHON JEAN-LUC": "melenchon",
    "PHILIPPE EDOUARD": "philippe", "GLUCKSMANN RAPHAEL": "glucksmann", "ATTAL GABRIEL": "attal",
    "LISNARD DAVID": "lisnard", "RETAILLEAU BRUNO": "retailleau", "ZEMMOUR ERIC": "zemmour",
    "TONDELIER MARINE": "tondelier", "ROUSSEL FABIEN": "roussel", "RINER TEDDY": "riner",
    "DE VILLEPIN DOMINIQUE": "villepin", "VILLEPIN DOMINIQUE DE": "villepin",
    "DUPONT-AIGNAN NICOLAS": "dupontaignan", "ARTHAUD NATHALIE": "arthaud",
}
NOTE = ("Temps de parole personnel relevé par l'Arcom sur les principales chaînes de télévision "
        "(généralistes et d'information) et stations de radio, tous types d'émissions confondus "
        "(journaux, magazines, autres programmes). Il s'agit du temps où la personnalité "
        "s'exprime elle-même : le temps de son parti, de ses porte-parole ou soutiens n'est pas "
        "inclus (l'Arcom publie aussi un relevé par parti, non repris ici). Relevés mensuels hors "
        "période électorale, publiés avec plusieurs semaines de décalage ; l'Arcom n'y liste que "
        "les personnalités au-dessus d'un seuil (« avec seuil ») : une personnalité absente est "
        "notée null. Une absence de relevé ne signifie pas une absence d'antenne (ex. personnalité "
        "non classée comme politique). part_pct = part dans le total des candidats suivis.")


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip().upper()


def to_min(v):
    m = re.fullmatch(r"(\d+):(\d{2}):(\d{2})", (v or "").strip())
    if not m:
        return 0.0
    h, mi, s = map(int, m.groups())
    return h * 60 + mi + s / 60


def list_files(year):
    """[(année, mois, url_csv_personnalités)] annoncés sur la page de l'année."""
    page = fetch(INDEX_URL.format(year=year)).decode("utf-8", "replace")
    m = re.search(r'data-drupal-selector="drupal-settings-json">(.*?)</script>', page, re.S)
    if not m:
        return []
    settings = json.loads(m.group(1))
    out = []
    for block in settings.get("tphpe") or []:
        for mois in block.get("mois") or []:
            for f in mois.get("fichiers") or []:
                if f.get("type") != "uploaded_csv_personnalites":
                    continue
                d = dt.datetime.strptime(f["date_start"], "%d/%m/%Y").date()
                out.append((d.year, d.month, urllib.parse.urljoin(BASE, f["file_uri"])))
    return out


def parse_csv(raw):
    """{id: {"total_min", "tv_min", "radio_min"}} pour les candidats présents dans le fichier."""
    text = raw.decode("utf-8-sig", "replace")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    if len(rows) < 4:
        raise ValueError("CSV trop court")
    services = rows[1]
    if not norm(rows[2][0]).startswith("TYPE D'EMISSION"):
        raise ValueError("Format inattendu (3e ligne != Type d'émission)")
    res = {}
    for r in rows[3:]:
        if not r:
            continue
        cid = ARCOM_NAMES.get(norm(r[0]))
        if not cid:
            continue
        acc = res.setdefault(cid, {"tv": 0.0, "radio": 0.0})
        for i in range(2, min(len(r), len(services))):
            key = "radio" if norm(services[i]) == "RADIO" else "tv"
            acc[key] += to_min(r[i])
    return {cid: {"total_min": round(v["tv"] + v["radio"], 1), "tv_min": round(v["tv"], 1),
                  "radio_min": round(v["radio"], 1)} for cid, v in res.items()}


def main():
    ids = [c["id"] for c in json.loads((ROOT / "data/candidates.json").read_text())["candidates"]]
    today = dt.date.today()
    files = {}
    try:
        for year in range(HISTORY_START[0], today.year + 1):
            for y, mo, url in list_files(year):
                if (y, mo) >= HISTORY_START:
                    files[(y, mo)] = url
    except Exception as e:  # noqa: BLE001
        print(f"Arcom injoignable ({e}) : fichier existant conservé.", file=sys.stderr)
        return 0
    if not files:
        print("Aucun fichier Arcom trouvé : fichier existant conservé.", file=sys.stderr)
        return 0

    months = {}
    for key in sorted(files):
        try:
            months[key] = parse_csv(fetch(files[key]))
        except Exception as e:  # noqa: BLE001
            print(f"  {key[0]}-{key[1]:02d} ignoré : {e}", file=sys.stderr)
    if not months:
        print("Aucun CSV exploitable : fichier existant conservé.", file=sys.stderr)
        return 0

    last = max(months)
    cur = months[last]
    tot = sum(v["total_min"] for v in cur.values()) or None
    candidates = {}
    for cid in ids:
        v = cur.get(cid)
        if v:
            candidates[cid] = dict(v, part_pct=round(100 * v["total_min"] / tot, 1) if tot else None)
        else:
            candidates[cid] = {"total_min": None, "tv_min": None, "radio_min": None, "part_pct": None}
    historique = [{"mois": f"{y}-{m:02d}", "valeurs": {cid: v["total_min"] for cid, v in months[(y, m)].items()}}
                  for (y, m) in sorted(months)]
    result = {
        "updated": today.isoformat(),
        "source": {"label": "Arcom — Temps de parole des personnalités politiques (hors période électorale)",
                   "url": INDEX_URL.format(year=last[0]), "fichier": files[last]},
        "periode": f"{MOIS_FR[last[1] - 1]} {last[0]}",
        "unite": "minutes",
        "candidates": candidates,
        "historique": historique,
        "note": NOTE,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    found = sum(1 for v in candidates.values() if v["total_min"] is not None)
    print(f"temps_parole.json : {result['periode']}, {found}/{len(ids)} candidats, {len(historique)} mois.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
