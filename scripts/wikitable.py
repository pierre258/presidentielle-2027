"""Parseur HTML minimaliste des tableaux Wikipédia (gère rowspan/colspan)."""
from html.parser import HTMLParser
import re


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._stack = [], []
        self._cell = None
        self._skip = 0  # profondeur dans <sup>/<style>

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("sup", "style", "script"):
            self._skip += 1
        if tag == "table":
            self._stack.append({"cls": a.get("class", ""), "rows": []})
        elif not self._stack:
            return
        elif tag == "tr":
            self._stack[-1]["rows"].append([])
        elif tag in ("td", "th"):
            self._cell = {"text": "", "rowspan": int(re.sub(r"\D", "", a.get("rowspan", "1")) or 1),
                          "colspan": int(re.sub(r"\D", "", a.get("colspan", "1")) or 1),
                          "style": a.get("style", ""), "links": []}
        elif tag == "a" and self._cell is not None:
            self._cell["links"].append(a.get("title", ""))
        elif tag == "br" and self._cell is not None:
            self._cell["text"] += " "

    def handle_endtag(self, tag):
        if tag in ("sup", "style", "script"):
            self._skip = max(0, self._skip - 1)
        if not self._stack:
            return
        if tag in ("td", "th") and self._cell is not None:
            self._cell["text"] = re.sub(r"\s+", " ", self._cell["text"]).strip()
            if self._stack[-1]["rows"]:
                self._stack[-1]["rows"][-1].append(self._cell)
            self._cell = None
        elif tag == "table":
            self.tables.append(self._stack.pop())

    def handle_data(self, data):
        if self._cell is not None and not self._skip:
            self._cell["text"] += data


def parse_tables(html, cls="wikitable"):
    """Retourne une liste de tableaux ; chaque tableau = liste de lignes de cellules
    (dict text/links/style), avec rowspan/colspan déroulés."""
    p = _TableParser()
    p.feed(html)
    out = []
    for t in p.tables:
        if cls not in t["cls"]:
            continue
        grid, pending = [], {}  # pending[col] = (cell, remaining)
        for raw in t["rows"]:
            row, col, it = [], 0, iter(raw)
            nxt = next(it, None)
            while nxt is not None or col in pending:
                if col in pending:
                    cell, rem = pending[col]
                    row.append(cell)
                    pending[col] = (cell, rem - 1) if rem > 1 else None
                    if pending[col] is None:
                        del pending[col]
                    col += 1
                    continue
                for _ in range(nxt["colspan"]):
                    row.append(nxt)
                    if nxt["rowspan"] > 1:
                        pending[col] = (nxt, nxt["rowspan"] - 1)
                    col += 1
                nxt = next(it, None)
            grid.append(row)
        out.append(grid)
    return out
