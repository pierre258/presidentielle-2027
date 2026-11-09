#!/usr/bin/env python3
"""Récupère la photo de chaque candidat via l'API REST de Wikipédia (images Wikimedia
Commons, licences libres) et écrit data/photos.json : {id: {url, page, credit}}."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Presidentielle2027Tracker/1.0"


def main():
    cands = json.loads((ROOT / "data/candidates.json").read_text())["candidates"]
    path = ROOT / "data/photos.json"
    out = json.loads(path.read_text()) if path.exists() else {}  # on garde l'existant si une requête échoue
    for c in cands:
        time.sleep(0.5)
        url = "https://fr.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(c["wiki"])
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            d = json.load(urllib.request.urlopen(req, timeout=30))
            thumb = (d.get("thumbnail") or {}).get("source", "").split("?")[0]
            if thumb:
                out[c["id"]] = {"url": thumb, "page": d["content_urls"]["desktop"]["page"],
                                "credit": "Wikimedia Commons"}
        except Exception as e:  # noqa: BLE001
            print("photo", c["id"], e)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(len(out), "photos")


if __name__ == "__main__":
    main()
