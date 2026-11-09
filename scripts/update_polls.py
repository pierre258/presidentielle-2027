#!/usr/bin/env python3
"""Récupère les sondages du 1er tour (page Wikipédia « Liste de sondages sur l'élection
présidentielle française de 2027 »), calcule la moyenne des 7 derniers jours et écrit
data/polls.json.

Méthode :
  1. Chaque ligne d'un tableau = une hypothèse (liste de candidats testée).
  2. Pour un sondage (institut + dates), le score d'un candidat = moyenne de ses scores
     dans les hypothèses où il est testé.
  3. Moyenne finale = moyenne simple des sondages dont la fin de terrain tombe dans les
     7 derniers jours. S'il n'y en a aucun, la fenêtre est élargie (14, 21, 30 j) et
     signalée dans le JSON.
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
HISTORY_START = dt.date(2025, 10, 1)


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


def main():
    cands = json.loads((ROOT / "data/candidates.json").read_text())["candidates"]
    key2id = {norm(k): c["id"] for c in cands for k in c["poll_keys"]}
    html = fetch(URL)
    tables = parse_tables(html)

    today = dt.date.today()
    year, prev_month = today.year, today.month
    polls = []
    for grid in tables:
        if len(grid) < 4 or len(grid[1]) < 9 or grid[1][0]["text"] != "Sondeur":
            continue  # on ne garde que les tableaux de 1er tour
        header = grid[1]
        stop = False
        cur = None
        for row in grid[3:]:
            if len(row) < len(header) or not row[0]["text"]:
                continue
            ed = parse_end_date(row[1]["text"])
            if not ed:
                continue
            day, month = ed
            if month > prev_month + 1:  # on remonte le temps : passage à l'année précédente
                year -= 1
            prev_month = month
            try:
                end = dt.date(year, month, day)
            except ValueError:
                continue
            if end < HISTORY_START:
                stop = True
                break
            key = (row[0]["text"], row[1]["text"], end)
            if cur is None or cur["_key"] != key:
                cur = {"_key": key, "pollster": row[0]["text"], "fieldwork": row[1]["text"],
                       "end": end.isoformat(), "sample": re.sub(r"\D", "", row[2]["text"]),
                       "hyp": []}
                polls.append(cur)
            hyp, seen = {}, set()
            for i in range(3, len(header)):
                cell = row[i]
                if id(cell) in seen:
                    continue  # cellule fusionnée (colspan)
                seen.add(id(cell))
                colname = re.sub(r"\(.*?\)", "", header[i]["text"]).strip()
                txt = cell["text"]
                if colname == "Autres" or re.match(r"^\d+(?:,\d+)?\s+[A-ZÉ]", txt):
                    for v, name in re.findall(r"(\d+(?:,\d+)?)\s+((?:de\s)?[A-ZÉ][\w'éèëïôç-]+)", txt):
                        cid = key2id.get(norm(name.replace("de ", "")))
                        if cid:
                            hyp[cid] = float(v.replace(",", "."))
                    continue
                cid = key2id.get(norm(colname))
                v = num(txt)
                if cid and v is not None and not colname.startswith("Candidat"):
                    hyp[cid] = v
            if hyp:
                cur["hyp"].append(hyp)
        if stop:
            break

    # Agrégation par sondage
    out_polls = []
    for p in polls:
        acc = {}
        for h in p["hyp"]:
            for cid, v in h.items():
                acc.setdefault(cid, []).append(v)
        out_polls.append({k: p[k] for k in ("pollster", "fieldwork", "end", "sample")} |
                         {"hypotheses": len(p["hyp"]),
                          "scores": {c: round(sum(v) / len(v), 2) for c, v in acc.items()}})

    def window_avg(ref, days):
        sel = [p for p in out_polls
               if ref - dt.timedelta(days=days) < dt.date.fromisoformat(p["end"]) <= ref]
        acc = {}
        for p in sel:
            for c, v in p["scores"].items():
                acc.setdefault(c, []).append(v)
        return sel, {c: round(sum(v) / len(v), 1) for c, v in acc.items()}

    window = 7
    sel, avg = window_avg(today, window)
    while not sel and window < 30:
        window += 7
        sel, avg = window_avg(today, window)
    _, prev = window_avg(today - dt.timedelta(days=window), window)

    # Série hebdomadaire (moyenne glissante 14 j) pour les courbes d'évolution
    series, d = [], HISTORY_START
    while d <= today:
        s, a = window_avg(d, 14)
        if s:
            series.append({"date": d.isoformat(), "scores": a})
        d += dt.timedelta(days=7)

    result = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "source": "Wikipédia — Liste de sondages sur l'élection présidentielle française de 2027",
        "source_url": URL,
        "window_days": window,
        "window_extended": window != 7,
        "average": dict(sorted(avg.items(), key=lambda kv: -kv[1])),
        "previous_average": prev,
        "polls_in_window": sel,
        "windows": {str(w): {"polls": len(window_avg(today, w)[0]),
                             "average": window_avg(today, w)[1],
                             "previous": window_avg(today - dt.timedelta(days=w), w)[1]}
                    for w in (7, 14, 30)},
        "series": series,
        "polls": out_polls,
    }
    (ROOT / "data/polls.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"{len(out_polls)} sondages, fenêtre {window} j ({len(sel)} sondage(s)) :", result["average"])


if __name__ == "__main__":
    main()
