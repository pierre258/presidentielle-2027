#!/usr/bin/env python3
"""Collecte les « buzz » des 7 derniers jours pour chaque candidat et les classe en
bad buzz / bon buzz. Écrit data/buzz.json.

Sources (sans clé) :
  - Google News RSS (articles, passages TV commentés, polémiques)
  - Recherche YouTube « cette semaine » (vidéos intégrables)
Classement :
  - si ANTHROPIC_API_KEY est défini : Claude classe chaque élément (négatif / positif /
    neutre) et rédige une phrase de contexte ;
  - sinon : heuristique par mots-clés (moins fine, à titre de secours).
"""
import datetime as dt
import email.utils
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
MAIN = ["lepen", "melenchon", "philippe", "glucksmann", "lisnard", "attal", "retailleau",
        "zemmour", "bardella", "tondelier", "roussel", "villepin"]

NEG = ["polémique", "tollé", "bad buzz", "critiqu", "dérapage", "fustig", "recadr", "scandale",
       "accusé", "accuse", "condamn", "moqu", "gaffe", "chute", "décroch", "recul", "lynch",
       "se prend", "clash", "hué", "siffl", "mis en examen", "controverse", "indign", "s'emmêle",
       "malaise", "cafouill", "boulette", "tacl", "désaveu", "glisse", "dégringol", "perte de vitesse",
       "plus bas", "patine", "piège", "embarras", "épinglé", "huée", "colère", "démission", "attaqu"]
POS = ["percée", "ovation", "salué", "triomph", "record", "progress", "hausse", "carton", "viral",
       "remonte", "succès", "applaudi", "creuse l'écart", "dynamique", "s'impose", "en tête",
       "séduit", "plébiscit", "confirme sa", "surprise", "gagne", "décolle", "envolée", "favori",
       "domine", "s'installe", "rallie", "soutien de", "standing ovation", "buzz"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def google_news(query, since):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(f'"{query}" when:7d')
           + "&hl=fr&gl=FR&ceid=FR:fr")
    items = []
    for it in ET.fromstring(get(url)).iter("item"):
        title = html.unescape(it.findtext("title", ""))
        src = it.findtext("source", "")
        date = email.utils.parsedate_to_datetime(it.findtext("pubDate"))
        if date.date() < since:
            continue
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        items.append({"type": "article", "title": title, "source": src, "url": it.findtext("link"),
                      "date": date.date().isoformat()})
    return items


def youtube(query):
    # sp=EgIIAw%3D%3D : filtre « cette semaine »
    page = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
               + "&sp=EgIIAw%253D%253D")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", page, re.S)
    if not m:
        return []
    out = []

    def walk(o):
        if isinstance(o, dict):
            v = o.get("videoRenderer")
            if v:
                views = re.sub(r"\D", "", (v.get("viewCountText") or {}).get("simpleText", "") or "")
                out.append({"type": "video", "title": v["title"]["runs"][0]["text"],
                            "source": ((v.get("ownerText") or {}).get("runs") or [{}])[0].get("text", ""),
                            "url": "https://www.youtube.com/watch?v=" + v["videoId"],
                            "youtube_id": v["videoId"],
                            "published": (v.get("publishedTimeText") or {}).get("simpleText", ""),
                            "views": int(views) if views else 0})
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(json.loads(m.group(1)))
    return out


def heuristic(item):
    t = item["title"].lower()
    n = sum(k in t for k in NEG)
    p = sum(k in t for k in POS)
    if n > p:
        return "negative", None
    if p > n:
        return "positive", None
    return "neutral", None


def classify_with_claude(name, items):
    """Renvoie une liste [(label, résumé)] alignée sur items, ou None en cas d'échec."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not items:
        return None
    listing = "\n".join(f"{i}. [{it['type']}] {it['title']} — {it['source']}" for i, it in enumerate(items))
    prompt = (f"Voici des contenus médias des 7 derniers jours sur {name}, candidat(e) à la présidentielle "
              "française 2027. Pour chacun, indique s'il s'agit d'un moment défavorable au candidat "
              "(bad buzz : polémique, gaffe, recul, critique virale), favorable (bon buzz : séquence "
              "remarquée, percée, réplique virale, soutien) ou neutre. Réponds UNIQUEMENT en JSON : "
              '[{"i":0,"label":"negative|positive|neutral","why":"une phrase factuelle de contexte"}]\n\n'
              + listing)
    body = json.dumps({"model": os.environ.get("CLAUDE_MODEL", "claude-haiku-5-5"), "max_tokens": 4000,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        txt = json.load(urllib.request.urlopen(req, timeout=120))["content"][0]["text"]
        arr = json.loads(txt[txt.find("["): txt.rfind("]") + 1])
        res = [("neutral", None)] * len(items)
        for a in arr:
            if 0 <= a["i"] < len(items):
                res[a["i"]] = (a["label"], a.get("why"))
        return res
    except Exception as e:  # noqa: BLE001
        print("Claude indisponible, heuristique utilisée :", e)
        return None


def main():
    cands = {c["id"]: c for c in json.loads((ROOT / "data/candidates.json").read_text())["candidates"]}
    since = dt.date.today() - dt.timedelta(days=7)
    result = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
              "since": since.isoformat(),
              "classifier": "claude" if os.environ.get("ANTHROPIC_API_KEY") else "mots-clés",
              "candidates": {}}
    raw = {}
    for cid in MAIN:
        c = cands[cid]
        items = []
        try:
            items += google_news(c["name"], since)[:40]
        except Exception as e:  # noqa: BLE001
            print("news", cid, e)
        try:
            vids = [v for v in youtube(c["name"])
                    if c["short"].lower().split("-")[0] in v["title"].lower()][:15]
            items += vids
        except Exception as e:  # noqa: BLE001
            print("youtube", cid, e)
        raw[cid] = items
        labels = classify_with_claude(c["name"], items) or [heuristic(i) for i in items]
        neg, pos = [], []
        for it, (lab, why) in zip(items, labels):
            if why:
                it["context"] = why
            (neg if lab == "negative" else pos if lab == "positive" else []).append(it)

        def rank(lst):  # vidéos les plus vues d'abord, puis articles les plus récents
            return sorted(lst, key=lambda i: (i["type"] != "video", -i.get("views", 0), i.get("date", "")),
                          reverse=False)[:6]
        result["candidates"][cid] = {"negative": rank(neg), "positive": rank(pos),
                                     "volume": len(items)}
        print(cid, len(items), "éléments →", len(neg), "neg /", len(pos), "pos")
        time.sleep(1)
    (ROOT / "data/buzz.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    if os.environ.get("BUZZ_RAW"):
        Path(os.environ["BUZZ_RAW"]).write_text(json.dumps(raw, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
