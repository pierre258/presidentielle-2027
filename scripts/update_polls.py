#!/usr/bin/env python3
"""Récupère les sondages du 1er tour (page Wikipédia « Liste de sondages sur l'élection
présidentielle française de 2027 »), calcule la moyenne des 7 derniers jours et écrit
data/polls.json.

Méthode :
  1. Chaque ligne d'un tableau = une hypothèse (liste de candidats testée).
  2. Pour un sondage (institut + dates), le score d'un candidat = moyenne de ses scores
     dans les hypothèses où il est testé.
  3. Moyenne finale = moyenne simple de tous les instituts dont la fin de terrain tombe
     dans les 15 derniers jours (fenêtres 7 et 30 j aussi calculées). S'il n'y en a
     aucun, la fenêtre est élargie et signalée dans le JSON.
  4. 2nd tour : pour chaque duel testé, moyenne des sondages des 15 derniers jours
     (à défaut, les 3 derniers sondages du duel).
Bibliothèque standard uniquement (exécutable tel quel dans GitHub Actions).
"""
import datetime as dt
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from wikitable import parse_tables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
URL = ("https://fr.wikipedia.org/wiki/"
       "Liste_de_sondages_sur_l%27%C3%A9lection_pr%C3%A9sidentielle_fran%C3%A7aise_de_2027")
UA = "Presidentielle2027Tracker/1.0 (site d'information ; contact via le dépôt du projet)"
MONTHS = {"janv": 1, "févr": 2, "fevr": 2, "mars": 3, "avr": 4, "mai": 5, "juin": 6, "juil": 7,
          "août": 8, "aout": 8, "sept": 9, "oct": 10, "nov": 11, "déc": 12, "dec": 12}
HISTORY_START = dt.date(2022, 6, 1)   # début de l'historique (évolution animée)
SERIES_START = dt.date(2025, 10, 1)   # début de la courbe glissante 14 j
DEFAULT_WINDOW = 15
# Famille politique selon le parti indiqué dans l'en-tête de colonne ou la cellule
PARTY_FAMILY = {"LO": "eg", "NPA": "eg", "NPA-A": "eg", "NPA-R": "eg", "POI": "eg",
                "LFI": "gr", "PCF": "gr", "GRS": "gr", "D!": "gr", "FI": "gr",
                "PS": "sd", "PP": "sd", "PRG": "sd", "LFH": "ce",
                "LE": "eco", "EELV": "eco", "EÉLV": "eco",
                "RE": "ce", "REN": "ce", "HOR": "ce", "MoDem": "ce", "MODEM": "ce", "EPR": "ce", "ENS": "ce", "UDI": "ce",
                "LR": "dr", "NE": "dr", "DVD": "dr",
                "DLF": "sv", "RES": "sv", "UPR": "sv",
                "RN": "ed", "REC": "ed", "UDR": "ed"}
NAME_FAMILY = {"villepin": "ce", "lisnard": "dr", "ruffin": "gr", "knafo": "ed", "marechal": "ed", "lagarde": "ce",
               "hollande": "sd", "faure": "sd", "royal": "sd", "cazeneuve": "sd", "delga": "sd", "guedj": "sd",
               "bertrand": "dr", "wauquiez": "dr", "darmanin": "ce", "bayrou": "ce", "lassalle": "sv", "poutou": "eg",
               "maurel": "gr", "autain": "gr", "jadot": "eco", "bardella": "ed"}


NAME_FAMILY.update({"lemaire": "ce", "maire": "ce", "sejourne": "ce", "borne": "ce", "castex": "ce", "fillon": "dr",
                    "pecresse": "dr", "ciotti": "ed", "marion": "ed", "hidalgo": "sd", "panot": "gr", "bompard": "gr",
                    "rousseau": "eco", "tondelier": "eco", "arthaud": "eg", "melenchon": "gr", "roussel": "gr"})
