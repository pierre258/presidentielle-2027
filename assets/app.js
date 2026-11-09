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

  let C = {}, POLLS, SOCIAL, BUZZ, PROG;

  const avatar = (id, size = 44) => {
    const c = C[id] || { name: id, color: "#888" };
    if (c.photo) return `<img class="av" src="${esc(c.photo)}" alt="${esc(c.name)}" width="${size}" height="${size}" loading="lazy" style="--c:${c.color};width:${size}px;height:${size}px">`;
    const ini = c.name.split(/[\s-]+/).map((w) => w[0]).slice(0, 2).join("");
    return `<span class="av av-init" style="--c:${c.color};width:${size}px;height:${size}px;background:${c.color};font-size:${size / 2.6}px">${esc(ini)}</span>`;
  };

  /* ---------------- Onglets ---------------- */
  const shown = new Set();
  function showTab(id) {
    if (!$("#" + id)) id = "sondages";
    $$(".panel").forEach((p) => (p.hidden = p.id !== id));
    $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === id));
    if (id === "reseaux" && !shown.has(id)) setTimeout(() => Social.play(), 250);
    shown.add(id);
  }
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

  /* ---------------- 1. Sondages ---------------- */
  function renderPolls(w = "7") {
    const win = POLLS.windows[w];
    const rows = Object.entries(win.average).filter(([id]) => C[id]).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    $("#poll-bars").innerHTML = rows.map(([id, v], i) => {
      const big = i < 4, c = C[id], prev = win.previous[id];
      const d = prev == null ? null : Math.round((v - prev) * 10) / 10;
      const delta = d == null ? "" : `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : "eq"}">${d > 0 ? "▲ +" : d < 0 ? "▼ " : "= "}${d ? fmtPct(d) : ""}${d ? " pt" : ""}</span>`;
      return `<div class="prow ${big ? "" : "small"}">
        ${avatar(id, big ? 58 : 34)}
        <div><div class="name">${esc(c.name)} <span class="party">${esc(c.party)}</span></div>
          <div class="bar"><i data-w="${(v / max) * 100}" style="background:${big ? "#fff" : "rgba(255,255,255,.85)"}"></i></div></div>
        <div><div class="score">${fmtPct(v)}<sup>%</sup></div>${delta}</div>
      </div>`;
    }).join("");
    requestAnimationFrame(() => $$("#poll-bars .bar i").forEach((b) => (b.style.width = b.dataset.w + "%")));

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
    const st = { platform: "all", period: "ytd", mode: "total", from: 0, to: 0, t: 1, raf: 0 };
    let H, ids, ROW = 44;

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
          return `<tr><td><div class="who">${avatar(r.id, 26)}${esc(C[r.id].name)}</div></td><td><strong>${fmtN(r.now)}</strong></td><td style="color:${g >= 0 ? "var(--pos)" : "var(--neg)"}">${g >= 0 ? "+" : ""}${fmtN(g)}</td><td>${pct >= 0 ? "+" : ""}${pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</td>${plats.map((p) => `<td>${last.values[r.id]?.[p] ? fmtN(last.values[r.id][p]) : "—"}</td>`).join("")}</tr>`;
        }).join("") + "</tbody>";
      const [ra, rb] = range();
      const est = H.some((h) => h.estimated && h.ms >= ra && h.ms <= rb);
      const w = $("#social-warning");
      w.hidden = !est;
      const firstReal = H.find((h) => !h.estimated);
      w.innerHTML = firstReal
        ? `⚠️ <strong>Chiffres réels depuis le ${fmtDate(firstReal.ms, { day: "numeric", month: "long" })}</strong> (relevés quotidiens). Avant cette date, la courbe est une <strong>reconstitution estimée</strong>, calée sur le premier relevé réel. Les comptes officiels introuvables ne sont pas comptés (—).`
        : "⚠️ <strong>Historique estimé.</strong> Les relevés quotidiens réels démarrent à la mise en ligne ; la série depuis janvier 2026 est une reconstitution approximative.";
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
    function refresh(animate = true) { table(); animate ? play() : frame(st.t); }
    function init() {
      H = SOCIAL.history.map((h) => ({ ...h, ms: +new Date(h.date) }));
      const last = H[H.length - 1];
      ids = Object.keys(last.values).filter((id) => C[id]);
      $("#soc-platform").innerHTML = Object.entries(PL).map(([k, v]) => `<button data-v="${k}" class="${k === "all" ? "on" : ""}">${v}</button>`).join("");
      const seg = (sel, key, cb) => $(sel).addEventListener("click", (e) => {
        const btn = e.target.closest("button"); if (!btn) return;
        $$(sel + " button").forEach((b) => b.classList.toggle("on", b === btn));
        cb(btn.dataset[key]);
      });
      seg("#soc-platform", "v", (v) => { st.platform = v; refresh(); });
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
      build(); table(); frame(1);
    }
    return { init, play };
  })();

  /* ---------------- 3. Buzz ---------------- */
  function initBuzz() {
    const ids = Object.keys(BUZZ.candidates).filter((id) => C[id]);
    $("#buzz-meta").textContent = `Du ${fmtDate(BUZZ.since, { day: "numeric", month: "long" })} à aujourd'hui · articles, passages TV et vidéos les plus vus · classement : ${BUZZ.classifier}`;
    $("#buzz-filter").innerHTML = `<button class="chip all on" data-id="">Tous</button>` + ids.map((id) => `<button class="chip" data-id="${id}">${avatar(id, 26)}${esc(C[id].short)}</button>`).join("");
    const card = (it, id, tone) => {
      const video = it.youtube_id
        ? `<button class="yt" data-yt="${esc(it.youtube_id)}" aria-label="Lire la vidéo"><img src="https://i.ytimg.com/vi/${esc(it.youtube_id)}/hqdefault.jpg" alt="" loading="lazy"></button>` : "";
      const when = it.date ? fmtDate(it.date, { day: "numeric", month: "short" }) : it.published || "";
      const meta = [it.type === "video" ? "▶ Vidéo" : "📰 Article", esc(it.source), when, it.views ? fmtN(it.views) + " vues" : ""].filter(Boolean).join(" · ");
      return `<article class="bcard" style="--edge:${tone === "neg" ? "var(--neg)" : "var(--pos)"}">
        <div class="bhead">${avatar(id, 22)}<strong style="color:var(--text)">${esc(C[id].short)}</strong> · ${meta}</div>
        <a class="btitle" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
        ${it.context ? `<div class="bctx">${esc(it.context)}</div>` : ""}${video}</article>`;
    };
    const render = (sel) => {
      const list = sel ? [sel] : ids;
      const pick = (k) => list.flatMap((id) => (BUZZ.candidates[id][k] || []).slice(0, sel ? 10 : 2).map((it) => [it, id]))
        .sort((a, b) => (b[0].views || 0) - (a[0].views || 0));
      const neg = pick("negative"), pos = pick("positive");
      $("#buzz-neg").innerHTML = neg.map(([it, id]) => card(it, id, "neg")).join("") || `<div class="empty">Aucun bad buzz détecté sur la période.</div>`;
      $("#buzz-pos").innerHTML = pos.map(([it, id]) => card(it, id, "pos")).join("") || `<div class="empty">Aucune séquence favorable détectée sur la période.</div>`;
    };
    $("#buzz-filter").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$("#buzz-filter .chip").forEach((x) => x.classList.toggle("on", x === b));
      render(b.dataset.id);
    });
    document.addEventListener("click", (e) => {
      const y = e.target.closest(".yt:not(.loaded)"); if (!y) return;
      y.classList.add("loaded");
      y.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${y.dataset.yt}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Vidéo YouTube"></iframe>`;
    });
    render("");
  }

  /* ---------------- 4. Programmes ---------------- */
  function initProg() {
    const ids = Object.keys(PROG.candidates).filter((id) => C[id]);
    const st = { mode: "one", a: ids[0], b: null };
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
    const one = (id) => {
      const p = PROG.candidates[id], c = C[id];
      return `<div class="sheet" style="--c:${c.color}">
        <div class="sheet-head">${avatar(id, 84)}<div><h3>${esc(c.name)}</h3><span class="status">${esc(c.party)} · ${esc(p.status)}</span></div></div>
        <p class="pitch">${esc(p.pitch)}</p>
        <ul class="keys">${p.key.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
        ${PROG.topics.map((t) => `<div class="topic"><div class="tl">${t.icon} ${esc(t.label)}</div><div class="${p.positions[t.id] ? "" : "na"}">${esc(p.positions[t.id] || "Pas de position détaillée connue à ce stade.")}</div></div>`).join("")}
      </div>`;
    };
    const compare = (a, b) => {
      const A = PROG.candidates[a], B = PROG.candidates[b];
      const common = PROG.topics.filter((t) => A.positions[t.id] && B.positions[t.id]);
      return `<div class="cmp">
        <div class="ch corner"></div><div class="ch a">${avatar(a, 40)}${esc(C[a].short)}</div><div class="ch b">${avatar(b, 40)}${esc(C[b].short)}</div>
        <div class="tl">🎯 En une phrase</div><div>${esc(A.pitch)}</div><div>${esc(B.pitch)}</div>
        ${common.map((t) => `<div class="tl">${t.icon} ${esc(t.label)}</div><div>${esc(A.positions[t.id])}</div><div>${esc(B.positions[t.id])}</div>`).join("")}
      </div><p class="muted small">${common.length} thème(s) abordé(s) par les deux candidats sur ${PROG.topics.length}.</p>`;
    };
    const view = () => {
      grid();
      if (st.mode === "one") $("#prog-view").innerHTML = one(st.a);
      else $("#prog-view").innerHTML = st.a && st.b ? compare(st.a, st.b) : `<div class="empty">Sélectionnez ${st.a ? "un second" : "deux"} candidat${st.a ? "" : "s"}.</div>`;
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
    $("#prog-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#prog-mode button").forEach((x) => x.classList.toggle("on", x === b));
      st.mode = b.dataset.m;
      if (st.mode === "compare" && !st.b) st.b = ids.find((i) => i !== st.a);
      view();
    });
    view();
  }

  /* ---------------- Chargement ---------------- */
  async function main() {
    const get = (f) => fetch(`data/${f}.json?v=${Math.floor(Date.now() / 36e5)}`).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    try {
      const [cands, photos, polls, social, buzz, prog] = await Promise.all(["candidates", "photos", "polls", "social", "buzz", "programmes"].map(get));
      cands.candidates.forEach((c) => (C[c.id] = { ...c, photo: photos[c.id]?.url }));
      POLLS = polls; SOCIAL = social; BUZZ = buzz; PROG = prog;
    } catch (e) {
      document.querySelector("main").innerHTML = `<p class="warn">Impossible de charger les données (${esc(e.message)}). Ouvrez le site via un serveur web (voir README).</p>`;
      return;
    }
    $("#updated").textContent = "Mis à jour le " + new Date(POLLS.updated).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    renderPolls("7"); renderTrend();
    $("#poll-window").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#poll-window button").forEach((x) => x.classList.toggle("on", x === b));
      renderPolls(b.dataset.w);
    });
    Social.init(); initBuzz(); initProg();
    showTab(location.hash.slice(1) || "sondages");
  }
  main();
})();
