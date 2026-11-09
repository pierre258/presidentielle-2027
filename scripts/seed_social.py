#!/usr/bin/env python3
"""À lancer UNE FOIS : crée data/social.json avec un historique ESTIMÉ (hebdomadaire) du
1er janvier 2026 à aujourd'hui. Les ordres de grandeur sont approximatifs et seront
recalés automatiquement par update_social.py dès le premier relevé réel."""
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ["x", "instagram", "tiktok", "youtube", "facebook"]
# Abonnés estimés aujourd'hui (milliers) et facteur de croissance depuis janvier,
# avec « inflexion » = moment (0..1) où la croissance accélère.
EST = {
    "lepen":        ({"x": 3000, "instagram": 550, "tiktok": 1100, "youtube": 250, "facebook": 1750}, 1.12, 0.6),
    "bardella":     ({"x": 1350, "instagram": 1400, "tiktok": 2300, "youtube": 200, "facebook": 900}, 1.22, 0.4),
    "melenchon":    ({"x": 2950, "instagram": 900, "tiktok": 2900, "youtube": 1050, "facebook": 1250}, 1.18, 0.8),
    "philippe":     ({"x": 600, "instagram": 250, "tiktok": 150, "youtube": 20, "facebook": 350}, 1.05, 0.3),
    "glucksmann":   ({"x": 550, "instagram": 450, "tiktok": 400, "youtube": 50, "facebook": 250}, 1.15, 0.5),
    "attal":        ({"x": 750, "instagram": 600, "tiktok": 900, "youtube": 30, "facebook": 200}, 1.08, 0.4),
    "lisnard":      ({"x": 120, "instagram": 60, "tiktok": 90, "youtube": 12, "facebook": 60}, 2.2, 0.75),
    "retailleau":   ({"x": 450, "instagram": 120, "tiktok": 150, "youtube": 10, "facebook": 100}, 1.3, 0.35),
    "zemmour":      ({"x": 1450, "instagram": 500, "tiktok": 800, "youtube": 550, "facebook": 500}, 1.04, 0.5),
    "tondelier":    ({"x": 250, "instagram": 250, "tiktok": 300, "youtube": 10, "facebook": 70}, 1.25, 0.5),
    "roussel":      ({"x": 400, "instagram": 150, "tiktok": 200, "youtube": 20, "facebook": 120}, 1.06, 0.5),
    "villepin":     ({"x": 150, "instagram": 80, "tiktok": 200, "youtube": 20, "facebook": 50}, 1.6, 0.7),
    "dupontaignan": ({"x": 500, "instagram": 40, "tiktok": 30, "youtube": 60, "facebook": 250}, 1.01, 0.5),
    "arthaud":      ({"x": 150, "instagram": 20, "tiktok": 20, "youtube": 5, "facebook": 30}, 1.03, 0.5),
}


def main():
    start, today = dt.date(2026, 1, 1), dt.date.today()
    span = (today - start).days
    dates = [start + dt.timedelta(days=d) for d in range(0, span, 7)] + [today]
    hist = []
    for d in dates:
        t = (d - start).days / span
        vals = {}
        for cid, (now, g, infl) in EST.items():
            # sigmoïde normalisée : 0 en janvier, 1 aujourd'hui
            s = lambda x: 1 / (1 + math.exp(-9 * (x - infl)))  # noqa: E731
            k = (s(t) - s(0)) / (s(1) - s(0))
            f = (1 / g) + (1 - 1 / g) * k
            vals[cid] = {p: round(n * 1000 * f) for p, n in now.items()}
        hist.append({"date": d.isoformat(), "estimated": True, "values": vals})
    data = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
            "platforms": PLATFORMS, "real_seen": {}, "history": hist}
    (ROOT / "data/social.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(len(hist), "points estimés")


if __name__ == "__main__":
    main()