_CAND_FAMILY = {}


def cand_family():
    """Familles des candidats suivis (data/historique.json), indexées par nom normalisé."""
    if not _CAND_FAMILY:
        fam = json.loads((ROOT / "data/historique.json").read_text())["family_2027"]
        for c in json.loads((ROOT / "data/candidates.json").read_text())["candidates"]:
            if c["id"] in fam:
                _CAND_FAMILY[norm(c["short"])] = fam[c["id"]]
                _CAND_FAMILY[norm(c["short"].split("-")[-1])] = fam[c["id"]]
    return _CAND_FAMILY


def family_of(party, name=""):
    party = (party or "").strip()
    if party in PARTY_FAMILY:
        return PARTY_FAMILY[party]
    m = re.match(r"Candidat\s+(\S+)", name)
    if m and m.group(1) in PARTY_FAMILY:
        return PARTY_FAMILY[m.group(1)]
    if not name:
        return None
    last = norm(name.split()[-1])
    return NAME_FAMILY.get(last) or cand_family().get(last)
WINDOWS = (7, 15, 30)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def num(s):
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", s or "")
    return float(m.group(1).replace(",", ".")) if m else None


def parse_end_date(txt):
    """'3-5 novembre' -> (5, 11) ; '28 sept.-1er oct.' -> (1, 10)."""
    pairs = re.findall(r"(\d{1,2})(?:er)?\s*([a-zéûè]+)", txt.lower())
    for day, mon in reversed(pairs):
        for k, v in MONTHS.items():
            if mon.startswith(k):
                return int(day), v
    return None


def second_round(tables, key2id, today):
    """Duels de 2nd tour : tableaux à 2 candidats (Sondeur | Dates | Échantillon | A | B)."""
    duels = []
    for grid in tables:
        if len(grid) < 3 or len(grid[1]) != 5 or grid[1][0]["text"] != "Sondeur":
            continue
        names = [re.sub(r"\(.*?\)", "", grid[1][i]["text"]).strip() for i in (3, 4)]
        ids = [key2id.get(norm(n)) for n in names]
        if not all(ids):
            continue
        polls = []
        for row in grid[2:]:
            if len(row) < 5:
                continue
            a, b = num(row[3]["text"]), num(row[4]["text"])
            y = re.search(r"(20\d\d)", row[1]["text"])
            ed = parse_end_date(row[1]["text"])
            if a is None or b is None or not y or not ed:
                continue
            try:
                end = dt.date(int(y.group(1)), ed[1], ed[0])
            except ValueError:
                continue
            polls.append({"pollster": row[0]["text"], "fieldwork": row[1]["text"],
                          "end": end.isoformat(), "a": a, "b": b})
        if not polls:
            continue
        polls.sort(key=lambda p: p["end"], reverse=True)
        recent = [p for p in polls if (today - dt.date.fromisoformat(p["end"])).days <= DEFAULT_WINDOW]
        used = recent or polls[:3]
        duels.append({"a": ids[0], "b": ids[1], "last": polls[0]["end"],
                      "window": "15 jours" if recent else "3 derniers sondages",
                      "n": len(used),
                      "avg_a": round(sum(p["a"] for p in used) / len(used), 1),
                      "avg_b": round(sum(p["b"] for p in used) / len(used), 1),
                      "polls": polls[:6]})
    duels.sort(key=lambda d: d["last"], reverse=True)
    return duels


