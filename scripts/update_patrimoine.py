#!/usr/bin/env python3
"""Rafraîchit data/patrimoine.json à partir de l'open data de la HATVP.

Ce que fait le script :
  1. télécharge l'index https://www.hatvp.fr/livraison/opendata/liste.csv ;
  2. pour chaque candidat, repère la déclaration d'intérêts (di, dia, dim, diam)
     livrée la plus récente (colonne `open_data`) ;
  3. télécharge le XML correspondant et en extrait les rémunérations déclarées
     (champ `revenus`) et les participations financières (champ `participations`) ;
  4. met à jour la source HATVP correspondante.

Les champs `patrimoine` et `faits` (saisis à la main à partir des déclarations de
situation patrimoniale publiées) ne sont jamais modifiés. Les sources non HATVP
« livraison » (archives, Journal officiel...) sont conservées.

Si la HATVP est injoignable ou si l'index est illisible, le fichier existant est
laissé intact. Bibliothèque standard uniquement (Python >= 3.8).

Usage : python3 scripts/update_patrimoine.py [--dry-run]
"""
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "patrimoine.json")
INDEX_URL = "https://www.hatvp.fr/livraison/opendata/liste.csv"
DOSSIERS_URL = "https://www.hatvp.fr/livraison/dossiers/"
UA = "Mozilla/5.0 (compatible; candidat-2027-bot; +patrimoine)"
INTEREST_TYPES = {"di", "dia", "dim", "diam"}
TYPE_LABELS = {
    "di": "déclaration d'intérêts",
    "dim": "déclaration d'intérêts modificative",
    "dia": "déclaration d'intérêts et d'activités",
    "diam": "déclaration d'intérêts et d'activités modificative",
}

# id du site -> (NOM tel qu'écrit dans liste.csv, prénom)
CANDIDATES = {
    "lepen": ("LE PEN", "Marine"),
    "bardella": ("BARDELLA", "Jordan"),
    "melenchon": ("MÉLENCHON", "Jean-Luc"),
    "philippe": ("PHILIPPE", "Edouard"),
    "glucksmann": ("GLUCKSMANN", "Raphaël"),
    "attal": ("ATTAL", "Gabriel"),
    "lisnard": ("LISNARD", "David"),
    "retailleau": ("RETAILLEAU", "Bruno"),
    "zemmour": ("ZEMMOUR", "Éric"),
    "tondelier": ("TONDELIER", "Marine"),
    "roussel": ("ROUSSEL", "Fabien"),
    "riner": ("RINER", "Teddy"),
    "villepin": ("DE VILLEPIN", "Dominique"),
    "dupontaignan": ("DUPONT-AIGNAN", "Nicolas"),
    "arthaud": ("ARTHAUD", "Nathalie"),
}

MAX_REVENUS = 8
MAX_PARTICIPATIONS = 6
HIDDEN = "[Données non publiées]"


def norm(s):
    s = (s or "").strip().lower()
    for a, b in (("é", "e"), ("è", "e"), ("ê", "e"), ("ë", "e"), ("à", "a"),
                 ("â", "a"), ("ï", "i"), ("î", "i"), ("ô", "o"), ("ç", "c"),
                 ("ü", "u"), ("û", "u")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z]", "", s)


