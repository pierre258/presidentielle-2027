#!/usr/bin/env python3
"""Collecte les « buzz » des 7 derniers jours pour chaque candidat et les classe en
bad buzz / bon buzz. Écrit data/buzz.json.

Sources (sans clé) :
  - Google News RSS (articles, passages TV commentés, polémiques)
  - Recherche YouTube « cette semaine » (vidéos intégrables)
  - Dailymotion (séquences des chaînes et médias : BFMTV, franceinfo, LCI, Le Parisien…)
Sources avec APIFY_TOKEN (quelques centimes par jour) :
  - X : publications les plus partagées citant le candidat
  - TikTok : vidéos de la semaine citant le candidat
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
MAIN = ["lepen", "melenchon", "philippe", "glucksmann", "lisnard", "attal", "retailleau", "riner",
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


def dailymotion(name, short, since):
    """Vidéos Dailymotion de la semaine (API publique, sans clé)."""
    q = urllib.parse.urlencode({
        "search": name, "created_after": int(dt.datetime.combine(since, dt.time()).timestamp()),
        "sort": "visited", "limit": 20, "language": "fr",
        "fields": "id,title,owner.screenname,views_total,created_time,allow_embed,url"})
    d = json.loads(get("https://api.dailymotion.com/videos?" + q))
    out = []
    for v in d.get("list", []):
        if not v.get("allow_embed") or short.lower().split("-")[0] not in v["title"].lower():
            continue
        out.append({"type": "video", "platform": "dailymotion", "title": v["title"],
                    "source": v.get("owner.screenname", ""), "url": v.get("url") or f"https://www.dailymotion.com/video/{v['id']}",
                    "dailymotion_id": v["id"], "views": int(v.get("views_total") or 0),
                    "date": dt.date.fromtimestamp(v["created_time"]).isoformat()})
    return out


def apify(actor, payload):
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return []
    url = f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?" + urllib.parse.urlencode({"token": token})
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def x_posts(name, since):
    """Publications X les plus partagées de la semaine citant le candidat (Apify)."""
    items = apify("apidojo~tweet-scraper", {"searchTerms": [f'"{name}" min_faves:300'], "sort": "Top",
                                             "tweetLanguage": "fr", "start": since.isoformat(), "maxItems": 10})
    return [x_item(t) for t in items if t.get("id") and t.get("text")]


def x_item(t):
    a = t.get("author") or {}
    return {"type": "post", "platform": "x", "title": (t.get("text") or "")[:280], "source": "@" + (a.get("userName") or "?"),
            "url": t.get("url") or t.get("twitterUrl"), "x_id": str(t["id"]),
            "views": int(t.get("viewCount") or 0), "likes": int(t.get("likeCount") or 0),
            "date": (t.get("createdAt") and dt.datetime.strptime(t["createdAt"], "%a %b %d %H:%M:%S %z %Y").date().isoformat()) or ""}


def tiktok(name):
    """Vidéos TikTok de la semaine citant le candidat (Apify)."""
    items = apify("clockworks~tiktok-scraper", {"searchQueries": [name], "searchSection": "/video",
                                                 "videoSearchDateFilter": "PAST_WEEK", "resultsPerPage": 8})
    return [tiktok_item(v) for v in items if v.get("id") and v.get("webVideoUrl")]


def tiktok_item(v):
    a = v.get("authorMeta") or {}
    return {"type": "video", "platform": "tiktok", "title": (v.get("text") or "")[:200] or "Vidéo TikTok",
            "source": "@" + (a.get("name") or "?"), "url": v["webVideoUrl"], "tiktok_id": str(v["id"]),
            "views": int(v.get("playCount") or 0), "likes": int(v.get("diggCount") or 0),
            "date": (v.get("createTimeISO") or "")[:10]}


# Comptes Instagram « alliés » dont les publications concernent un candidat (co-publications, mouvement)
IG_ALLIES = {"franceinsoumise": "melenchon", "nouv_energie": "lisnard", "nordavecroussel": "roussel"}
IG_SKIP = re.compile(r"#(bion3|tdy)\b|lien en bio →|code promo|partenariat", re.I)


def instagram_all(cands, since):
    """Reels et posts Instagram de la semaine des comptes officiels des candidats (Apify, un seul passage)."""
    handles = {c["social"].get("instagram"): cid for cid, c in cands.items() if c.get("social", {}).get("instagram")}
    if not handles:
        return {}
    items = apify("apify~instagram-scraper", {"directUrls": [f"https://www.instagram.com/{h}/" for h in handles],
                                                "resultsType": "posts", "resultsLimit": 6,
                                                "onlyPostsNewerThan": "7 days", "addParentData": False})
    out = {}
    for p in items:
        owner = (p.get("ownerUsername") or "").lower()
        m = re.search(r"instagram\.com/([^/]+)/", p.get("inputUrl") or "")
        cid = handles.get(owner) or IG_ALLIES.get(owner) or (m and handles.get(m.group(1)))
        if not cid or not p.get("shortCode") or p.get("paidPartnership") or IG_SKIP.search(p.get("caption") or ""):
            continue
        if (p.get("timestamp") or "")[:10] < since.isoformat():
            continue
        out.setdefault(cid, []).append(instagram_item(p))
    for cid in out:
        out[cid] = sorted(out[cid], key=lambda i: -(i.get("views") or i.get("likes") or 0))[:3]
    return out


def instagram_item(p):
    reel = p.get("productType") == "clips" or p.get("type") == "Video"
    cap = (p.get("caption") or "").strip().split("\n")[0][:200]
    return {"type": "post", "platform": "instagram", "title": cap or ("Reel Instagram" if reel else "Publication Instagram"),
            "source": "@" + (p.get("ownerUsername") or "?"), "url": p.get("url") or f"https://www.instagram.com/p/{p['shortCode']}/",
            "instagram_code": p["shortCode"], "instagram_kind": "reel" if reel else "p",
            "views": int(p.get("videoPlayCount") or p.get("videoViewCount") or 0), "likes": max(0, int(p.get("likesCount") or 0)),
            "date": (p.get("timestamp") or "")[:10], "context": "Publication du compte Instagram officiel" if not reel else "Reel du compte Instagram officiel"}


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
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("BUZZ_ALLOW_KEYWORDS"):
        # Sans Claude, le tri par mots-clés est trop approximatif : on conserve la sélection
        # existante (BUZZ_ALLOW_KEYWORDS=1 pour forcer le mode mots-clés).
        print("ANTHROPIC_API_KEY absent : buzz.json conservé tel quel.")
        return
    cands = {c["id"]: c for c in json.loads((ROOT / "data/candidates.json").read_text())["candidates"]}
    since = dt.date.today() - dt.timedelta(days=7)
    result = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
              "since": since.isoformat(),
              "classifier": "claude" if os.environ.get("ANTHROPIC_API_KEY") else "mots-clés",
              "candidates": {}}
    raw = {}
    try:
        insta = instagram_all({k: cands[k] for k in MAIN}, since)
    except Exception as e:  # noqa: BLE001
        print("instagram", e)
        insta = {}
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
        for label, fn in (("dailymotion", lambda: dailymotion(c["name"], c["short"], since)[:10]),
                          ("x", lambda: x_posts(c["name"], since)),
                          ("tiktok", lambda: tiktok(c["name"]))):
            try:
                items += fn()
            except Exception as e:  # noqa: BLE001
                print(label, cid, e)
        items += insta.get(cid, [])
        raw[cid] = items
        labels = classify_with_claude(c["name"], items) or [heuristic(i) for i in items]
        neg, pos = [], []
        for it, (lab, why) in zip(items, labels):
            if why:
                it["context"] = why
            (neg if lab == "negative" else pos if lab == "positive" else []).append(it)

        def rank(lst):  # contenus les plus vus d'abord, puis articles les plus récents
            return sorted(lst, key=lambda i: (i["type"] == "article", -i.get("views", 0), i.get("date", "")),
                          reverse=False)[:8]
        result["candidates"][cid] = {"negative": rank(neg), "positive": rank(pos),
                                     "volume": len(items)}
        print(cid, len(items), "éléments →", len(neg), "neg /", len(pos), "pos")
        time.sleep(1)
    (Path(os.environ["BUZZ_OUT"]) if os.environ.get("BUZZ_OUT") else ROOT / "data/buzz.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1))
    if os.environ.get("BUZZ_RAW"):
        Path(os.environ["BUZZ_RAW"]).write_text(json.dumps(raw, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