def main():
    cands = json.loads((ROOT / "data/candidates.json").read_text())["candidates"]
    key2id = {norm(k): c["id"] for c in cands for k in c["poll_keys"]}
    html = fetch(URL)
    tables = parse_tables(html)

    today = dt.date.today()
    year, prev_month = today.year, today.month
    polls, by_key = [], {}
    for grid in tables:
        if len(grid) < 4 or len(grid[1]) < 9 or grid[1][0]["text"] != "Sondeur":
            continue  # on ne garde que les tableaux de 1er tour
        header = grid[1]
        stop = False
        cur = None
        for row in grid[3:]:
            if len(row) < len(header) or not row[0]["text"]:
                continue
            # Lignes d'événement (« X officialise sa candidature… ») : une seule cellule sur
            # toute la largeur, sans échantillon chiffré → ce ne sont pas des sondages
            if row[0] is row[1] or row[1] is row[2] or not re.fullmatch(r"[\d\s \xa0.]+", row[2]["text"] or "x"):
                continue
            ed = parse_end_date(row[1]["text"])
            if not ed:
                continue
            day, month = ed
            explicit = re.findall(r"(20\d\d)", row[1]["text"])
            if explicit:  # année écrite dans la date : elle fait foi
                year = int(explicit[-1])
            elif month > prev_month + 1:  # on remonte le temps : passage à l'année précédente
                year -= 1
            prev_month = month
            try:
                end = dt.date(year, month, day)
            except ValueError:
                continue
            if end < HISTORY_START:
                stop = True
                break
            sample = re.sub(r"\D", "", row[2]["text"])
            # même sondage (institut, fin de terrain, échantillon), éventuellement présent dans
            # deux tableaux : on fusionne ses hypothèses au lieu de créer un doublon
            key = (norm(row[0]["text"]), end, sample)
            cur = by_key.get(key)
            if cur is None:
                cur = {"_key": key, "pollster": row[0]["text"],
                       "fieldwork": re.sub(r"\s*20\d\d\s*$", "", row[1]["text"]),
                       "end": end.isoformat(), "sample": sample, "hyp": [], "_sig": set()}
                by_key[key] = cur
                polls.append(cur)
            hyp, seen, fam = {}, set(), {}
            for i in range(3, len(header)):
                cell = row[i]
                if id(cell) in seen:
                    continue  # cellule fusionnée (colspan)
                seen.add(id(cell))
                colname = re.sub(r"\(.*?\)", "", header[i]["text"]).strip()
                txt = cell["text"]
                if colname == "Autres" or re.match(r"^\d+(?:,\d+)?\s+[A-ZÉ]", txt):
                    for v, name, party in re.findall(r"(\d+(?:,\d+)?)\s+((?:de\s)?[A-ZÉ][\w'éèëïôç-]+)(?:\s*\(([^)]*)\))?", txt):
                        val = float(v.replace(",", "."))
                        cid = key2id.get(norm(name.replace("de ", "")))
                        if cid:
                            hyp[cid] = val
                        f = family_of(party, name.replace("de ", ""))
                        if f:
                            fam[f] = fam.get(f, 0) + val
                    continue
                cid = key2id.get(norm(colname))
                v = num(txt)
                if cid and v is not None and not colname.startswith("Candidat"):
                    hyp[cid] = v
                pm = re.search(r"\(([^)]*)\)", header[i]["text"])
                f = family_of(pm.group(1) if pm else "", colname)
                if f and v is not None:
                    fam[f] = fam.get(f, 0) + v
            sig = tuple(sorted(hyp.items()))
            if not hyp or sig in cur["_sig"]:
                continue  # hypothèse vide ou déjà vue (même sondage dans deux tableaux)
            cur["_sig"].add(sig)
            cur["hyp"].append(hyp)
            tot = sum(fam.values())
            if tot >= 80:  # hypothèse assez complète : normalisée à 100
                cur.setdefault("fam", []).append({k: v * 100 / tot for k, v in fam.items()})
        if stop:
            break

    # Agrégation par sondage
    out_polls = []
    for p in polls:
        acc = {}
        for h in p["hyp"]:
            for cid, v in h.items():
                acc.setdefault(cid, []).append(v)
        facc = {}
        for h in p.get("fam", []):
            for k, v in h.items():
                facc.setdefault(k, []).append(v)
        nh = len(p.get("fam", [])) or 1
        out_polls.append({k: p[k] for k in ("pollster", "fieldwork", "end", "sample")} |
                         {"hypotheses": len(p["hyp"]),
                          "scores": {c: round(sum(v) / len(v), 2) for c, v in acc.items()},
                          "families": {k: round(sum(v) / nh, 2) for k, v in facc.items()}})

    def window_avg(ref, days):
        sel = [p for p in out_polls
               if ref - dt.timedelta(days=days) < dt.date.fromisoformat(p["end"]) <= ref]
        acc = {}
        for p in sel:
            for c, v in p["scores"].items():
                acc.setdefault(c, []).append(v)
        return sel, {c: round(sum(v) / len(v), 1) for c, v in acc.items()}

    window = DEFAULT_WINDOW
    sel, avg = window_avg(today, window)
    while not sel and window < 30:
        window += 7
        sel, avg = window_avg(today, window)
    _, prev = window_avg(today - dt.timedelta(days=window), window)

    # Série hebdomadaire (moyenne glissante 14 j) pour les courbes d'évolution
    series, d = [], SERIES_START
    while d <= today:
        s, a = window_avg(d, 14)
        if s:
            series.append({"date": d.isoformat(), "scores": a})
        d += dt.timedelta(days=7)

    # Série mensuelle (moyenne des sondages du mois) + point final = tendance des 7 derniers jours
    by_month = {}
    for p in out_polls:
        by_month.setdefault(p["end"][:7], []).append(p)
    monthly = []
    for m in sorted(by_month):
        acc = {}
        for p in by_month[m]:
            for c, v in p["scores"].items():
                acc.setdefault(c, []).append(v)
        facc = {}
        fp = [p for p in by_month[m] if p["families"]]
        for p in fp:
            for k, v in p["families"].items():
                facc[k] = facc.get(k, 0) + v
        monthly.append({"month": m, "n": len(by_month[m]),
                        "scores": {c: round(sum(v) / len(v), 1) for c, v in acc.items()},
                        "families": {k: round(v / len(fp), 1) for k, v in facc.items()} if fp else {}})
    cur_sel, cur_avg = window_avg(today, 7)
    cur_w = 7
    if not cur_sel:
        cur_sel, cur_avg = window_avg(today, DEFAULT_WINDOW)
        cur_w = DEFAULT_WINDOW
    cur_fam = {}
    fsel = [p for p in cur_sel if p["families"]]
    for p in fsel:
        for k, v in p["families"].items():
            cur_fam[k] = cur_fam.get(k, 0) + v
    cur_fam = {k: round(v / len(fsel), 1) for k, v in cur_fam.items()} if fsel else {}
    evolution = {"start": monthly[0]["month"] if monthly else None, "monthly": monthly,
                 "current": {"date": today.isoformat(), "window": cur_w, "n": len(cur_sel), "scores": cur_avg,
                             "families": cur_fam}}

    result = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "source": "Wikipédia — Liste de sondages sur l'élection présidentielle française de 2027",
        "source_url": URL,
        "window_days": window,
        "window_extended": window != DEFAULT_WINDOW,
        "average": dict(sorted(avg.items(), key=lambda kv: -kv[1])),
        "previous_average": prev,
        "polls_in_window": sel,
        "windows": {str(w): {"polls": len(window_avg(today, w)[0]),
                             "average": window_avg(today, w)[1],
                             "previous": window_avg(today - dt.timedelta(days=w), w)[1]}
                    for w in WINDOWS},
        "default_window": 30,  # fenêtre affichée par défaut sur le site
        "second_round": second_round(tables, key2id, today),
        "series": series,
        "evolution": evolution,
        "polls": out_polls,
    }
    (ROOT / "data/polls.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"{len(out_polls)} sondages, fenêtre {window} j ({len(sel)} sondage(s)) :", result["average"])


if __name__ == "__main__":
    main()