def _urlopen(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch(url, timeout=60):
    """HTTPS, puis repli : certaines piles TLS anciennes (LibreSSL de macOS)
    voient leur connexion réinitialisée par hatvp.fr ; on tente alors curl,
    puis HTTP simple."""
    try:
        return _urlopen(url, timeout)
    except urllib.error.HTTPError:
        raise
    except Exception as first:
        err = first
    if shutil.which("curl"):
        try:
            out = subprocess.run(["curl", "-sSfL", "--max-time", str(timeout), "-A", UA, url],
                                 capture_output=True, check=True)
            return out.stdout
        except Exception as e:
            err = e
    if url.startswith("https://"):
        return _urlopen("http://" + url[len("https://"):], timeout)
    raise err


def clean(text):
    text = re.sub(r"\s+", " ", (text or "")).strip()
    text = text.replace(HIDDEN, "(non publié)")
    return re.sub(r"\s+", " ", text).strip(" -–,;")


def to_number(text):
    """'88 068' -> 88068 ; '616800' -> 616800 ; '' -> None."""
    t = re.sub(r"[\s\u00a0\u202f\u2009\u20ac]", "", text or "").replace(",", ".")
    if not re.fullmatch(r"-?\d+(\.\d+)?", t):
        return None
    v = float(t)
    return int(v) if v.is_integer() else round(v, 2)


def iso(d):
    """'21/06/2026 19:30:40' ou '2026-06-21' -> '2026-06-21'."""
    d = (d or "").strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", d)
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    m = re.match(r"\d{4}-\d{2}-\d{2}", d)
    return m.group(0) if m else None


# ---------------------------------------------------------------- extraction

REVENU_SECTIONS = (
    # (section, champs composant le libellé)
    ("activProfCinqDerniereDto", ("description", "employeur")),
    ("activConsultantDto", ("description", "nomEmployeur", "employeur")),
    ("participationDirigeantDto", ("activite", "nomSociete")),
    ("mandatElectifDto", ("descriptionMandat",)),
)


def extract_revenus(root):
    rows = []
    for section, fields in REVENU_SECTIONS:
        for it in root.findall("%s/items/items" % section):
            parts = []
            for f in fields:
                v = clean(it.findtext(f))
                if v and v != "(non publié)" and v not in parts:
                    parts.append(v)
            label = " — ".join(parts) or section
            nature = clean(it.findtext("remuneration/brutNet"))
            if nature:
                label += " (%s)" % nature.lower()
            years = []
            for m in it.findall("remuneration/montant/montant"):
                y = to_number(m.findtext("annee"))
                v = to_number(m.findtext("montant"))
                if isinstance(y, int) and v is not None:
                    years.append((y, v))
            years.sort(reverse=True)
            # deux dernières années déclarées avec un montant non nul
            for y, v in [p for p in years if p[1]][:2]:
                rows.append({"annee": y, "label": label, "montant": v})
    if not rows:
        return []
    latest = max(r["annee"] for r in rows)
    rows = [r for r in rows if r["annee"] >= latest - 2]
    rows.sort(key=lambda r: (-r["annee"], -abs(r["montant"])))
    return rows[:MAX_REVENUS]


def extract_participations(root):
    out = []
    for it in root.findall("participationFinanciereDto/items/items"):
        societe = clean(it.findtext("nomSociete")) or "(non publié)"
        valeur = to_number(it.findtext("evaluation"))
        bits = []
        n = to_number(it.findtext("nombreParts"))
        if n is not None:
            bits.append("%s parts" % n)
        c = to_number(it.findtext("capitalDetenu"))
        if c is not None:
            bits.append("%s %% du capital" % c)
        rem = clean(it.findtext("remuneration"))
        if rem and to_number(rem.replace("€", "")) != 0 and rem.lower() not in ("aucune", "néant", "neant"):
            bits.append("rémunération déclarée : %s" % rem)
        com = clean(it.findtext("commentaire"))
        if com and com != "(non publié)":
            bits.append(com)
        out.append({"societe": societe, "valeur": valeur, "detail": " ; ".join(bits)})
    out.sort(key=lambda p: -(p["valeur"] or 0))
    return out[:MAX_PARTICIPATIONS]


def parse_interest_xml(data):
    root = ET.fromstring(data)
    return {
        "date": iso(root.findtext("dateDepot")),
        "revenus": extract_revenus(root),
        "participations": extract_participations(root),
    }


# ---------------------------------------------------------------- index

def load_index():
    raw = fetch(INDEX_URL)
    text = raw.decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
    if not rows or "open_data" not in rows[0]:
        raise ValueError("index HATVP illisible")
    return rows


def latest_interest_row(rows, nom, prenom):
    cand = [r for r in rows
            if norm(r.get("nom")) == norm(nom) and norm(r.get("prenom")) == norm(prenom)
            and (r.get("type_document") or "").strip() in INTEREST_TYPES
            and (r.get("open_data") or "").strip().endswith(".xml")]
    if not cand:
        return None
    cand.sort(key=lambda r: ((r.get("date_depot") or ""), (r.get("date_publication") or "")))
    return cand[-1]


# ---------------------------------------------------------------- fichier

def empty_entry():
    return {"status": "indisponible", "patrimoine": None, "revenus": [],
            "participations": [], "faits": [], "sources": []}


def is_auto_source(src):
    url = (src or {}).get("url") or ""
    return url.startswith(DOSSIERS_URL) and re.search(r"-di(a|m|am)?\d+-", url)


def compute_status(entry):
    if entry.get("patrimoine"):
        return "complet"
    if entry.get("revenus") or entry.get("participations"):
        return "interets"
    return "indisponible"


def apply_interest(entry, parsed, row):
    fname = row["open_data"].strip()
    url = DOSSIERS_URL + fname
    year = (parsed["date"] or row.get("date_depot") or "")[:4]
    tlabel = TYPE_LABELS.get(row.get("type_document", "").strip(), "déclaration d'intérêts")
    entry["revenus"] = parsed["revenus"]
    entry["participations"] = parsed["participations"]
    srcs = [s for s in entry.get("sources", []) if not is_auto_source(s)]
    srcs.insert(0, {"label": "HATVP — %s (%s)" % (tlabel, year), "url": url})
    entry["sources"] = srcs
    entry["status"] = compute_status(entry)


def main(argv):
    dry = "--dry-run" in argv
    try:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {"updated": None, "note": "", "candidates": {}}
    data.setdefault("candidates", {})

    try:
        rows = load_index()
    except Exception as e:  # réseau, HTTP, CSV...
        print("HATVP injoignable ou index illisible (%s) : fichier conservé." % e)
        return 0

    changed = 0
    for cid, (nom, prenom) in CANDIDATES.items():
        entry = data["candidates"].setdefault(cid, empty_entry())
        row = latest_interest_row(rows, nom, prenom)
        if not row:
            print("%-13s aucune déclaration d'intérêts livrée : inchangé" % cid)
            continue
        try:
            parsed = parse_interest_xml(fetch(DOSSIERS_URL + row["open_data"].strip()))
        except Exception as e:
            print("%-13s échec sur %s (%s) : inchangé" % (cid, row["open_data"], e))
            continue
        before = json.dumps(entry, sort_keys=True, ensure_ascii=False)
        apply_interest(entry, parsed, row)
        if json.dumps(entry, sort_keys=True, ensure_ascii=False) != before:
            changed += 1
        print("%-13s %s : %d revenus, %d participations"
              % (cid, row["open_data"], len(entry["revenus"]), len(entry["participations"])))

    if dry:
        print("--dry-run : rien n'est écrit (%d fiche(s) modifiée(s))." % changed)
        return 0
    if changed:
        data["updated"] = date.today().isoformat()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(OUT), suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, OUT)
    print("%s écrit (%d fiche(s) modifiée(s))." % (OUT, changed))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
