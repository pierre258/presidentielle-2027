/* Rubriques complémentaires : patrimoine (fiche candidat), « Dit à la télé, voté au Parlement »,
   temps de parole dans les médias (Buzz) et parrainages des 500 élus.
   Données : data/patrimoine.json, parlement.json, temps_parole.json, parrainages.json (facultatives). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let A, D = {}, POLL = {};
  const esc = (s) => A.esc(s ?? "");
  const eur = (n) => n == null ? "—" : Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€`
    : `${Math.round(n).toLocaleString("fr-FR")} €`;
  const src = (s) => s?.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || "Source")}</a>` : esc(s?.label || "");
  const fdate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const name = (id) => A.C[id]?.name || id;

  async function load() {
    const get = (f) => fetch(`data/${f}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [D.pat, D.parl, D.tp, D.parr, D.cout] = await Promise.all(["patrimoine", "parlement", "temps_parole", "parrainages", "chiffrages"].map(get));
  }

  /* =================== 1. Patrimoine (sous le programme) =================== */
  const MEDIAN = 177200;      // patrimoine brut médian des ménages, Insee, début 2021
  const SMIC_AN = 1477 * 12;  // SMIC net annuel (data/simulateur.json)
  const POSTE_ICO = [[/immob|maison|appart|terrain|bien/i, "🏠"], [/compte|livret|épargne|epargne|placement|assurance|valeur|action|titre/i, "💶"],
    [/véhic|vehic|voiture|auto|moto|bateau/i, "🚗"], [/dette|emprunt|passif|crédit|credit/i, "📉"], [/société|societe|part|fonds/i, "🏢"]];
  const ico = (l) => (POSTE_ICO.find(([re]) => re.test(l)) || [0, "💼"])[1];

  // Patrimoine mis en avant : hors prêt de campagne (dette liée au financement d'une campagne électorale)
  const isCamp = (x) => x.montant < 0 && /campagne/i.test(x.label);
  const headNet = (pa) => pa?.net == null ? null : pa.net - (pa.postes || []).filter(isCamp).reduce((s, x) => s + x.montant, 0);
  function patrimoine(id) {
    const p = D.pat?.candidates?.[id];
    if (!D.pat) return "";
    const head = `<div class="pat-head"><h4>💰 Patrimoine et intérêts déclarés</h4><span class="muted small">Source : déclarations officielles (HATVP, Journal officiel)</span></div>`;
    if (!p || p.status === "indisponible") {
      return `<div class="pat">${head}<div class="pat-empty">🔍 Aucune déclaration publique à ce jour pour ${esc(name(id))}.
        <span class="muted small">Les déclarations de patrimoine de tous les candidats seront publiées par le Conseil constitutionnel avec la liste officielle (mars 2027).</span></div></div>`;
    }
    const pa = p.patrimoine, rev = (p.revenus || []).filter((r) => r.montant != null);
    // année retenue : parmi les deux plus récentes, celle au total le plus élevé (l'année en cours est souvent partielle)
    const byYear = {}; rev.forEach((r) => { if (r.annee) byYear[r.annee] = (byYear[r.annee] || 0) + r.montant; });
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a).slice(0, 2);
    const lastYear = years.length ? years.reduce((b, y) => (byYear[y] > byYear[b] ? y : b), years[0]) : null;
    const yearRev = lastYear ? byYear[lastYear] : null;
    const tiles = [];
    const net = headNet(pa), camp = (pa?.postes || []).filter(isCamp);
    if (net != null) {
      const x = net / MEDIAN;
      tiles.push(`<div class="pat-tile big"><small>Patrimoine net${camp.length ? " hors prêt de campagne" : ""}</small><b>${eur(net)}</b>
        <span>${x <= 0 ? "dettes supérieures aux biens déclarés" : x >= 1.1 ? `≈ <strong>${x.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} fois</strong> le patrimoine médian d'un ménage français` : x >= 0.9 ? "≈ le patrimoine médian d'un ménage français" : `≈ <strong>${Math.round(x * 100)} %</strong> du patrimoine médian d'un ménage français`}</span></div>`);
    }
    if (yearRev) {
      const s = yearRev / SMIC_AN;
      tiles.push(`<div class="pat-tile"><small>Revenus déclarés (${lastYear})</small><b>${eur(yearRev)}</b>
        <span>≈ <strong>${s.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} année${s >= 2 ? "s" : ""}</strong> de SMIC net</span></div>`);
    }
    if (p.participations?.length) tiles.push(`<div class="pat-tile"><small>Participations dans des sociétés</small><b>${p.participations.length}</b><span>${p.participations.slice(0, 2).map((x) => esc(x.societe)).join(" · ")}${p.participations.length > 2 ? "…" : ""}</span></div>`);
    const campNote = camp.length ? `<p class="pat-camp">ℹ️ ${camp.map((c) => `${esc(c.label)} : <b>${eur(-c.montant)}</b>`).join(" · ")}. Ce prêt, déclaré au passif, est lié au financement de la campagne et non au patrimoine personnel ; en l'incluant, le solde déclaré est de ${eur(pa.net)}.</p>` : "";
    // composition du patrimoine
    const postes = (pa?.postes || []).filter((x) => x.montant);
    const pos = postes.filter((x) => x.montant > 0), tot = pos.reduce((s, x) => s + x.montant, 0);
    const COLORS = ["#ff2d55", "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#64748b"];
    const bar = tot ? `<div class="pat-bar">${pos.map((x, i) => `<i style="width:${(x.montant / tot) * 100}%;background:${COLORS[i % COLORS.length]}" title="${esc(x.label)} : ${eur(x.montant)}"></i>`).join("")}</div>
      <div class="pat-legend">${postes.map((x, i) => `<span><i style="background:${x.montant > 0 ? COLORS[pos.indexOf(x) % COLORS.length] : "#475569"}"></i>${ico(x.label)} ${esc(x.label)} <b>${eur(x.montant)}</b></span>`).join("")}</div>` : "";
    // classement des patrimoines publiés
    const ranked = Object.entries(D.pat.candidates).filter(([k, v]) => headNet(v.patrimoine) != null && A.C[k]).map(([k, v]) => [k, headNet(v.patrimoine)]).sort((a, b) => b[1] - a[1]);
    const max = ranked[0]?.[1] || 1;
    const rank = net != null && ranked.length > 1 ? `<details class="more pat-rank"><summary>🏆 Classement des patrimoines publiés (${ranked.length} candidats)</summary>
      ${ranked.map(([k, v], i) => `<div class="pr-row ${k === id ? "me" : ""}"><span class="pr-n">${i + 1}</span>${A.avatar(k, 26)}<span class="pr-name">${esc(A.C[k].short)}</span>
        <span class="pr-bar"><i style="width:${Math.max(2, (v / max) * 100)}%;background:${A.C[k].color}"></i></span><b>${eur(v)}</b></div>`).join("")}
      <p class="muted small">Totaux calculés à partir des déclarations (biens moins dettes, hors prêts de campagne), de dates différentes : la comparaison est indicative.</p></details>` : "";
    const parts = p.participations?.length ? `<details class="more"><summary>🏢 Participations et activités déclarées (${p.participations.length})</summary><ul>${p.participations.map((x) => `<li><b>${esc(x.societe)}</b>${x.valeur != null ? ` — ${eur(x.valeur)}` : ""}${x.detail ? ` <span class="muted">(${esc(x.detail)})</span>` : ""}</li>`).join("")}</ul></details>` : "";
    const revs = rev.length ? `<details class="more"><summary>🧾 Détail des revenus déclarés</summary><ul>${rev.sort((a, b) => (b.annee || 0) - (a.annee || 0)).map((r) => `<li>${r.annee || ""} · ${esc(r.label)} : <b>${eur(r.montant)}</b></li>`).join("")}</ul></details>` : "";
    const faits = p.faits?.length ? `<div class="pat-facts">${p.faits.map((f) => `<span>💡 ${esc(f)}</span>`).join("")}</div>` : "";
    const ctx = pa ? `<p class="muted small">Patrimoine : ${esc(pa.contexte || "déclaration")} du ${fdate(pa.date)}${pa.url ? ` — <a href="${esc(pa.url)}" target="_blank" rel="noopener">voir la déclaration</a>` : ""}.` +
      `${p.status === "interets" ? "" : ""}</p>` : `<p class="muted small">Seule la déclaration d'intérêts est publique : la déclaration de patrimoine des parlementaires n'est consultable qu'en préfecture. Celle des candidats sera publiée en mars 2027.</p>`;
    return `<div class="pat">${head}
      ${tiles.length ? `<div class="pat-tiles">${tiles.join("")}</div>` : ""}
      ${bar}${campNote}${faits}${rank}${revs}${parts}${ctx}
      <p class="muted small">Sources : ${(p.sources || []).map(src).join(" · ")}. Le total est calculé par nos soins à partir des lignes déclarées (biens moins dettes). Comparaisons : patrimoine brut médian des ménages 177 200 € (Insee, 2021) ; SMIC net ${SMIC_AN.toLocaleString("fr-FR")} € par an.</p></div>`;
  }

  /* =================== 1 bis. Coût des mesures (chiffrages indépendants) =================== */
  const md = (n) => `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Md€`;
  const amount = (m) => m.montant_md != null ? md(m.montant_md) : m.min_md != null && m.max_md != null ? `${md(m.min_md).replace(" Md€", "")} à ${md(m.max_md)}` : "montant non chiffré";
  function cout(id, topic) {
    const list = (D.cout?.candidates?.[id]?.mesures || []).filter((m) => m.topic === topic);
    if (!list.length) return "";
    return `<div class="cost-list">${list.map((m) => `<div class="cost ${m.sens === "economie" ? "save" : "spend"}">
      <span class="cost-amt">${m.sens === "economie" ? "💰 Économie" : "💸 Coût"} : <b>${amount(m)}</b>${m.horizon ? ` <small>${esc(m.horizon)}</small>` : ""}</span>
      <span class="cost-what">${esc(m.mesure)}</span>
      <span class="cost-src">${src({ label: `${m.source}${m.date ? `, ${new Date(m.date).getFullYear()}` : ""}`, url: m.url })}${(m.annee || 9999) < 2026 ? ` · ⚠️ chiffrage ${m.annee} d'une mesure identique ou proche` : ""}</span>
      ${m.note ? `<details class="cost-note"><summary>ⓘ Hypothèses et réserves</summary>${esc(m.note)}</details>` : ""}</div>`).join("")}</div>`;
  }
  function coutTotal(id) {
    const c = D.cout?.candidates?.[id];
    if (!c) return "";
    const n = (c.mesures || []).length, t = c.total;
    if (!t && !n) return D.cout ? `<p class="cost-none muted small">💸 Aucun chiffrage indépendant publié à ce jour pour ce programme.</p>` : "";
    return `<div class="cost-total">${t ? `<div><small>Coût total estimé du programme</small><b>${t.sens === "economie" ? "−" : "+"}${md(t.montant_md)}</b><span>${esc(t.detail || "par an")} · ${src({ label: t.source, url: t.url })}</span></div>` : ""}
      <p class="cost-info">💸 <b>${n} mesure${n > 1 ? "s" : ""} chiffrée${n > 1 ? "s" : ""}</b> par des organismes indépendants, sous chaque thème ci-dessous.${t ? "" : " ⏳ Aucun programme 2027 n'a encore été chiffré dans son ensemble (l'Institut Montaigne annonce ses chiffrages pour le 1er trimestre 2027) : les montants affichés sont des estimations publiées entre 2022 et 2025 pour des mesures identiques ou proches."} Les estimations varient selon les instituts et les hypothèses.</p></div>`;
  }

  /* =================== 2. Dit à la télé, voté au Parlement =================== */
  const VERDICT = { coherent: ["✅", "Cohérent"], incoherent: ["❌", "En contradiction"], nuance: ["⚖️", "Nuancé"] };
  const POSITION = { pour: "👍 Pour", contre: "👎 Contre", abstention: "✋ Abstention", absent: "💤 Absent", "non-votant": "— Non-votant" };
  const ASSEMBLEE = { an: "Assemblée nationale", senat: "Sénat", pe: "Parlement européen" };
  function initParlement() {
    const box = $("#parl-app");
    if (!box) return;
    const P = D.parl;
    if (!P?.candidates || !Object.keys(P.candidates).length) {
      box.innerHTML = `<div class="empty">Les données parlementaires sont en cours de préparation.</div>`;
      return;
    }
    const ids = Object.keys(P.candidates).filter((id) => A.C[id]);
    let cur = ids[0];
    const ring = (pct) => pct == null ? `<div class="ring na"><b>—</b></div>`
      : `<div class="ring" style="--p:${pct}"><b>${Math.round(pct)} %</b></div>`;
    const render = () => {
      const c = P.candidates[cur], s = c.stats || {}, cmp = c.comparaisons || [];
      const score = { coherent: 0, incoherent: 0, nuance: 0 };
      cmp.forEach((x) => (score[x.verdict] = (score[x.verdict] || 0) + 1));
      box.innerHTML = `
        <div class="avatar-filter parl-picks">${ids.map((id) => `<button class="pick ${id === cur ? "on" : ""}" data-id="${id}">${A.avatar(id, 56)}${esc(A.C[id].short)}</button>`).join("")}</div>
        <div class="sheet" style="--c:${A.C[cur].color}">
          <div class="sheet-head">${A.avatar(cur, 72)}<div><h3>${esc(A.C[cur].name)}</h3><span class="status">${esc(c.mandat)} · ${esc(ASSEMBLEE[c.assemblee] || "")}${c.depuis ? ` · depuis ${esc(c.depuis)}` : ""}</span></div></div>
          <div class="parl-stats">
            <div class="ps">${ring(s.participation_pct)}<small>Participation aux votes</small></div>
            <div class="ps"><b class="num">${s.scrutins != null ? A.fmtN(s.scrutins) : "—"}</b><small>scrutins ${s.periode ? `(${esc(s.periode)})` : ""}</small></div>
            <div class="ps"><b class="num">${s.loyaute_groupe_pct != null ? `${Math.round(s.loyaute_groupe_pct)} %` : "—"}</b><small>Votes alignés sur son groupe</small></div>
            <div class="ps votes3">${[["pour", "👍"], ["contre", "👎"], ["abstention", "✋"]].map(([k, e]) => `<span>${e} <b>${s[k] != null ? A.fmtN(s[k]) : "—"}</b></span>`).join("")}<small>Pour · Contre · Abstention</small></div>
          </div>
          ${c.source_stats ? `<p class="muted small">Statistiques : ${src(c.source_stats)}</p>` : ""}
          <div class="parl-score">${cmp.length ? `<span>Sur ${cmp.length} engagements comparés :</span> <b>✅ ${score.coherent} cohérent${score.coherent > 1 ? "s" : ""}</b> <b>⚖️ ${score.nuance} nuancé${score.nuance > 1 ? "s" : ""}</b> <b>❌ ${score.incoherent} en contradiction</b>` : "Aucune comparaison disponible pour l'instant."}</div>
          <div class="parl-list">${cmp.map((x) => {
            const [e, l] = VERDICT[x.verdict] || ["•", x.verdict];
            return `<article class="pc v-${esc(x.verdict)}">
              <div class="pc-theme">${esc(x.theme)} <span class="verdict">${e} ${l}</span></div>
              <div class="pc-cols">
                <div class="pc-said"><small>📺 Ce qu'il/elle dit</small><p>« ${esc(x.promesse)} »</p><span class="muted small">${src(x.source_promesse)}</span></div>
                <div class="pc-vote"><small>🗳️ Ce qu'il/elle a voté</small><p><b>${esc(POSITION[x.vote?.position] || x.vote?.position || "")}</b> — ${esc(x.vote?.titre)}</p>
                  <span class="muted small">${fdate(x.vote?.date)}${x.vote?.resultat ? ` · texte ${esc(x.vote.resultat)}` : ""}${x.vote?.url ? ` · <a href="${esc(x.vote.url)}" target="_blank" rel="noopener">voir le scrutin</a>` : ""}</span></div>
              </div>
              ${x.explication ? `<p class="pc-why">${esc(x.explication)}</p>` : ""}
            </article>`;
          }).join("")}</div>
        </div>
        ${P.non_parlementaires?.length ? `<p class="muted small">Non concernés (pas de mandat parlementaire en cours) : ${P.non_parlementaires.filter((i) => A.C[i]).map((i) => esc(A.C[i].short)).join(", ")}.</p>` : ""}
        ${P.methode ? `<p class="muted small"><b>Méthode.</b> ${esc(P.methode)}</p>` : ""}`;
    };
    box.addEventListener("click", (e) => { const b = e.target.closest(".pick"); if (b) { cur = b.dataset.id; render(); } });
    render();
  }

  /* =================== 3. Temps de parole (rubrique Buzz) =================== */
  function tempsParole() {
    const T = D.tp, box = $("#tp-app");
    if (!box) return;
    if (!T?.candidates || !Object.keys(T.candidates).some((k) => T.candidates[k]?.total_min != null)) {
      box.innerHTML = `<div class="empty">Les relevés de l'Arcom sont en cours d'intégration.</div>`;
      return;
    }
    const rows = Object.entries(T.candidates).filter(([id, v]) => A.C[id] && v.total_min != null).sort((a, b) => b[1].total_min - a[1].total_min);
    const tot = rows.reduce((s, [, v]) => s + v.total_min, 0) || 1;
    const max = rows[0][1].total_min || 1;
    const pollTot = rows.reduce((s, [id]) => s + (POLL[id] || 0), 0) || 1;
    const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`;
    box.innerHTML = `<div class="tp-head"><div><p class="muted">${esc(T.periode || "")} · télévision et radio · ${src(T.source)}</p></div>
        <div class="tp-legend"><span class="b over">🔊 Plus exposé que son poids dans les sondages</span><span class="b under">🔇 Moins exposé</span></div></div>
      <div class="tp-list">${rows.map(([id, v]) => {
        const share = v.part_pct ?? (v.total_min / tot) * 100;
        const poll = POLL[id] != null ? (POLL[id] / pollTot) * 100 : null;
        const ratio = poll ? share / poll : null;
        const tag = ratio == null ? "" : ratio >= 1.5 ? `<span class="b over">🔊 ×${ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</span>` : ratio <= 0.6 ? `<span class="b under">🔇 ×${ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</span>` : "";
        return `<div class="tp-row">${A.avatar(id, 40)}<div class="tp-main"><div class="tp-top"><b>${esc(A.C[id].short)}</b>${tag}<span class="tp-val">${fmtMin(v.total_min)} · ${share.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</span></div>
          <div class="tp-bar"><i style="width:${(v.total_min / max) * 100}%;background:${A.C[id].color}"></i></div>
          <span class="muted small">${v.tv_min != null ? `📺 TV ${fmtMin(v.tv_min)}` : ""}${v.radio_min != null ? ` · 📻 radio ${fmtMin(v.radio_min)}` : ""}${poll != null ? ` · sondages ${POLL[id].toLocaleString("fr-FR")} %` : ""}</span></div></div>`;
      }).join("")}</div>
      <p class="muted small">« ×2 » : sa part du temps de parole est deux fois plus élevée que sa part dans la moyenne des sondages (15 jours). ${esc(T.note || "")}</p>`;
  }

  /* =================== 4. Parrainages des 500 élus =================== */
  const DEPS = { "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie", "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte" };
  function initParrainages() {
    const box = $("#parr-app");
    if (!box) return;
    const P = D.parr || { status: "pas_ouvert", seuil: 500 };
    const seuil = P.seuil || 500;
    const st = { dep: "" };
    const label = (k) => A.C[k] ? A.C[k].name : k;
    const nf = (n) => Number(n).toLocaleString("fr-FR");
    const bars = (rows, opt = {}) => {
      const max = Math.max(seuil * 1.15, ...rows.map((r) => r.total));
      return `<div class="parr-bars" style="--seuil:${(seuil / max) * 100}%">${rows.map((r) => {
        const id = A.C[r.id] ? r.id : null, ok = r.total >= seuil;
        return `<div class="parr-row ${ok ? "ok" : ""}">${id ? A.avatar(id, 34) : `<span class="parr-ini">${esc((r.nom || "?").slice(0, 1))}</span>`}
          <div class="parr-main"><div class="parr-top"><b>${esc(id ? A.C[id].short : r.nom)}</b><span>${nf(r.total)}${ok ? " ✅" : ` <small class="muted">· encore ${nf(seuil - r.total)}</small>`}${r.departements != null ? ` <small class="muted">· ${r.departements} territoires</small>` : ""}</span></div>
          <div class="parr-bar"><i style="width:${(r.total / max) * 100}%;background:${id ? A.C[id].color : "#64748b"}"></i><em class="seuil"></em></div></div></div>`;
      }).join("")}</div>${opt.foot || ""}`;
    };
    const depSelect = (list) => `<label class="parr-dep">📍 Mon département <select id="parr-dep"><option value="">— Choisir —</option>${list.map((c) => `<option value="${c}" ${c === st.dep ? "selected" : ""}>${c} · ${esc(DEPS[c] || c)}</option>`).join("")}</select></label>`;
    const rules = `<div class="parr-rules">
      <div><b>500</b><small>signatures d'élus au minimum</small></div>
      <div><b>30</b><small>départements ou collectivités d'outre-mer différents</small></div>
      <div><b>10 %</b><small>au plus venant d'un même département (50 signatures)</small></div>
      <div><b>≈ 42 000</b><small>élus habilités : maires, parlementaires, conseillers départementaux et régionaux…</small></div></div>`;
    const render = () => {
      let html = "";
      if (P.status === "en_cours" || P.status === "clos") {
        const rows = Object.entries(P.candidates || {}).map(([id, v]) => ({ id, nom: label(id), ...v })).sort((a, b) => b.total - a.total);
        const deps = [...new Set((P.parrains || []).map((p) => p.dep_code).filter(Boolean))].sort();
        const mine = st.dep ? (P.parrains || []).filter((p) => p.dep_code === st.dep) : [];
        const byC = {}; mine.forEach((p) => (byC[p.candidat] = byC[p.candidat] || []).push(p));
        html = `<div class="parr-status live">${P.status === "clos" ? "🔒 Dépôt des parrainages clos" : "🔴 En direct"} · mis à jour le ${fdate(P.updated)} · ${src(P.source)}</div>
          ${bars(rows)}
          <div class="parr-depbox">${depSelect(deps)}
            ${st.dep ? Object.entries(byC).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => `<details class="more" open><summary>${A.C[k] ? A.avatar(k, 22) : ""} ${esc(label(k))} — ${list.length} parrainage${list.length > 1 ? "s" : ""} dans ce département</summary>
              <ul class="parr-names">${list.map((p) => `<li><b>${esc(p.prenom)} ${esc(p.nom)}</b> · ${esc(p.mandat)}${p.circonscription ? ` (${esc(p.circonscription)})` : ""}</li>`).join("")}</ul></details>`).join("") || `<p class="muted">Aucun parrainage publié pour ce département.</p>` : `<p class="muted small">Choisissez votre département pour voir quels élus ont parrainé qui.</p>`}
          </div>`;
      } else {
        const ouv = P.ouverture ? fdate(P.ouverture) : "fin février 2027 (après le décret de convocation)";
        const a22 = P.archive_2022;
        const rows22 = (a22?.totaux || []).map((r) => ({ id: Object.keys(A.C).find((k) => A.C[k].name === r.nom) || "", ...r })).sort((a, b) => b.total - a.total);
        const deps22 = Object.keys(a22?.par_departement || {}).sort();
        html = `<div class="parr-status wait">⏳ La collecte des parrainages pour 2027 n'a pas encore commencé. Ouverture prévue : <b>${esc(ouv)}</b>${P.cloture ? `, clôture le ${fdate(P.cloture)}` : ""}. Le suivi se mettra à jour automatiquement, chaque jour, dès la première publication du Conseil constitutionnel.</div>
          ${rules}
          ${rows22.length ? `<h2 class="parr-h">🗂️ Pour mémoire : les parrainages de 2022</h2>${bars(rows22, { foot: `<p class="muted small">Source : ${src({ label: "Conseil constitutionnel", url: a22.source })}. La barre verticale marque le seuil des 500.</p>` })}
            ${deps22.length ? `<div class="parr-depbox">${depSelect(deps22)}${st.dep ? `<div class="parr-dep22">${(a22.par_departement[st.dep] || []).map((r) => `<span><b>${esc(r.nom)}</b> ${nf(r.total)}</span>`).join("")}</div>` : `<p class="muted small">Choisissez un département pour voir à qui ses élus ont donné leur parrainage en 2022.</p>`}</div>` : ""}` : ""}`;
      }
      box.innerHTML = html;
      const sel = $("#parr-dep", box);
      if (sel) sel.onchange = () => { st.dep = sel.value; render(); };
    };
    render();
  }

  function init(app, polls) {
    A = app;
    POLL = polls?.windows?.[String(polls.default_window)]?.average || polls?.average || {};
    initParlement(); tempsParole(); initParrainages();
  }
  window.Extras = { load, init, patrimoine, cout, coutTotal };
})();
