#!/usr/bin/env python3
"""Relevé quotidien des abonnés de chaque candidat sur X, Instagram, TikTok, YouTube et
Facebook. Ajoute un point daté dans data/social.json (historique cumulatif).

Clés (variables d'environnement, à définir en secrets GitHub) :
  YOUTUBE_API_KEY  — API YouTube Data v3 (gratuite)            → YouTube
  APIFY_TOKEN      — compte Apify (quelques centimes / jour)    → X, Instagram, TikTok, Facebook
Sans clé, la plateforme concernée est simplement ignorée (dernier chiffre conservé).

Historique : la série depuis janvier 2026 est initialement une ESTIMATION (seed_social.py).
Au premier relevé réel, la série estimée est recalée (mise à l'échelle) sur le chiffre réel
pour que la courbe soit continue ; chaque point garde un indicateur `estimated`.
"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "data/social.json"

# Acteurs Apify (modifiables). Les noms de champs de sortie varient : on cherche le
# premier champ « abonnés » connu dans chaque élément renvoyé.
APIFY = {
    "instagram": ("apify~instagram-profile-scraper", lambda hs: {"usernames": hs}),
    "tiktok": ("clockworks~tiktok-profile-scraper", lambda hs: {"profiles": hs, "resultsPerPage": 1}),
    "x": ("xquik~x-profile-scraper", lambda hs: {"twitterHandles": hs, "maxItems": len(hs) + 5}),
    "facebook": ("apify~facebook-pages-scraper",
                 lambda hs: {"startUrls": [{"url": f"https://www.facebook.com/{h}"} for h in hs]}),
}
FOLLOWER_KEYS = ["followersCount", "followers", "followers_count", "fans", "subscriberCount"]
HANDLE_KEYS = ["sourceTarget", "inputUrl", "facebookUrl", "input", "username", "userName", "screen_name", "uniqueId", "name", "pageName", "pageUrl", "url"]


def http_json(url, data=None, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "Presidentielle2027Tracker/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def deep_find(o, keys):
    if isinstance(o, dict):
        for k in keys:
            if k in o and o[k] not in (None, ""):
                return o[k]
        for v in o.values():
            r = deep_find(v, keys)
            if r is not None:
                return r
    return None


def youtube_scrape(handle):
    """Secours sans clé : lit le nombre d'abonnés affiché sur la page de la chaîne."""
    import re
    req = urllib.request.Request("https://www.youtube.com/" + handle,
                                 headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    # en-tête de la chaîne (et non les chaînes recommandées plus bas dans la page)
    m = re.search(r'"metadataParts":\[\{"text":\{"content":"([\d.,]+)([KM]?) subscribers"', html)
    if not m:
        return None
    return round(float(m.group(1).replace(",", "")) * {"": 1, "K": 1e3, "M": 1e6}[m.group(2)])


def youtube_counts(cands):
    key = os.environ.get("YOUTUBE_API_KEY")
    out = {}
    if not key:
        for c in cands:
            h = c["social"].get("youtube")
            if h:
                try:
                    n = youtube_scrape(h)
                    if n:
                        out[c["id"]] = n
                except Exception as e:  # noqa: BLE001
                    print("youtube", c["id"], e)
        return out
    for c in cands:
        h = c["social"].get("youtube")
        if not h:
            continue
        q = {"part": "statistics", "key": key}
        q["forHandle" if h.startswith("@") else "id"] = h
        try:
            d = http_json("https://www.googleapis.com/youtube/v3/channels?" + urllib.parse.urlencode(q))
            out[c["id"]] = int(d["items"][0]["statistics"]["subscriberCount"])
        except Exception as e:  # noqa: BLE001
            print("youtube", c["id"], e)
    return out


def apify_counts(platform, cands):
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return {}
    actor, build = APIFY[platform]
    h2id = {c["social"][platform].lower(): c["id"] for c in cands if c["social"].get(platform)}
    if not h2id:
        return {}
    url = (f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?"
           + urllib.parse.urlencode({"token": token}))
    try:
        items = http_json(url, build(list(h2id)))
    except Exception as e:  # noqa: BLE001
        print("apify", platform, e)
        return {}
    out = {}
    for it in items:
        n = deep_find(it, FOLLOWER_KEYS)
        ident = str(deep_find(it, HANDLE_KEYS) or "").lower().rstrip("/").split("/")[-1].lstrip("@")
        cid = h2id.get(ident)
        if cid and isinstance(n, (int, float)):
            out[cid] = int(n)
    return out


def main():
    cands = json.loads((ROOT / "data/candidates.json").read_text())["candidates"]
    data = json.loads(FILE.read_text())
    today = dt.date.today().isoformat()

    if os.environ.get("SOCIAL_SNAPSHOT"):  # import manuel d'un relevé {plateforme: {id: n}}
        fresh = json.loads(Path(os.environ["SOCIAL_SNAPSHOT"]).read_text())
    else:
        fresh = {"youtube": youtube_counts(cands)}
        for p in APIFY:
            fresh[p] = apify_counts(p, cands)
    got = sum(len(v) for v in fresh.values())
    print("relevés réels :", {p: len(v) for p, v in fresh.items()})
    if not got:
        print("Aucune clé/relevé : historique inchangé.")
        return

    hist = data["history"]  # liste triée de {date, estimated, values:{cid:{platform:n}}}
    last = hist[-1]["values"]
    # Recalage de la série estimée sur la première valeur réelle de chaque (candidat, plateforme)
    real_seen = data.setdefault("real_seen", {})
    for p, vals in fresh.items():
        for cid, n in vals.items():
            k = f"{cid}:{p}"
            if k not in real_seen:
                est = (last.get(cid) or {}).get(p)
                if est:
                    ratio = n / est
                    for pt in hist:
                        if pt["estimated"] and cid in pt["values"] and p in pt["values"][cid]:
                            pt["values"][cid][p] = round(pt["values"][cid][p] * ratio)
                real_seen[k] = today

    # Les comptes inexistants (identifiant vide) sont retirés de la série estimée
    handles = {c["id"]: c["social"] for c in cands}
    for pt in hist:
        for cid, vals in pt["values"].items():
            for p in list(vals):
                if not handles.get(cid, {}).get(p):
                    del vals[p]

    values = json.loads(json.dumps(hist[-1]["values"]))  # on part du dernier point
    for p, vals in fresh.items():
        for cid, n in vals.items():
            values.setdefault(cid, {})[p] = n
    point = {"date": today, "estimated": False, "values": values}
    if hist[-1]["date"] == today:
        hist[-1] = point
    else:
        hist.append(point)
    data["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    FILE.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
