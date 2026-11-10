/* Présidentielle 2027 — front-end statique. Lit les fichiers data/*.json générés chaque jour. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtPct = (v) => (Math.round(v * 10) / 10).toLocaleString("fr-FR");
  const fmtN = (n) => n >= 1e6 ? (n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M"
    : n >= 1e3 ? Math.round(n / 1e3).toLocaleString("fr-FR") + " k" : Math.round(n).toLocaleString("fr-FR");
  const fmtDate = (d, opt = { day: "numeric", month: "long", year: "numeric" }) => new Date(d).toLocaleDateString("fr-FR", opt);
  const DAY = 864e5;

  let C = {}, POLLS, SOCIAL, BUZZ, PROG, PDET, SIM, HIST;

  /* Pictos réseaux sociaux (formes simplifiées, liens vers les comptes officiels) */
  const SOC = {
    x: ["X", (h) => `https://x.com/${h}`, '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'],
    instagram: ["Instagram", (h) => `https://www.instagram.com/${h}/`, '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.3" fill="currentColor"/>'],
    tiktok: ["TikTok", (h) => `https://www.tiktok.com/@${h}`, '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M14 3c.6 3 2.6 4.7 5.5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'],
    youtube: ["YouTube", (h) => `https://www.youtube.com/${h}`, '<rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor"/><path d="M10 9l5 3-5 3z" fill="#0b1030"/>'],
    facebook: ["Facebook", (h) => `https://www.facebook.com/${h}`, '<path d="M14.5 21v-7.5H17l.5-3h-3V8.7c0-.9.3-1.5 1.6-1.5h1.5V4.5c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.2H9v3h2.5V21z" fill="currentColor"/>'],
  };
  const socialLinks = (id, size = 18) => {
    const s = C[id]?.social || {};
    return `<span class="soc">${Object.entries(SOC).filter(([k]) => s[k]).map(([k, [label, url, svg]]) =>
      `<a href="${esc(url(s[k]))}" target="_blank" rel="noopener" title="${esc(C[id].name)} sur ${label}" aria-label="${esc(C[id].name)} sur ${label}" class="soc-${k}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${svg}</svg></a>`).join("")}</span>`;
  };

  const avatar = (id, size = 44) => {
    const c = C[id] || { name: id, color: "#888" };
    if (c.photo) return `<img class="av" src="${esc(c.photo)}" alt="${esc(c.name)}" width="${size}" height="${size}" loading="lazy" style="--c:${c.color};width:${size}px;height:${size}px">`;
    const ini = c.name.split(/[\s-]+/).map((w) => w[0]).slice(0, 2).join("");
    return `<span class="av av-init" style="--c:${c.color};width:${size}px;height:${size}px;background:${c.color};font-size:${size / 2.6}px">${esc(ini)}</span>`;
  };

  /* ---------------- Compte à rebours jusqu'au vote ---------------- */
  // Dates annoncées en Conseil des ministres le 1er juillet 2026 (décret attendu avant le 7 février 2027)
  const TOURS = [{ label: "1er tour", date: new Date(2027, 3, 18) }, { label: "2nd tour", date: new Date(2027, 4, 2) }];
  function countdown() {
    const box = $("#countdown");
    if (!box) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const next = TOURS.find((t) => t.date >= today);
    if (!next) { box.textContent = "Terminée"; return; }
    const days = Math.round((next.date - today) / DAY);
    const when = next.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    box.textContent = days === 0 ? "Aujourd'hui !" : `J-${days}`;
    box.title = `${next.label} : ${when} — cliquez pour préparer votre vote`;
  }
  // le compte à rebours est dans le lien du logo : il ouvre « Prêt à voter ? » au lieu de l'accueil
  const goVote = (e) => { if (e.target.closest("#countdown") && (e.type === "click" || e.key === "Enter")) { e.preventDefault(); e.stopPropagation(); location.hash = "#jevote"; } };
  document.addEventListener("click", goVote, true);
  document.addEventListener("keydown", goVote, true);
  countdown();
  setInterval(countdown, 60 * 1000); // passe au jour suivant à minuit sans recharger

  /* ---------------- Onglets ---------------- */
  const shown = new Set();
  function showTab(id) {
    id = (id || "").split("?")[0];
    // anciennes rubriques devenues des volets de « Candidats »
    const sub = { simulateur: "impact", portrait: "conv" }[id];
    if (sub) { id = "programmes"; setTimeout(() => window.ProgView?.(sub), 0); }
    const parlement = id === "parlement";
    if (parlement) id = "programmes";
    if (!/^[a-z]+$/.test(id) || !$("#" + id)) id = "sondages";
    $$(".panel").forEach((p) => (p.hidden = p.id !== id));
    document.body.dataset.tab = id;
    // le portrait (pictos + questionnaire) s'affiche dans « Que votent mes amis ? » ou dans le volet convictions
    const PA = $("#portrait-app");
    if (PA && id === "fun" && PA.parentNode !== $("#fun")) $("#fun-app").after(PA);
    $$(".tab[data-tab]").forEach((t) => t.classList.toggle("on", t.dataset.tab === id));
    // liste déroulante : la rubrique affichée devient le libellé du bouton
    const sel = $(`#more-menu a[data-tab="${parlement ? "parlement" : id}"]`);
    $$("#more-menu a").forEach((a) => a.classList.toggle("on", a === sel));
    $("#more-btn")?.classList.toggle("on", !!sel);
    if ($("#more-label")) $("#more-label").textContent = sel ? sel.querySelector("b").textContent : "Toutes les rubriques";
    closeMore();
    if (id === "reseaux" && !shown.has(id)) setTimeout(() => Social.play(), 250);
    shown.add(id);
    if ($("#" + id).classList.contains("legal") || document.activeElement?.closest?.(".site-foot")) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  function closeMore() { const m = $("#more-menu"); if (m) { m.hidden = true; $("#more-btn").setAttribute("aria-expanded", "false"); } }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#more-btn");
    if (b) { const m = $("#more-menu"); m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); return; }
    if (!e.target.closest("#more-menu")) closeMore();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMore(); });

  /* ---------------- 1. Sondages ---------------- */
  function renderPolls(w = "30") {
    const isEvo = w === "evo";
    $("#poll-bars").hidden = isEvo; $("#poll-evo").hidden = !isEvo;
    $(".poll-card").classList.toggle("evo", isEvo);
    if (isEvo) return Evo.show();
    Evo.stop();
    $(".poll-card-title").innerHTML = "<span>Présidentielle 2027 :</span> moyenne des sondages";
    const win = POLLS.windows[w];
    const rows = Object.entries(win.average).filter(([id]) => C[id]).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    $("#poll-bars").innerHTML = rows.map(([id, v], i) => {
      const big = i < 4, c = C[id], prev = win.previous[id];
      const d = prev == null ? null : Math.round((v - prev) * 10) / 10;
      const delta = d == null ? "" : `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : "eq"}">${d > 0 ? "▲ +" : d < 0 ? "▼ " : "= "}${d ? fmtPct(d) : ""}${d ? " pt" : ""}</span>`;
      return `<div class="prow ${big ? "" : "small"}" data-cand="${id}" role="link" tabindex="0" title="Voir la fiche de ${esc(c.name)}">
        ${avatar(id, big ? 58 : 34)}
        <div><div class="name">${esc(c.name)} <span class="party">${esc(c.party)}</span></div>
          <div class="bar"><i data-w="${(v / max) * 100}" style="background:${big ? "#fff" : "rgba(255,255,255,.85)"}"></i></div></div>
        <div><div class="score">${fmtPct(v)}<sup>%</sup></div>${delta}</div>
      </div>`;
    }).join("");
    requestAnimationFrame(() => $$("#poll-bars .bar i").forEach((b) => (b.style.width = b.dataset.w + "%")));
    if (!$("#poll-bars").dataset.bound) {
      $("#poll-bars").dataset.bound = "1";
      const go = (e) => { const r = e.target.closest(".prow[data-cand]"); if (r && window.ProgSelect) window.ProgSelect(r.dataset.cand); };
      $("#poll-bars").addEventListener("click", go);
      $("#poll-bars").addEventListener("keydown", (e) => { if (e.key === "Enter") go(e); });
    }

    const n = win.polls;
    const sel = POLLS.polls.filter((p) => (Date.now() - new Date(p.end)) / DAY <= +w + 1);
    $("#poll-meta").innerHTML = `Moyenne de <strong>${n} sondage${n > 1 ? "s" : ""}</strong> dont le terrain s'achève dans les ${w} derniers jours`
      + (n < 2 ? ` — <span style="color:#ffe08a">peu de sondages sur la période, élargissez la fenêtre pour une moyenne plus robuste</span>` : "")
      + `. Flèches : évolution par rapport aux ${w} jours précédents.`;
    $("#poll-sources").textContent = "Sondages " + [...new Set(sel.map((p) => p.pollster))].join(", ") + " · Source : " + POLLS.source.split(" — ")[0];

    $("#poll-table").innerHTML = `<thead><tr><th>Institut</th><th>Terrain</th><th>Échantillon</th><th>Hyp.</th>${rows.slice(0, 7).map(([id]) => `<th>${esc(C[id].short)}</th>`).join("")}</tr></thead><tbody>`
      + POLLS.polls.slice(0, 20).map((p) => `<tr style="${sel.includes(p) ? "" : "opacity:.55"}"><td>${esc(p.pollster)}</td><td>${esc(p.fieldwork)} ${new Date(p.end).getFullYear()}</td><td>${esc(Number(p.sample).toLocaleString("fr-FR"))}</td><td>${p.hypotheses}</td>${rows.slice(0, 7).map(([id]) => `<td>${p.scores[id] != null ? fmtPct(p.scores[id]) : "—"}</td>`).join("")}</tr>`).join("")
      + "</tbody>";
  }

  function renderDuels() {
    const D = (POLLS.second_round || []).filter((d) => C[d.a] && C[d.b]);
    const fresh = (d) => (Date.now() - new Date(d.last)) / DAY <= 45;
    const card = (d) => {
      const col = (id) => (C[id].color === "#404040" ? "#8a8f98" : C[id].color);
      const winA = d.avg_a >= d.avg_b;
      return `<div class="duel ${fresh(d) ? "" : "old"}">
        <div class="duel-top"><div class="duel-side">${avatar(d.a, 40)}${esc(C[d.a].short)}</div><div class="duel-side r">${avatar(d.b, 40)}${esc(C[d.b].short)}</div></div>
        <div class="duel-pct"><span style="${winA ? "" : "opacity:.7"}">${fmtPct(d.avg_a)} %</span><span style="${winA ? "opacity:.7" : ""}">${fmtPct(d.avg_b)} %</span></div>
        <div class="duel-bar"><i style="width:${d.avg_a}%;background:${col(d.a)}"></i><i style="width:${d.avg_b}%;background:${col(d.b)}"></i></div>
        <div class="duel-meta">${d.n} sondage${d.n > 1 ? "s" : ""} (${d.window === "15 jours" ? "15 derniers jours" : "derniers disponibles"}) · dernier : ${esc(d.polls[0].pollster)}, ${fmtDate(d.last, { day: "numeric", month: "short", year: "numeric" })}</div>
      </div>`;
    };
    const recent = D.filter(fresh), old = D.filter((d) => !fresh(d));
    $("#duel-meta").textContent = "Intentions de vote au second tour selon les duels testés par les instituts (moyenne des sondages des 15 derniers jours ; à défaut, des derniers disponibles).";
    $("#duels").innerHTML = recent.map(card).join("") || `<div class="empty">Aucun duel testé récemment.</div>`;
    if (old.length) {
      const btn = document.createElement("button");
      btn.className = "old-toggle";
      btn.textContent = `Afficher ${old.length} duel(s) plus ancien(s) (hypothèse Bardella, etc.)`;
      btn.onclick = () => { $("#duels").insertAdjacentHTML("beforeend", old.map(card).join("")); btn.remove(); };
      $("#duels").after(btn);
    }
  }

  /* Évolution animée (20 s) : familles politiques 2002-2027 ou candidats 2022-2027 */
  const Evo = (() => {
    const DUR = 20000;
    let raf = 0, mode = "fam", ready = false, M, x, y, ymax;
    const W = 980, H = 440, L = 40, R = 165, T = 16, B = 30;
    const colC = (id) => (C[id].color === "#404040" ? "#9aa0a6" : C[id].color);

    // Modèle : séries [{key,label,color,p:[[ms,v]]}], bornes de temps, marqueurs d'élection
    function model(m) {
      const E = POLLS.evolution;
      const polls = E.monthly.map((q) => ({ ms: +new Date(q.month + "-15"), q }));
      const nowMs = +new Date(E.current.date);
      if (m === "cand") {
        const top = Object.entries(E.current.scores).filter(([id]) => C[id]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
        const series = top.map((id) => ({
          key: id, label: C[id].short, color: colC(id),
          p: [...polls.filter((o) => o.q.scores[id] != null).map((o) => [o.ms, o.q.scores[id]]), [nowMs, E.current.scores[id]]].filter((o) => o[1] != null),
        })).filter((s) => s.p.length);
        return { series, t0: polls[0].ms, t1: nowMs, markers: [], warp: null, dash: 0 };
      }
      const elec = HIST.elections.map((e) => {
        const f = {};
        e.candidates.forEach(([, k, v]) => (f[k] = (f[k] || 0) + v));
        return { ms: +new Date(e.date), year: e.year, f };
      });
      const last = elec[elec.length - 1];
      // lissage : moyenne pondérée (nombre de sondages) du mois et des deux mois voisins
      const fp = polls.filter((o) => Object.keys(o.q.families || {}).length);
      const smooth = fp.map((o, i) => {
        const win = fp.slice(Math.max(0, i - 1), i + 2);
        const w = win.reduce((a, b) => a + b.q.n, 0);
        const f = {};
        HIST.families.forEach((fa) => (f[fa.id] = win.reduce((a, b) => a + (b.q.families[fa.id] || 0) * b.q.n, 0) / w));
        return { ms: o.ms, f };
      });
      const series = HIST.families.map((fa) => ({
        key: fa.id, label: fa.label, color: fa.color,
        p: [...elec.map((e) => [e.ms, e.f[fa.id] || 0]),
          ...smooth.map((o) => [o.ms, o.f[fa.id]]),
          [nowMs, (E.current.families || {})[fa.id] || 0]],
      }));
      // 55 % de la durée et de la largeur pour 2002-2022, 45 % pour la campagne 2027
      return { series, t0: elec[0].ms, t1: nowMs, markers: elec, warp: { split: last.ms, at: 0.55 }, dash: last.ms };
    }
    const tToMs = (t) => {
      const w = M.warp;
      if (!w) return M.t0 + (M.t1 - M.t0) * t;
      return t < w.at ? M.t0 + (w.split - M.t0) * (t / w.at) : w.split + (M.t1 - w.split) * ((t - w.at) / (1 - w.at));
    };

    function build() {
      M = model(mode);
      ymax = Math.ceil(Math.max(...M.series.flatMap((s) => s.p.map((q) => q[1]))) / 5) * 5 + 5;
      const span = W - L - R;
      x = M.warp
        ? (ms) => (ms <= M.warp.split ? L + ((ms - M.t0) / (M.warp.split - M.t0)) * span * M.warp.at
          : L + span * M.warp.at + ((ms - M.warp.split) / (M.t1 - M.warp.split)) * span * (1 - M.warp.at))
        : (ms) => L + ((ms - M.t0) / (M.t1 - M.t0)) * span;
      y = (v) => T + (1 - v / ymax) * (H - T - B);
      let g = "";
      for (let v = 0; v <= ymax; v += 5) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${L - 8}" y="${y(v) + 4}" fill="#a5addb" font-size="11" text-anchor="end">${v}%</text>`;
      if (M.markers.length) {
        M.markers.forEach((e) => { g += `<line x1="${x(e.ms)}" x2="${x(e.ms)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.18)"/><text x="${x(e.ms)}" y="${H - 10}" fill="#fff" font-size="12" font-weight="700" text-anchor="middle">${e.year}</text>`; });
        for (let yr = 2023; yr <= new Date(M.t1).getFullYear(); yr++) { const ms = +new Date(yr + "-01-01"); g += `<line x1="${x(ms)}" x2="${x(ms)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.08)" stroke-dasharray="3 5"/><text x="${x(ms)}" y="${H - 10}" fill="#a5addb" font-size="11" text-anchor="middle">${yr}</text>`; }
        g += `<rect x="${x(M.warp.split)}" y="${T}" width="${x(M.t1) - x(M.warp.split)}" height="${H - T - B}" fill="rgba(255,45,85,.05)"/><text x="${(x(M.warp.split) + x(M.t1)) / 2}" y="${T + 14}" fill="#ff8fa6" font-size="12" font-weight="700" text-anchor="middle">Campagne 2027 (échelle élargie)</text>`;
      } else {
        for (let yr = new Date(M.t0).getFullYear() + 1; yr <= new Date(M.t1).getFullYear(); yr++) {
          const ms = +new Date(yr + "-01-01");
          g += `<line x1="${x(ms)}" x2="${x(ms)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 5"/><text x="${x(ms) + 4}" y="${H - 10}" fill="#a5addb" font-size="12" font-weight="600">${yr}</text>`;
        }
      }
      const pts = (arr) => `points="${arr.map((q) => x(q[0]) + "," + y(q[1])).join(" ")}"`;
      const lines = M.series.map((s) => {
        if (!M.dash) return `<polyline fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" ${pts(s.p)}/>`;
        const a = s.p.filter((q) => q[0] <= M.dash), b = s.p.filter((q) => q[0] >= M.dash);
        const dots = a.map((q) => `<circle cx="${x(q[0])}" cy="${y(q[1])}" r="4.5" fill="${s.color}"/>`).join("");
        return `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="5 5" opacity=".75" ${pts(a)}/>${dots}<polyline fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" ${pts(b)}/>`;
      }).join("");
      const heads = M.series.map((s) => `<g class="evo-head" data-k="${s.key}"><circle r="6" fill="${s.color}" stroke="#0b1030" stroke-width="2"/><text x="12" y="4" fill="#fff" font-size="13" font-weight="700"></text></g>`).join("");
      $("#evo-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des intentions de vote">
        <defs><clipPath id="evo-clip"><rect id="evo-clip-r" x="${L - 6}" y="0" height="${H}" width="0"/></clipPath></defs>${g}<g clip-path="url(#evo-clip)">${lines}</g>${heads}</svg>`;
      $("#evo-legend").innerHTML = mode === "fam"
        ? `<span><i style="background:repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 10px)"></i>Résultats officiels (points), reliés d'une élection à l'autre</span><span><i style="background:#fff"></i>Sondages 2027 (moyenne mensuelle lissée sur 3 mois)</span>`
          + HIST.families.map((f) => `<span><i style="background:${f.color}"></i>${esc(f.label)}</span>`).join("")
        : "";
      const E = POLLS.evolution, n = E.monthly.reduce((a, q) => a + q.n, 0);
      $(".poll-card-title").innerHTML = mode === "fam"
        ? "<span>Présidentielles 2002-2027 :</span> 1er tour par famille politique"
        : "<span>Présidentielle 2027 :</span> intentions de vote depuis 2022";
      $("#poll-meta").innerHTML = mode === "fam"
        ? `Résultats officiels du 1<sup>er</sup> tour de 2002, 2007, 2012, 2017 et 2022, puis moyenne mensuelle de <strong>${n} sondages</strong> pour 2027, regroupés par famille politique, jusqu'à la tendance des ${E.current.window} derniers jours. Le classement des candidats par famille est un choix éditorial (ex. Macron et Bayrou au centre, Zemmour à l'extrême droite, Dupont-Aignan et Lassalle chez les souverainistes).`
        : `Moyenne mensuelle de <strong>${n} sondages</strong> depuis ${fmtDate(M.t0, { month: "long", year: "numeric" })}, jusqu'à la tendance des ${E.current.window} derniers jours (${E.current.n} sondage${E.current.n > 1 ? "s" : ""}). Avant 2026, les hypothèses de candidats testées varient d'un sondage à l'autre.`;
      $("#poll-sources").textContent = mode === "fam"
        ? "Sources : Conseil constitutionnel (résultats 2002-2022) · Wikipédia, liste des sondages 2027"
        : "Source : " + POLLS.source.split(" — ")[0];
    }

    function valAt(s, ms) {
      const p = s.p;
      if (ms < p[0][0]) return null;
      if (ms >= p[p.length - 1][0]) return p[p.length - 1][1];
      for (let i = 1; i < p.length; i++) {
        if (p[i][0] >= ms) { const k = (ms - p[i - 1][0]) / (p[i][0] - p[i - 1][0] || 1); return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k; }
      }
      return null;
    }
    function frame(t) {
      const ms = tToMs(t);
      $("#evo-clip-r").setAttribute("width", Math.max(0, x(ms) - L + 8));
      const heads = M.series.map((s) => ({ s, v: valAt(s, ms) }));
      const placed = heads.filter((h) => h.v != null).map((h) => ({ ...h, ly: y(h.v) })).sort((a, b) => a.ly - b.ly);
      placed.forEach((h, i) => { if (i && h.ly - placed[i - 1].ly < 16) h.ly = placed[i - 1].ly + 16; });
      heads.forEach((h) => {
        const g = $(`#evo-chart .evo-head[data-k="${h.s.key}"]`);
        if (h.v == null) { g.style.display = "none"; return; }
        g.style.display = "";
        const pl = placed.find((p) => p.s === h.s);
        g.setAttribute("transform", `translate(${x(ms)},${y(h.v)})`);
        const tx = g.querySelector("text");
        tx.setAttribute("y", pl.ly - y(h.v) + 4);
        tx.textContent = `${h.s.label} ${fmtPct(Math.round(h.v * 10) / 10)} %`;
      });
      const elecNow = M.markers.find((e) => Math.abs(e.ms - ms) < 120 * DAY);
      $("#evo-date").textContent = t >= 0.999 ? `2027 · tendance ${POLLS.evolution.current.window} derniers jours`
        : elecNow ? `Présidentielle ${elecNow.year}`
        : fmtDate(ms, mode === "fam" && ms < M.dash ? { year: "numeric" } : { month: "long", year: "numeric" });
      $("#evo-scrub").value = Math.round(t * 1000);
    }
    function play() {
      cancelAnimationFrame(raf);
      const start = performance.now();
      const step = (now) => { const k = Math.min(1, (now - start) / DUR); frame(k); if (k < 1) raf = requestAnimationFrame(step); };
      frame(0);
      raf = requestAnimationFrame(step);
    }
    function show() {
      if (!ready) {
        ready = true;
        $("#evo-play").addEventListener("click", play);
        $("#evo-scrub").addEventListener("input", (e) => { cancelAnimationFrame(raf); frame(e.target.value / 1000); });
        $("#evo-mode").addEventListener("click", (e) => {
          const b = e.target.closest("button"); if (!b) return;
          $$("#evo-mode button").forEach((q) => q.classList.toggle("on", q === b));
          mode = b.dataset.m; build(); play();
        });
      }
      build();
      play();
    }
    return { show, stop: () => cancelAnimationFrame(raf) };
  })();

  function renderTrend() {
    const S = POLLS.series;
    if (!S.length) return;
    const ids = Object.entries(POLLS.windows["30"].average).filter(([id]) => C[id]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
    const W = 900, H = 320, L = 36, R = 120, T = 14, B = 28;
    const t0 = +new Date(S[0].date), t1 = +new Date(S[S.length - 1].date);
    const ymax = Math.ceil(Math.max(...S.flatMap((s) => ids.map((id) => s.scores[id] || 0))) / 5) * 5;
    const x = (d) => L + ((+new Date(d) - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - v / ymax) * (H - T - B);
    let g = "";
    for (let v = 0; v <= ymax; v += 5) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 8}" y="${y(v) + 4}" fill="#a5addb" font-size="11" text-anchor="end">${v}</text>`;
    const months = new Set();
    S.forEach((s) => { const m = s.date.slice(0, 7); if (!months.has(m)) { months.add(m); g += `<text x="${x(s.date)}" y="${H - 8}" fill="#a5addb" font-size="11">${fmtDate(s.date, { month: "short" })}</text>`; } });
    const ends = [];
    ids.forEach((id) => {
      const pts = S.filter((s) => s.scores[id] != null).map((s) => [x(s.date), y(s.scores[id])]);
      if (!pts.length) return;
      g += `<polyline fill="none" stroke="${C[id].color === "#404040" ? "#9aa0a6" : C[id].color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
      ends.push({ id, y: pts[pts.length - 1][1], x: pts[pts.length - 1][0] });
    });
    ends.sort((a, b) => a.y - b.y).forEach((e, i, a) => { if (i && e.y - a[i - 1].y < 14) e.y = a[i - 1].y + 14; });
    ends.forEach((e) => { g += `<text x="${e.x + 8}" y="${e.y + 4}" fill="#fff" font-size="12" font-weight="600">${esc(C[e.id].short)} ${fmtPct(S[S.length - 1].scores[e.id] || 0)}</text>`; });
    $("#poll-trend").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des intentions de vote">${g}</svg>`;
  }

  /* ---------------- 2. Réseaux sociaux ---------------- */
  const Social = (() => {
    const PL = { all: "Tous réseaux", x: "X", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };
    const PC = { all: "#ff2d55", x: "#9aa4b2", instagram: "#e1306c", tiktok: "#25d8e8", youtube: "#ff0033", facebook: "#1877f2" };
    const st = { platform: "all", period: "365", mode: "total", from: 0, to: 0, t: 1, raf: 0 };
    let H, ids, allIds, ROW = 44;

    const val = (pt, id, p) => {
      const v = pt.values[id] || {};
      return p === "all" ? Object.values(v).reduce((a, b) => a + b, 0) : v[p] || 0;
    };
    // valeur interpolée à l'instant ms
    function at(id, ms) {
      let i = H.findIndex((h) => h.ms >= ms);
      if (i <= 0) return val(H[Math.max(i, 0)], id, st.platform);
      if (i === -1) return val(H[H.length - 1], id, st.platform);
      const a = H[i - 1], b = H[i], k = (ms - a.ms) / (b.ms - a.ms);
      return val(a, id, st.platform) + (val(b, id, st.platform) - val(a, id, st.platform)) * k;
    }
    function range() {
      const last = H[H.length - 1].ms;
      if (st.period === "custom") return [st.from || H[0].ms, st.to || last];
      if (st.period === "ytd") return [+new Date(new Date(last).getFullYear(), 0, 1), last];
      return [Math.max(H[0].ms, last - +st.period * DAY), last];
    }
    function frame(t) {
      const [a, b] = range(), ms = a + (b - a) * t;
      const data = ids.map((id) => {
        const v = at(id, ms), base = at(id, a);
        return { id, v: st.mode === "gain" ? v - base : v };
      }).sort((p, q) => q.v - p.v);
      // échelle fixe = valeurs de fin de période : les barres « poussent »
      const max = Math.max(1, ...ids.map((id) => st.mode === "gain" ? at(id, b) - at(id, a) : at(id, b)));
      data.forEach((d, rank) => {
        const el = rowsEl[d.id];
        el.style.transform = `translateY(${rank * ROW}px)`;
        const w = Math.max(0, (d.v / max) * 100);
        el.bar.style.width = w + "%";
        el.val.style.left = `min(${w}%, calc(100% - 90px))`;
        el.val.textContent = (st.mode === "gain" && d.v > 0 ? "+" : "") + fmtN(d.v);
      });
      $("#soc-date").textContent = fmtDate(ms, { day: "numeric", month: "short", year: "numeric" });
      const clip = $("#soc-clip-rect");
      if (clip) clip.setAttribute("width", Math.max(0, t) * +clip.dataset.w);
      const lab = $("#soc-curve-labels");
      if (lab) lab.style.opacity = t > 0.97 ? 1 : 0;
      $("#soc-scrub").value = Math.round(t * 1000);
      st.t = t;
    }
    const rowsEl = {};
    function build() {
      const race = $("#soc-race");
      race.innerHTML = "";
      race.style.height = ids.length * ROW + "px";
      ids.forEach((id) => {
        const c = C[id];
        const el = document.createElement("div");
        el.className = "rrow";
        el.innerHTML = `<div class="rname">${avatar(id, 32)}<span class="lbl">${esc(c.short)}</span></div><div class="rtrack"><div class="rbar" style="background:${c.color === "#404040" ? "#8a8f98" : c.color}"></div><span class="rval"></span></div>`;
        el.bar = $(".rbar", el); el.val = $(".rval", el);
        race.appendChild(el); rowsEl[id] = el;
      });
    }
    function table() {
      const [a, b] = range();
      const rows = ids.map((id) => ({ id, now: at(id, b), start: at(id, a) })).sort((p, q) => q.now - p.now);
      const last = H.filter((h) => h.ms <= b).pop() || H[H.length - 1];
      const plats = SOCIAL.platforms;
      $("#soc-table").innerHTML = `<thead><tr><th>Candidat</th><th>${esc(PL[st.platform])}</th><th>Gain</th><th>Croissance</th>${plats.map((p) => `<th>${PL[p]}</th>`).join("")}</tr></thead><tbody>`
        + rows.map((r) => {
          const g = r.now - r.start, pct = r.start ? (g / r.start) * 100 : 0;
          return `<tr><td><div class="who">${avatar(r.id, 26)}${esc(C[r.id].name)}${socialLinks(r.id, 15)}</div></td><td><strong>${fmtN(r.now)}</strong></td><td style="color:${g >= 0 ? "var(--pos)" : "var(--neg)"}">${g >= 0 ? "+" : ""}${fmtN(g)}</td><td>${pct >= 0 ? "+" : ""}${pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</td>${plats.map((p) => `<td>${last.values[r.id]?.[p] ? fmtN(last.values[r.id][p]) : "—"}</td>`).join("")}</tr>`;
        }).join("") + "</tbody>";
      const [ra, rb] = range();
      $("#social-warning").hidden = true; // bandeau d'avertissement retiré à la demande de l'éditeur
    }
    // Somme d'une plateforme pour tous les candidats à l'instant ms
    function platTotal(p, ms) {
      const keep = st.platform; st.platform = p;
      const n = allIds.reduce((acc, id) => acc + at(id, ms), 0);
      st.platform = keep; return n;
    }
    function cards() {
      const [a, b] = range();
      $("#soc-platform").innerHTML = Object.entries(PL).map(([k, v]) => {
        const now = platTotal(k, b), g = now - platTotal(k, a);
        return `<button role="tab" data-v="${k}" class="plat ${st.platform === k ? "on" : ""}" style="--pc:${PC[k]}">
          <span class="pn"><span class="dot"></span>${v}</span><span class="pv">${fmtN(now)}</span><span class="pg">+${fmtN(Math.max(0, g))} sur la période</span></button>`;
      }).join("");
    }
    function curve() {
      const [a, b] = range();
      const W = 900, Hh = 340, L = 54, R = 130, T = 14, B = 28;
      const pts = [a, ...H.filter((h) => h.ms > a && h.ms < b).map((h) => h.ms), b];
      const series = ids.map((id) => {
        const base = at(id, a);
        return { id, v: pts.map((ms) => at(id, ms) - (st.mode === "gain" ? base : 0)) };
      }).sort((p, q) => q.v[q.v.length - 1] - p.v[p.v.length - 1]).slice(0, 8);
      const ymax = Math.max(1, ...series.flatMap((s) => s.v)) * 1.05;
      const x = (ms) => L + ((ms - a) / (b - a || 1)) * (W - L - R);
      const y = (v) => T + (1 - v / ymax) * (Hh - T - B);
      let g = "";
      for (let i = 0; i <= 4; i++) { const v = (ymax / 4) * i; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 8}" y="${y(v) + 4}" fill="#a5addb" font-size="11" text-anchor="end">${fmtN(v)}</text>`; }
      const seen = new Set();
      for (let ms = a; ms <= b; ms += DAY) { const d = new Date(ms); const k = d.getFullYear() + "-" + d.getMonth(); if (!seen.has(k) && d.getDate() <= 7) { seen.add(k); g += `<text x="${x(ms)}" y="${Hh - 8}" fill="#a5addb" font-size="11">${fmtDate(ms, { month: "short" })}</text>`; } }
      const firstReal = H.find((h) => !h.estimated);
      if (firstReal && firstReal.ms > a && firstReal.ms <= b) g += `<line x1="${x(firstReal.ms)}" x2="${x(firstReal.ms)}" y1="${T}" y2="${Hh - B}" stroke="#ffe08a" stroke-dasharray="4 4"/><text x="${x(firstReal.ms) - 6}" y="${T + 10}" fill="#ffe08a" font-size="11" text-anchor="end">estimé ← | → réel</text>`;
      let lines = "";
      const ends = [];
      series.forEach((s) => {
        const col = C[s.id].color === "#404040" ? "#9aa0a6" : C[s.id].color;
        lines += `<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${s.v.map((v, i) => x(pts[i]) + "," + y(v)).join(" ")}"/>`;
        ends.push({ id: s.id, y: y(s.v[s.v.length - 1]), v: s.v[s.v.length - 1] });
      });
      ends.sort((p, q) => p.y - q.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].y < 14) e.y = arr[i - 1].y + 14; });
      let labels = "";
      ends.forEach((e) => { labels += `<text x="${W - R + 8}" y="${e.y + 4}" fill="#fff" font-size="12" font-weight="600">${esc(C[e.id].short)} ${(st.mode === "gain" ? "+" : "") + fmtN(e.v)}</text>`; });
      $("#soc-curve").innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Évolution des abonnés"><defs><clipPath id="soc-clip"><rect id="soc-clip-rect" x="0" y="0" height="${Hh}" width="${W - R - L}" data-w="${W - R - L}" transform="translate(${L},0)"/></clipPath></defs>${g}<g clip-path="url(#soc-clip)">${lines}</g><g id="soc-curve-labels" style="transition:opacity .4s">${labels}</g></svg>`;
      const lbl = { "7": "7 jours", "30": "30 jours", "90": "3 mois", "365": "12 mois", ytd: "depuis janvier", custom: "période choisie" }[st.period];
      $("#soc-curve-title").textContent = `Évolution ${st.mode === "gain" ? "du gain d'abonnés" : "des communautés"} — ${PL[st.platform]} — ${lbl}`;
    }
    function play() {
      cancelAnimationFrame(st.raf);
      const dur = 10000, t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        frame(1 - Math.pow(1 - k, 1.6)); // légère décélération finale
        if (k < 1) st.raf = requestAnimationFrame(step);
      };
      frame(0);
      st.raf = requestAnimationFrame(step);
    }
    // candidats présents sur la plateforme choisie (compte trouvé)
    function setActive() {
      const lastPt = H[H.length - 1];
      ids = allIds.filter((id) => val(lastPt, id, st.platform) > 0);
    }
    function refresh(animate = true) { setActive(); build(); table(); cards(); curve(); animate ? play() : frame(st.t); }
    function init() {
      H = SOCIAL.history.map((h) => ({ ...h, ms: +new Date(h.date) }));
      const last = H[H.length - 1];
      allIds = Object.keys(last.values).filter((id) => C[id]);
      ids = allIds.slice();
      const seg = (sel, key, cb) => $(sel).addEventListener("click", (e) => {
        const btn = e.target.closest("button"); if (!btn) return;
        $$(sel + " button").forEach((b) => b.classList.toggle("on", b === btn));
        cb(btn.dataset[key]);
      });
      $("#soc-platform").addEventListener("click", (e) => {
        const btn = e.target.closest(".plat"); if (!btn) return;
        st.platform = btn.dataset.v; refresh();
      });
      seg("#soc-mode", "m", (v) => { st.mode = v; refresh(); });
      seg("#soc-period", "p", (v) => { st.period = v; $("#soc-custom").hidden = v !== "custom"; refresh(); });
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      $("#soc-from").value = iso(H[0].ms); $("#soc-to").value = iso(last.ms);
      $("#soc-from").min = $("#soc-to").min = iso(H[0].ms);
      $("#soc-from").max = $("#soc-to").max = iso(last.ms);
      const onRange = () => { st.from = +new Date($("#soc-from").value); st.to = +new Date($("#soc-to").value); if (st.from < st.to) refresh(); };
      $("#soc-from").addEventListener("change", onRange); $("#soc-to").addEventListener("change", onRange);
      $("#soc-play").addEventListener("click", play);
      $("#soc-scrub").addEventListener("input", (e) => { cancelAnimationFrame(st.raf); frame(e.target.value / 1000); });
      build(); table(); cards(); curve(); frame(1);
    }
    return { init, play };
  })();

  /* ---------------- 3. Buzz ---------------- */
  // Plateformes : article, YouTube, Dailymotion, TikTok, X
  const PLAT = {
    article: ["📰 Article", "#9aa4b2"], youtube: ["▶ YouTube", "#ff0033"], dailymotion: ["▶ Dailymotion", "#0d65f2"],
    tiktok: ["♪ TikTok", "#25d8e8"], x: ["𝕏 Post X", "#e7e9ea"], instagram: ["◎ Instagram", "#e1306c"],
  };
  const platformOf = (it) => it.platform || (it.youtube_id ? "youtube" : it.type === "video" ? "youtube" : "article");
  const KINDS = { "": "Toutes les sources", article: "Articles", video: "Vidéos TV & web", social: "Réseaux sociaux" };
  const kindOf = (it) => { const p = platformOf(it); return p === "article" ? "article" : p === "tiktok" || p === "x" || p === "instagram" ? "social" : "video"; };
  function initBuzz() {
    const ids = Object.keys(BUZZ.candidates).filter((id) => C[id]);
    const st = { id: "", kind: "" };
    $("#buzz-meta").textContent = `Du ${fmtDate(BUZZ.since, { day: "numeric", month: "long" })} à aujourd'hui · articles de presse, séquences TV (YouTube, Dailymotion), TikTok, Instagram et X · ${BUZZ.classifier}`;
    $("#buzz-filter").innerHTML = `<button class="chip all on" data-id="">Tous</button>` + ids.map((id) => `<button class="chip" data-id="${id}">${avatar(id, 26)}${esc(C[id].short)}</button>`).join("");
    $("#buzz-kind").innerHTML = Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}" class="${k === "" ? "on" : ""}">${v}</button>`).join("");
    const media = (it) => {
      const pf = platformOf(it);
      if (pf === "youtube" && it.youtube_id)
        return `<button class="yt" data-src="https://www.youtube-nocookie.com/embed/${esc(it.youtube_id)}?autoplay=1" aria-label="Lire la vidéo YouTube"><img src="https://i.ytimg.com/vi/${esc(it.youtube_id)}/hqdefault.jpg" alt="" loading="lazy"></button>`;
      if (pf === "dailymotion" && it.dailymotion_id)
        return window.DM_PLAYER
          ? `<button class="yt" data-src="https://geo.dailymotion.com/player/${esc(window.DM_PLAYER)}.html?video=${esc(it.dailymotion_id)}&autoplay=1" aria-label="Lire la vidéo Dailymotion"><img src="https://www.dailymotion.com/thumbnail/video/${esc(it.dailymotion_id)}" alt="" loading="lazy"></button>`
          : `<a class="yt" href="https://www.dailymotion.com/video/${esc(it.dailymotion_id)}" target="_blank" rel="noopener" aria-label="Voir la vidéo sur Dailymotion"><img src="https://www.dailymotion.com/thumbnail/video/${esc(it.dailymotion_id)}" alt="" loading="lazy"></a>`;
      if (pf === "tiktok" && it.tiktok_id)
        return `<div class="tt" data-tt="${esc(it.tiktok_id)}"><span class="tt-ph">♪ TikTok</span></div>`;
      if (pf === "instagram" && it.instagram_code)
        return `<div class="ig"><iframe src="https://www.instagram.com/${it.instagram_kind === "p" ? "p" : "reel"}/${esc(it.instagram_code)}/embed/" loading="lazy" scrolling="no" allowtransparency="true" allow="encrypted-media; fullscreen" title="Publication Instagram"></iframe></div>`;
      if (pf === "x" && it.x_id)
        return `<button class="xload" data-src="https://platform.twitter.com/embed/Tweet.html?id=${esc(it.x_id)}&lang=fr&theme=dark&dnt=true">Afficher le post</button>`;
      return "";
    };
    const card = (it, id, tone) => {
      const pf = platformOf(it), [plab, pcol] = PLAT[pf] || PLAT.article;
      const when = it.date ? fmtDate(it.date, { day: "numeric", month: "short" }) : it.published || "";
      const meta = [esc(it.source), when, it.views ? fmtN(it.views) + " vues" : it.likes ? fmtN(it.likes) + " j'aime" : ""].filter(Boolean).join(" · ");
      const title = pf === "x" ? `<blockquote class="xtext">${esc(it.title)}</blockquote>` : esc(it.title);
      return `<article class="bcard" style="--edge:${tone === "neg" ? "var(--neg)" : "var(--pos)"}">
        <div class="bhead">${avatar(id, 22)}<strong style="color:var(--text)">${esc(C[id].short)}</strong><span class="plat-tag" style="--pc:${pcol}">${plab}</span>${meta}</div>
        <a class="btitle" href="${esc(it.url)}" target="_blank" rel="noopener">${title}</a>
        ${it.context ? `<div class="bctx">${esc(it.context)}</div>` : ""}${media(it)}</article>`;
    };
    const render = () => {
      const list = st.id ? [st.id] : ids;
      const pick = (k) => list.flatMap((id) => (BUZZ.candidates[id][k] || []).filter((it) => !st.kind || kindOf(it) === st.kind)
        .slice(0, st.id ? 12 : st.kind ? 3 : 2).map((it) => [it, id]))
        .sort((a, b) => (b[0].views || 0) - (a[0].views || 0));
      const neg = pick("negative"), pos = pick("positive");
      $("#buzz-neg").innerHTML = neg.map(([it, id]) => card(it, id, "neg")).join("") || `<div class="empty">Aucun bad buzz détecté pour ce filtre.</div>`;
      $("#buzz-pos").innerHTML = pos.map(([it, id]) => card(it, id, "pos")).join("") || `<div class="empty">Aucune séquence favorable détectée pour ce filtre.</div>`;
      $$("#buzz .tt").forEach((t) => ttObs.observe(t));
    };
    // TikTok : lecteur officiel chargé quand la vidéo arrive à l'écran, lecture automatique sans le son
    const ttPost = (f, type) => f?.contentWindow?.postMessage({ type, "x-tiktok-player": true }, "*");
    const ttObs = new IntersectionObserver((entries) => entries.forEach((en) => {
      const box = en.target; let f = box.querySelector("iframe");
      if (en.isIntersecting) {
        if (!f) {
          box.innerHTML = `<iframe src="https://www.tiktok.com/player/v1/${box.dataset.tt}?autoplay=1&loop=1&music_info=0&description=0&rel=0&controls=1&progress_bar=1&volume_control=1&fullscreen_button=1&play_button=1&timestamp=0" allow="autoplay; fullscreen; encrypted-media" title="Vidéo TikTok"></iframe>`;
          f = box.querySelector("iframe");
          f.addEventListener("load", () => { ttPost(f, "mute"); ttPost(f, "play"); });
        } else { ttPost(f, "mute"); ttPost(f, "play"); }
      } else if (f) ttPost(f, "pause");
    }), { threshold: 0.6 });
    window.addEventListener("message", (e) => {
      let host = ""; try { host = new URL(e.origin).hostname; } catch { return; }
      if (!/(^|\.)tiktok\.com$/.test(host)) return;
      const d = typeof e.data === "string" ? (() => { try { return JSON.parse(e.data); } catch { return {}; } })() : e.data || {};
      if (d["x-tiktok-player"] && d.type === "onPlayerReady") { const f = $$("#buzz .tt iframe").find((x) => x.contentWindow === e.source); ttPost(f, "mute"); ttPost(f, "play"); }
    });
    $("#buzz-filter").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#buzz-filter .chip").forEach((x) => x.classList.toggle("on", x === b));
      st.id = b.dataset.id; render();
    });
    $("#buzz-kind").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#buzz-kind button").forEach((x) => x.classList.toggle("on", x === b));
      st.kind = b.dataset.k; render();
    });
    // lecteurs chargés seulement au clic (page légère, pas de traceurs avant interaction)
    document.addEventListener("click", (e) => {
      const y = e.target.closest(".yt:not(.loaded), .xload"); if (!y) return;
      const frame = `<iframe src="${y.dataset.src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" title="Contenu intégré"></iframe>`;
      if (y.classList.contains("xload")) { y.outerHTML = `<div class="xframe">${frame}</div>`; return; }
      y.classList.add("loaded"); y.innerHTML = frame;
    });
    render();
  }

  /* ---------------- 4. Programmes ---------------- */
  function initProg() {
    const surname = (n) => n.replace(/^\S+\s+/, "").replace(/^(de|d'|du)\s+/i, "");
    const ids = Object.keys(PROG.candidates).filter((id) => C[id]).sort((x, y) => surname(C[x].name).localeCompare(surname(C[y].name), "fr"));
    const st = { mode: "one", a: null, b: null };
    $("#prog-disclaimer").textContent = PROG.disclaimer;
    const grid = () => {
      $("#prog-hint").textContent = st.mode === "one" ? "Sélectionnez un candidat pour afficher la synthèse de son programme."
        : "Choisissez deux candidats : le premier (A, blanc) puis le second (B, orange). Seuls les thèmes abordés par les deux sont comparés.";
      $("#prog-grid").innerHTML = ids.map((id) => {
        const cls = st.mode === "one" ? (st.a === id ? "on" : "") : st.a === id ? "a" : st.b === id ? "b" : "";
        const tag = st.mode === "compare" && cls ? `<span class="tag">${cls.toUpperCase()}</span>` : "";
        return `<button class="pick ${cls}" data-id="${id}">${avatar(id, 64)}${esc(C[id].short)}${tag}</button>`;
      }).join("");
    };
    const detailOf = (id) => (PDET.candidates[id] || { details: {} });
    const one = (id) => {
      const p = PROG.candidates[id], c = C[id], d = detailOf(id);
      return `<div class="sheet" style="--c:${c.color}">
        <div class="sheet-head">${avatar(id, 84)}<div><h3>${esc(c.name)}</h3><span class="status">${esc(c.party)} · ${esc(p.status)}</span>
          <div class="sheet-links">${socialLinks(id, 20)}${d.site ? `<a class="site" href="${esc(d.site)}" target="_blank" rel="noopener">🌐 ${esc(d.site_label || "Site officiel")}</a>` : ""}
          <button class="full-btn" data-full="${id}">📄 Programme complet</button>
          <button class="impact-cta" data-impact="${id}">💶 Son impact sur ma vie</button></div></div></div>
        <div class="sheet-impact" id="sheet-impact" hidden></div>
        <p class="pitch">${esc(p.pitch)}</p>
        <ul class="keys">${p.key.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        ${window.Extras ? window.Extras.coutTotal(id) : ""}
        ${PROG.topics.map((t) => {
          const det = d.details?.[t.id];
          return `<div class="topic"><div class="tl">${t.icon} ${esc(t.label)}</div><div><div class="${p.positions[t.id] ? "" : "na"}">${esc(p.positions[t.id] || "Pas de position détaillée connue à ce stade.")}</div>
            ${window.Extras ? window.Extras.cout(id, t.id) : ""}
            ${det?.length ? `<details class="more"><summary>Voir le détail (${det.length} point${det.length > 1 ? "s" : ""})</summary><ul>${det.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</div></div>`;
        }).join("")}
        ${window.Extras ? window.Extras.parlement(id) : ""}
        ${window.Extras ? window.Extras.patrimoine(id) : ""}
      </div>`;
    };
    const full = (id) => {
      const p = PROG.candidates[id], c = C[id], d = detailOf(id);
      const box = document.createElement("div");
      box.className = "modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      box.innerHTML = `<div class="modal-in" style="--c:${c.color}">
        <div class="modal-bar"><button class="print-btn">🖨️ Imprimer / PDF</button><button class="close-btn" aria-label="Fermer">✕</button></div>
        <div class="sheet-head">${avatar(id, 72)}<div><h3>Programme de ${esc(c.name)}</h3><span class="status">${esc(c.party)} · ${esc(p.status)}</span></div></div>
        ${d.programme_label ? `<p class="status">${esc(d.programme_label)}</p>` : ""}
        <p class="pitch">${esc(p.pitch)}</p>
        <h4>Propositions phares</h4><ul>${p.key.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        ${PROG.topics.map((t) => `<h4>${t.icon} ${esc(t.label)}</h4><p>${esc(p.positions[t.id] || "Pas de position détaillée connue à ce stade.")}</p>${(d.details?.[t.id] || []).length ? `<ul>${d.details[t.id].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`).join("")}
        <p class="muted small">${esc(PROG.disclaimer)}${d.site ? ` Source officielle : <a href="${esc(d.site)}" target="_blank" rel="noopener">${esc(d.site)}</a>.` : ""}</p>
      </div>`;
      const close = () => { box.remove(); document.body.classList.remove("noscroll"); };
      box.addEventListener("click", (e) => { if (e.target === box || e.target.closest(".close-btn")) close(); if (e.target.closest(".print-btn")) window.print(); });
      document.addEventListener("keydown", function esc_(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc_); } });
      document.body.appendChild(box); document.body.classList.add("noscroll");
      $(".close-btn", box).focus();
    };
    $("#prog-view").addEventListener("click", (e) => { const b = e.target.closest("[data-full]"); if (b) full(b.dataset.full); });
    const compare = (a, b) => {
      const A = PROG.candidates[a], B = PROG.candidates[b];
      const common = PROG.topics.filter((t) => A.positions[t.id] && B.positions[t.id]);
      return `<div class="rotate-hint" aria-hidden="true"><span class="rh-phone">📱</span><span>Tournez votre téléphone pour voir le comparatif en plein écran</span></div><div class="cmp">
        <div class="ch corner"></div><div class="ch a">${avatar(a, 40)}${esc(C[a].short)}${socialLinks(a, 15)}</div><div class="ch b">${avatar(b, 40)}${esc(C[b].short)}${socialLinks(b, 15)}</div>
        <div class="tl">🎯 En une phrase</div><div class="ca" data-n="${esc(C[a].short)}">${esc(A.pitch)}</div><div class="cb" data-n="${esc(C[b].short)}">${esc(B.pitch)}</div>
        ${common.map((t) => `<div class="tl">${t.icon} ${esc(t.label)}</div><div class="ca" data-n="${esc(C[a].short)}">${esc(A.positions[t.id])}${window.Extras ? window.Extras.cout(a, t.id) : ""}</div><div class="cb" data-n="${esc(C[b].short)}">${esc(B.positions[t.id])}${window.Extras ? window.Extras.cout(b, t.id) : ""}</div>`).join("")}
      </div><p class="muted small">${common.length} thème(s) abordé(s) par les deux candidats sur ${PROG.topics.length}.</p>`;
    };
    // Le simulateur (bloc unique) peut s'afficher dans la fiche d'un candidat ou dans le volet « Les impacts sur ma vie »
    const IB = $("#impact-block"), home = document.createComment("place du simulateur");
    IB.before(home);
    const impactHome = () => {
      if (IB.parentNode !== home.parentNode) home.after(IB);
      if (window.SimFocus) {
        window.SimFocus = null;
        $(".impact-title", IB).textContent = "Quel impact sur mon quotidien ?";
        ["#sim-part", "#sim-ent"].forEach((f) => { const out = $(f + "-out"); if (out && out.innerHTML.trim()) window.Simulateur?.rerun?.(f); });
      }
    };
    const impactInSheet = (cid) => {
      const slot = $("#sheet-impact");
      if (!slot) return;
      const open = slot.hidden || window.SimFocus !== cid;
      impactHome(); IB.hidden = true; slot.hidden = true;
      $$("#prog-view .impact-cta").forEach((b) => b.classList.toggle("on", open));
      if (!open) return;
      window.SimFocus = cid;
      slot.appendChild(IB); IB.hidden = false; slot.hidden = false;
      $(".impact-title", IB).textContent = `Quel impact ${/^[aeiouyéèêàâîôûh]/i.test(C[cid].name) ? "d'" : "de "}${C[cid].name} sur ma vie ?`;
      ["#sim-part", "#sim-ent"].forEach((f) => { const out = $(f + "-out"); if (out && out.innerHTML.trim()) window.Simulateur?.rerun?.(f); });
      slot.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    $("#prog-view").addEventListener("click", (e) => { const b = e.target.closest("[data-impact]"); if (b) impactInSheet(b.dataset.impact); });
    const view = () => {
      impactHome(); if (st.mode !== "impact") IB.hidden = true;
      $(".impact-title", IB).textContent = "Quel impact sur mon quotidien ?";
      grid();
      if (st.mode === "one") $("#prog-view").innerHTML = st.a ? one(st.a) : `<div class="empty">Sélectionnez un candidat ci-dessus pour afficher sa fiche. Les candidats sont présentés par ordre alphabétique.</div>`;
      else $("#prog-view").innerHTML = st.a && st.b ? compare(st.a, st.b) : `<div class="empty">Sélectionnez ${st.a ? "un second" : "deux"} candidat${st.a ? "" : "s"}.</div>`;
      document.body.classList.toggle("cmp-on", st.mode === "compare" && !!(st.a && st.b));
    };
    $("#prog-grid").addEventListener("click", (e) => {
      const b = e.target.closest(".pick"); if (!b) return;
      const id = b.dataset.id;
      if (st.mode === "one") st.a = id;
      else if (id === st.a) { st.a = st.b; st.b = null; }
      else if (id === st.b) st.b = null;
      else if (!st.a) st.a = id;
      else if (!st.b) st.b = id;
      else { st.b = id; }
      view();
    });
    // Volets : un candidat, comparaison, impacts sur ma vie, candidat de mes convictions
    function setView(v) {
      impactHome(); st.mode = v === "compare" ? "compare" : v === "one" ? "one" : st.mode;
      $$("#prog-actions .pv").forEach((x) => x.classList.toggle("on", x.dataset.v === v));
      const prog = v === "one" || v === "compare";
      $("#prog-block").hidden = !prog;
      $("#impact-block").hidden = v !== "impact";
      $("#conv-block").hidden = v !== "conv";
      if (v === "conv" && $("#portrait-app") && !$("#conv-block").contains($("#portrait-app"))) $("#conv-block .conv-jv").before($("#portrait-app"));
      if (prog) {
        st.mode = v;
        if (st.mode === "compare" && st.a && !st.b) st.b = null;
        view();
      }
    }
    window.ProgView = setView;
    // depuis la rubrique Sondages : ouvrir directement la fiche d'un candidat
    window.ProgSelect = (cid) => {
      if (!PROG.candidates[cid]) return;
      st.a = cid; location.hash = "#programmes"; setView("one");
      setTimeout(() => $("#prog-view")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    };
    $("#prog-actions").addEventListener("click", (e) => { const b = e.target.closest(".pv"); if (b) setView(b.dataset.v); });
    view();
  }

  /* ---------------- Chargement ---------------- */
  async function main() {
    // no-cache : le navigateur revalide à chaque visite (données mises à jour plusieurs fois par jour)
    const get = (f) => fetch(`data/${f}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    try {
      const [cands, photos, polls, social, buzz, prog, pdet, sim, hist] = await Promise.all(["candidates", "photos", "polls", "social", "buzz", "programmes", "programmes_details", "simulateur", "historique"].map(get));
      cands.candidates.forEach((c) => (C[c.id] = { ...c, photo: photos[c.id]?.url }));
      POLLS = polls; SOCIAL = social; BUZZ = buzz; PROG = prog; PDET = pdet; SIM = sim; HIST = hist;
    } catch (e) {
      document.querySelector("main").innerHTML = `<p class="warn">Impossible de charger les données (${esc(e.message)}). Ouvrez le site via un serveur web (voir README).</p>`;
      return;
    }
    $("#updated").textContent = "Mis à jour le " + new Date(POLLS.updated).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    // Réserve électorale : veille et jour de chaque tour, jusqu'à 20 h (heure de Paris)
    const paris = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const FREEZE = [["2027-04-17T00:00", "2027-04-18T20:00"], ["2027-05-01T00:00", "2027-05-02T20:00"]];
    window.MDS_FREEZE = FREEZE.some(([a, b]) => paris >= new Date(a) && paris < new Date(b));
    if (window.MDS_FREEZE) {
      $("#freeze-note").hidden = false;
      $$("#sondages > :not(.panel-head):not(.hero-cands):not(#freeze-note)").forEach((n) => (n.hidden = true));
    } else { renderPolls("30"); renderTrend(); renderDuels(); }
    $("#poll-window").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#poll-window button").forEach((x) => x.classList.toggle("on", x === b));
      renderPolls(b.dataset.w);
    });
    $("#buzz-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#buzz-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("#buzz-main").hidden = b.dataset.b !== "buzz-main";
      $("#tp-app").hidden = b.dataset.b !== "tp-app";
      $("#buzz-title").textContent = b.dataset.b === "tp-app" ? "Temps de parole dans les médias" : "Buzz des 7 derniers jours";
      $("#buzz-meta").hidden = b.dataset.b === "tp-app";
    });
    if (window.Extras) { await window.Extras.load(); window.Extras.init({ C, avatar, esc, fmtN, socialLinks }, POLLS); }
    Social.init(); initBuzz(); initProg();
    if (window.Simulateur) window.Simulateur.init({ C, avatar, esc, fmtN, socialLinks }, SIM);
    window.APP = { C, avatar, esc, fmtN, socialLinks };
    if (window.Fun) window.Fun.init(window.APP);
    if (window.JeVote) window.JeVote.init(window.APP);
    // Buzz sur mobile : bascule Bad buzz / Séquences favorables
    $("#buzz-side")?.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-s]"); if (!b) return;
      document.querySelectorAll("#buzz-side button").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelector(".buzz-cols").dataset.s = b.dataset.s;
    });
    // Mini-lecteur du direct LCP (en-tête) : affiché seulement quand la chaîne est en direct
    initLiveLCP();
    const fromMail = /access_token=|error_description=|type=signup/.test(location.hash) || /[?&](reset|confirm)=1/.test(location.search);
    showTab(fromMail ? "fun" : location.hash.slice(1) || "sondages");
  }
  /* Direct LCP : lecteur YouTube de la chaîne (live_stream), masqué s'il n'y a pas de direct en cours.
     Vérifié au chargement puis toutes les 5 minutes. */
  const LCP_CHANNEL = "UCHGFbA0KWBgf6gMbyUCZeCQ";
  function initLiveLCP() {
    const box = $("#mini-live"), host = $("#ml-player");
    if (!box || !host) return;
    let player = null, live = false;
    // Hors direct, le bloc reste chargé mais invisible (hors écran) pour pouvoir tester la lecture
    const show = (on) => {
      live = on; box.classList.toggle("ml-off", !on);
    };
    const check = () => {
      const d = player?.getVideoData?.() || {};
      const st = player?.getPlayerState?.();
      // en direct = vidéo live qui démarre réellement (lecture ou chargement) ; « à venir » ou terminé = masqué
      if (!(d.isLive === true && !d.errorCode)) return show(false);
      if (st === 1 || st === 3) return show(true);
      if (st === 0) show(false);
    };
    const build = () => {
      if (player) { try { player.destroy(); } catch { /* déjà détruit */ } player = null; }
      host.innerHTML = '<div id="ml-yt"></div>';
      player = new YT.Player("ml-yt", {
        host: "https://www.youtube-nocookie.com", width: "100%", height: "100%",
        videoId: "live_stream", playerVars: { channel: LCP_CHANNEL, autoplay: 1, mute: 1, playsinline: 1, controls: 1, rel: 0 },
        events: {
          onReady: (e) => { e.target.mute(); e.target.playVideo(); setTimeout(check, 4000); },
          onStateChange: check,
          onError: () => show(false),
        },
      });
    };
    box.hidden = false; show(false);
    const start = () => { build(); setInterval(() => { if (!live) build(); else check(); }, 5 * 60 * 1000); };
    if (window.YT?.Player) return start();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); start(); };
    const sc = document.createElement("script");
    sc.src = "https://www.youtube.com/iframe_api"; sc.async = true;
    document.head.appendChild(sc);
  }
  main();
})();
