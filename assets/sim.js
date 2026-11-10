/* Simulateur « Impact sur mon quotidien » : particuliers, entreprises, portrait idéologique.
   Tous les calculs se font dans le navigateur : aucune donnée saisie n'est envoyée,
   sauf le SIRET (recherche publique sur recherche-entreprises.api.gouv.fr). */
(() => {
  "use strict";
  let A, S, P; // A = utilitaires de app.js, S = data/simulateur.json, P = paramètres
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const eur = (n) => (n < 0 ? "−" : n > 0 ? "+" : "") + Math.abs(Math.round(n)).toLocaleString("fr-FR") + " €";
  const eurPlain = (n) => Math.round(n).toLocaleString("fr-FR") + " €";
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };

  /* ------------ Impôt sur le revenu (barème 2025, indicatif) ------------ */
  function bareme(r) {
    let tax = 0, prev = 0;
    for (const [lim, rate] of P.bareme_ir) {
      const top = lim ?? Infinity;
      if (r > prev) tax += (Math.min(r, top) - prev) * rate;
      prev = top;
    }
    return tax;
  }
  function parts(u) {
    const couple = u.situation === "marie";
    let p = couple ? 2 : 1;
    const k = u.enfants;
    p += Math.min(k, 2) * 0.5 + Math.max(0, k - 2) + (u._xp || 0);
    if (!couple && k > 0) p += 0.5; // parent isolé (case T)
    return { p, base: couple ? 2 : 1, couple };
  }
  function impotRevenu(R, u) {
    const { p, base, couple } = parts(u);
    if (R <= 0) return 0;
    const brut = bareme(R / p) * p;
    const ref = bareme(R / base) * base;
    let t = Math.max(brut, ref - (p - base) * 2 * P.plafond_demi_part);
    const [seuil, forfait] = couple ? P.decote.couple : P.decote.seul;
    if (t < seuil) t -= Math.max(0, forfait - 0.4525 * t);
    return Math.max(0, Math.round(t));
  }

  /* ------------ Retraite ------------ */
  function retraite(u, rule) {
    if (!rule) return null;
    const debut = u.debut || 22;
    let { age, annees } = rule;
    if (rule.longue && debut < rule.longue.debut_avant) ({ age, annees } = rule.longue);
    // âge où la durée requise est atteinte : à partir des années déjà cotisées si connues,
    // sinon depuis le début de carrière (carrière continue)
    const ageAnnees = u.annees > 0 ? u.age + Math.max(0, annees - u.annees) : debut + annees;
    const depart = Math.min(67, Math.max(age, Math.ceil(ageAnnees)));
    return { depart, annee: new Date().getFullYear() + (depart - u.age), legal: age, annees };
  }

  /* ------------ Moteur de mesures (data/mesures_fiscales.json) ------------
     Chaque mesure : { c: id candidat, t: thème, l: libellé, calc, p: paramètres, si: conditions,
                       n: note, k: kind forcé, once: versement unique, src, fiab }.
     Convention : amount > 0 = gain pour le foyer / l'entreprise, < 0 = coût. */
  let MF = null; // mesures chargées
  const FIAB = { programme_2027: "Programme 2027", declaration_2026: "Déclaration 2026", programme_2022_ou_2024: "Programme 2022 / 2024 (à confirmer)", piste_non_confirmee: "Piste non confirmée" };

  function cond(o, si) {
    if (!si) return true;
    for (const [f, v] of Object.entries(si.min || {})) if (!((o[f] || 0) >= v)) return false;
    for (const [f, v] of Object.entries(si.max || {})) if (!((o[f] || 0) <= v)) return false;
    for (const [f, v] of Object.entries(si.in || {})) if (!v.includes(o[f])) return false;
    for (const [f, v] of Object.entries(si.notin || {})) if (v.includes(o[f])) return false;
    for (const [f, v] of Object.entries(si.has || {})) if (!(o[f] || []).includes(v)) return false;
    if (si.nonfr && !(o.nationalite && o.nationalite !== "francaise")) return false;
    if (si.secteurs && !si.secteurs.includes(o.secteur_cat)) return false;
    return true;
  }

  // droits de succession en ligne directe, pour un enfant (barème actuel, abattement 100 000 €)
  const BAR_SUCC = [[8072, 0.05], [12109, 0.10], [15932, 0.15], [552324, 0.20], [902838, 0.30], [1805677, 0.40], [null, 0.45]];
  function droitsSucc(h, abatt = 100000) {
    let r = Math.max(0, h - abatt), t = 0, prev = 0;
    for (const [lim, rate] of BAR_SUCC) { const top = lim ?? Infinity; if (r > prev) t += (Math.min(r, top) - prev) * rate; prev = top; }
    return t;
  }
  // barème progressif générique [[plafond, taux], …] appliqué au-delà d'un seuil
  const progressif = (x, bar) => { let t = 0, prev = 0; for (const [lim, rate] of bar) { const top = lim ?? Infinity; if (x > prev) t += (Math.min(x, top) - prev) * rate; prev = top; } return t; };

  const CALC_P = {
    fixe: (u, p) => p.montant,
    // variation d'un poste du formulaire (€/mois si p.mensuel) : pct = variation du coût (−1 = suppression)
    champ: (u, p) => -(u[p.champ] || 0) * (p.mensuel ? 12 : 1) * p.pct,
    tva: (u, p) => { const b = (u[p.base] || 0) * 12 * (p.part ?? 1); return b * (1 - (1 + p.taux) / (1 + (p.actuel ?? P.tva_normale))); },
    smic: (u, p) => (["salarie_prive", "fonctionnaire"].includes(u.statut) && u.net > 0 && u.net < p.cible ? (p.cible - u.net) * 12 : 0),
    salaire_pct: (u, p) => (u.net || 0) * 12 * p.pct,
    salaire_plafond: (u, p) => Math.min((u.net || 0) * p.pct, p.plafond_mois ?? Infinity) * 12,
    ir_pct: (u, p, X) => { const rp = u.revenu / parts(u).p; const k = (p.paliers.find(([m]) => m == null || rp < m) || [0, 0])[1]; return -X.ir * k; },
    ir_exo: (u, p, X) => X.ir * (p.pct ?? 1),
    capital: (u, p) => (u.capital || 0) * ((p.actuel ?? P.pfu) - p.taux),
    isf: (u, p) => (u.patrimoine > p.seuil ? -(p.bareme ? progressif(u.patrimoine - (p.abattement ?? 0), p.bareme) : (u.patrimoine - p.seuil) * p.taux) : 0),
    succession: (u, p) => { const h = u.heritage || 0; if (!h) return 0; const old = droitsSucc(h); const nw = p.plafond && h > p.plafond ? droitsSucc(p.plafond, p.abattement ?? 100000) + (h - p.plafond) * (p.taux_au_dela ?? 1) : droitsSucc(h, p.abattement ?? 100000) * (p.facteur ?? 1); return old - nw; },
    aides: (u, p) => -(u.aides_montant || 0) * 12 * (p.pct ?? 1),
    // part supplémentaire (ex. part pleine dès le 2e enfant)
    ir_parts: (u, p, X) => (u.enfants >= (p.des_enfant ?? 2) ? X.ir - impotRevenu(u.revenu, { ...u, _xp: p.extra ?? 0.5 }) : 0),
    // exonération jusqu'à un plafond de revenu (ex. 4 SMIC)
    ir_exo_plafond: (u, p, X) => X.ir * Math.min(1, (p.plafond || Infinity) / Math.max(1, u.revenu)),
    // CSG : baisse de n points sur le salaire (assiette 98,25 % du brut)
    csg: (u, p) => (u.net > 0 && u.net <= (p.net_max ?? Infinity) ? (u.net / P.net_vers_brut) * 0.9825 * p.points * 12 : 0),
    // gain mensuel par paliers de salaire net [[net_max, €/mois], …]
    net_paliers: (u, p) => { if (!(u.net > 0)) return 0; const r = p.paliers.find(([m]) => m == null || u.net <= m); return r ? r[1] * 12 : 0; },
    smic_ou_pct: (u, p) => { if (!["salarie_prive", "fonctionnaire"].includes(u.statut) || !(u.net > 0)) return 0; return Math.max(u.net < p.cible ? (p.cible - u.net) * 12 : 0, u.net * 12 * p.pct); },
    // flat tax supprimée : revenus du capital au barème (TMI + prélèvements sociaux), jamais mieux que l'option actuelle
    capital_bareme: (u, p, X) => { const t = X.tmi + 0.186; return -(u.capital || 0) * Math.max(0, t - Math.min(P.pfu, t)); },
    // impôt sur la fortune : nouveau barème sur une assiette, moins l'IFI actuel
    fortune: (u, p, X) => {
      const base = p.assiette === "financier" ? Math.max(0, u.patrimoine - (u.immobilier || 0)) : u.patrimoine;
      const nouveau = base > p.seuil ? progressif(base, p.bareme || BAR_ISF) * (p.facteur ?? 1) : 0;
      return X.ifi - nouveau;
    },
    ifi_supp: (u, p, X) => X.ifi,
    zucman: (u, p, X) => (u.patrimoine >= p.seuil ? -Math.max(0, u.patrimoine * p.taux - X.ir) : 0),
    succ_exo_sous: (u, p) => (u.heritage > 0 && u.heritage <= p.seuil ? droitsSucc(u.heritage) : 0),
    succ_supp: (u) => droitsSucc(u.heritage || 0),
    // allocations familiales : nouveau montant mensuel moins les AF actuelles (taux plein, sans modulation)
    af: (u, p) => { const k = u.enfants || 0; if (!k) return 0; const nv = p.forfait ?? (p.par_enfant * k + (k >= 3 ? p.bonus_3e ?? 0 : 0)); return (nv - afActuelles(k)) * 12; },
    aides_plafond: (u, p) => { const pl = p.pct_smic * P.smic_net_mensuel * (u.situation === "marie" || u.situation === "concubin" ? 2 : 1); return -Math.max(0, (u.aides_montant || 0) - pl) * 12; },
    apl_pct: (u, p) => ((u.aides || []).length === 1 && u.aides[0] === "apl" ? (u.aides_montant || 0) * 12 * p.pct : 0),
    heures_sup: (u, p, X) => (u.heures_sup || 0) * (p.taux === "tmi" ? -(0.113 + X.tmi) : p.taux),
    // carburant : baisse en €/litre (part carburant de la dépense d'énergie, prix moyen au litre)
    carburant: (u, p) => ((u.energie || 0) * (p.part ?? 0.5) / (p.prix ?? 1.8)) * p.baisse * 12,
    // variation d'un poste de la facture d'énergie (part du poste dans la dépense mensuelle)
    energie_part: (u, p) => -(u.energie || 0) * 12 * p.part * p.pct,
  };

  // Entreprise
  const COTIS_TAUX = 0.27; // taux moyen de cotisations patronales après allègements (hypothèse)
  const cotisEst = (e) => e.cotis_pat > 0 ? e.cotis_pat : (e.masse || 0) * COTIS_TAUX;
  const coutSmic = (cible, n) => n > 0 ? -n * ((cible - P.smic_net_mensuel) / P.net_vers_brut) * P.charges_patronales_smic * 12 : 0;
  const soumisIS = (e) => !["micro", "ei", "asso"].includes(e.forme);
  function isCalc(e, q) {
    if (!soumisIS(e) || e.resultat <= 0) return 0;
    const pme = e.ca < (q.pme_ca ?? 10e6);
    let t = pme ? Math.min(e.resultat, q.seuil ?? P.is_seuil_reduit) * (q.reduit ?? P.is_taux_reduit) + Math.max(0, e.resultat - (q.seuil ?? P.is_seuil_reduit)) * (q.normal ?? P.is_taux_normal) : e.resultat * (q.normal ?? P.is_taux_normal);
    if (q.surtaxe && e.ca >= q.surtaxe.seuil_ca) t += t * q.surtaxe.taux;
    return t;
  }
  const isActuel = (e) => isCalc(e, {});
  const CALC_E = {
    fixe: (e, p) => p.montant,
    is: (e, p) => isActuel(e) - isCalc(e, p),
    cotis: (e, p) => -cotisEst(e) * p.pct,
    champ: (e, p) => -(e[p.champ] || 0) * p.pct,
    c3s: (e, p) => -Math.max(0, (e.ca || 0) - 19e6) * 0.0016 * p.pct,
    taux_base: (e, p) => -Math.max(0, (e[p.base] || 0) - (p.franchise ?? 0)) * p.taux,
    smic: (e, p) => coutSmic(p.cible, e.nb_smic),
    par_salarie: (e, p) => { const v = -(e.effectif || 0) * p.montant; return p.plafond_dividendes ? -Math.min(-v, Math.max(e.dividendes || 0, 0)) : v; },
    associes: (e, p) => (e.dividendes || 0) * ((p.actuel ?? P.pfu) - p.taux),
    hors_ue: (e, p) => -(e.achats || 0) * ((e.import_hors_ue || 0) / 100) * p.taux,
    // impôts de production : variation de chaque impôt (−1 = suppression)
    prod: (e, p) => -((e.cfe || 0) * (p.cfe ?? 0) + (e.cvae || 0) * (p.cvae ?? 0) + Math.max(0, (e.ca || 0) - 19e6) * 0.0016 * (p.c3s ?? 0) + (e.tf_ent || 0) * (p.tf ?? 0)),
    is_reinvesti: (e, p) => (e.resultat > 0 ? isActuel(e) * p.pct * Math.max(0, 1 - (e.dividendes || 0) / e.resultat) : 0),
    is_min: (e, p) => -Math.max(0, (e.resultat || 0) * p.taux - isActuel(e)),
    masse_pct: (e, p) => -(e.masse || 0) * p.pct * (1 + COTIS_TAUX),
  };

  function runMesures(target, obj, X) {
    const M = {}, calc = target === "ent" ? CALC_E : CALC_P;
    for (const m of (MF?.[target] || [])) {
      if (!A.C[m.c] || !cond(obj, m.si)) continue;
      const f = calc[m.calc];
      let amount = f ? f(obj, m.p || {}, X) : 0;
      if (!isFinite(amount)) amount = 0;
      if (m.min_abs && Math.abs(amount) < m.min_abs) continue;
      (M[m.c] = M[m.c] || []).push({ theme: m.t, label: m.l, amount, note: m.n, once: !!m.once, fiab: m.fiab, src: m.src,
        kind: m.k || (amount > 0 ? "gain" : amount < 0 ? "cost" : "neutral") });
    }
    return M;
  }
  const BAR_ISF = [[800000, 0], [1300000, 0.005], [2570000, 0.007], [5000000, 0.01], [10000000, 0.0125], [null, 0.015]];
  const afActuelles = (k) => (k < 2 ? 0 : 151.05 + (k >= 3 ? 193.53 * (k - 2) : 0)); // AF 2026, taux plein
  const tmi = (u) => { const r = u.revenu / parts(u).p; let t = 0, prev = 0; for (const [lim, rate] of P.bareme_ir) { if (r > prev) t = rate; prev = lim ?? Infinity; } return t; };
  const mesuresParticulier = (u) => {
    const ir = impotRevenu(u.revenu, u);
    const ifi = (u.immobilier || 0) > 1.3e6 ? progressif(u.immobilier, BAR_ISF) : 0;
    return { M: runMesures("part", u, { ir, ifi, tmi: tmi(u) }), irActuel: ir };
  };
  const mesuresEntreprise = (e) => ({ M: runMesures("ent", e, {}), is: isActuel(e) });

  /* ------------ Rendu ------------ */
  const KIND = { gain: ["▲", "var(--pos)"], cost: ["▼", "var(--neg)"], risk: ["⚠", "#ffb020"], neutral: ["•", "var(--muted)"] };
  function renderImpacts(target, M, ids, intro) {
    const rows = ids.map((id) => {
      const list = M[id] || [];
      const total = list.reduce((a, m) => a + (m.once ? 0 : m.amount || 0), 0);
      return { id, list, total };
    }).sort((a, b) => (b.id === window.SimFocus) - (a.id === window.SimFocus) || b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.total)));
    target.innerHTML = intro + rows.map((r) => `
      <details class="imp ${r.id === window.SimFocus ? "focus" : ""}" ${r.id === window.SimFocus ? "open" : ""}>
        <summary>
          <span class="imp-who">${A.avatar(r.id, 40)}<span><strong>${A.esc(A.C[r.id].name)}</strong><small>${r.list.length} mesure(s) vous concernant</small></span></span>
          <span class="imp-bar"><i style="width:${(Math.abs(r.total) / max) * 50}%;${r.total >= 0 ? "left:50%;background:var(--pos)" : `right:50%;background:var(--neg)`}"></i></span>
          <span class="imp-total" style="color:${r.total > 0 ? "var(--pos)" : r.total < 0 ? "var(--neg)" : "var(--muted)"}">${r.total ? eur(r.total) + "<small>/an</small>" : "non chiffré"}</span>
        </summary>
        <ul>${r.list.map((m) => `<li><span class="k" style="color:${KIND[m.kind][1]}">${KIND[m.kind][0]}</span><div><strong>${A.esc(m.theme)} — ${A.esc(m.label)}</strong>${m.amount ? ` <span style="color:${m.amount > 0 ? "var(--pos)" : "var(--neg)"}">${eur(m.amount)}${m.once ? " <small>(une fois)</small>" : "/an"}</span>` : ""}<br><small>${A.esc(m.note || "")}${m.fiab || m.src ? ` <span class="fiab">${m.fiab ? A.esc(FIAB[m.fiab] || m.fiab) : ""}${m.src ? ` · <a href="${A.esc(m.src)}" target="_blank" rel="noopener">source</a>` : ""}</span>` : ""}</small></div></li>`).join("") || "<li><span class='k'>•</span><div>Aucune mesure identifiée qui vous concerne directement.</div></li>"}</ul>
      </details>`).join("");
  }

  function readForm(form) {
    const o = {};
    $$("input, select", form).forEach((el) => {
      if (el.type === "checkbox") { if (el.checked) (o[el.name] = o[el.name] || []).push(el.value); }
      else o[el.name] = el.type === "number" ? num(el.value) : el.value;
    });
    return o;
  }

  const whenReady = (fn) => (MF ? fn() : setTimeout(() => whenReady(fn), 150));
  function simParticulier() {
    if (!MF) return whenReady(simParticulier);
    const f = $("#sim-part");
    const u = readForm(f);
    u.aides = u.aides || [];
    const { M, irActuel } = mesuresParticulier(u);
    const ids = Object.keys(S.stances).filter((id) => A.C[id]);
    // Retraite
    let retr = "";
    if (u.statut !== "retraite" && u.age && u.age < 67) {
      const act = retraite(u, S.retraite.actuel);
      const cells = ids.filter((id) => S.retraite[id]).map((id) => {
        const r = retraite(u, S.retraite[id]);
        const d = r.depart - act.depart;
        return { id, r, d };
      }).sort((a, b) => a.r.depart - b.r.depart);
      retr = `<h3>⏳ Votre départ à la retraite à taux plein</h3>
        <p class="muted small">Né(e) en ${new Date().getFullYear() - u.age}, ${u.annees > 0 ? `${u.annees} année(s) déjà cotisée(s)` : `début de carrière à ${u.debut || 22} ans`}, carrière supposée continue ensuite. Règle actuelle (${S.retraite.actuel.label}) : <strong>${act.depart} ans, en ${act.annee}</strong>.</p>
        <div class="retr">${cells.map((c) => `<div class="retr-c">${A.avatar(c.id, 30)}<span>${A.esc(A.C[c.id].short)}</span><strong>${c.r.depart} ans</strong><small style="color:${c.d < 0 ? "var(--pos)" : c.d > 0 ? "var(--neg)" : "var(--muted)"}">${c.d ? (c.d > 0 ? "+" : "") + c.d + " an" + (Math.abs(c.d) > 1 ? "s" : "") : "="}${S.retraite[c.id].hyp ? " · hyp." : ""}</small></div>`).join("")}</div>`;
    }
    const pr = parts(u);
    const intro = `<div class="sim-sum">
        <div><small>Impôt sur le revenu estimé aujourd'hui</small><strong>${eurPlain(irActuel)}</strong><small>${pr.p} part(s) · barème 2025</small></div>
        <div><small>Revenu imposable du foyer</small><strong>${eurPlain(u.revenu)}</strong><small>par an</small></div>
        <div><small>Aides déclarées</small><strong>${eurPlain(u.aides_montant * 12)}</strong><small>par an</small></div>
      </div>${retr}<h3>💶 Effet des programmes sur votre budget annuel</h3>
      <p class="muted small">Ordres de grandeur calculés à partir des mesures annoncées et des hypothèses indiquées sous chaque mesure. Cliquez sur un candidat pour voir le détail.</p>`;
    renderImpacts($("#sim-part-out"), M, ids, intro);
    $("#sim-part-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ------------ Entreprise : SIRET ------------ */
  const TRANCHES = { "00": 0, "01": 1.5, "02": 4, "03": 7.5, "11": 15, "12": 35, "21": 75, "22": 150, "31": 225, "32": 375, "41": 750, "42": 1500, "51": 3500, "52": 7500, "53": 10000 };
  function formeDepuisCode(code, comp) {
    const c = String(code || "");
    if (comp?.est_entrepreneur_individuel || c.startsWith("1")) return "ei";
    if (c === "5498" || c === "5499" || c.startsWith("54")) return "eurl_sarl";
    if (c === "5710" || c === "5720" || c.startsWith("57")) return "sas_sasu";
    if (c.startsWith("55") || c.startsWith("56")) return "sa";
    if (c.startsWith("92")) return "asso";
    return "autre";
  }
  function secteurDepuisNAF(naf) {
    const c = String(naf || "").replace(/\s/g, ""), d = parseInt(c, 10), n4 = c.slice(0, 5);
    if (!c || isNaN(d)) return "";
    if (n4 === "52.21" || n4 === "52.21") return "autoroutes";
    if (n4 === "47.11") return "grande_distribution";
    if (n4 === "25.40" || n4 === "30.40") return "armement";
    if (d === 35 || d === 6 || d === 19) return "energie";
    if (d === 65) return "assurance";
    if (d === 64 || d === 66) return "banque";
    if (d >= 58 && d <= 63) return "numerique";
    if (d === 51) return "transport_aerien";
    if (d === 50) return "transport_maritime";
    if (d === 21) return "pharma";
    if (d >= 1 && d <= 3) return "agriculture";
    if (d >= 5 && d <= 33) return "industrie";
    if (d >= 41 && d <= 43) return "btp";
    if (d === 55 || d === 56) return "hotellerie_restauration";
    if (d >= 45 && d <= 47) return "commerce";
    return "services";
  }
  async function lookupSiret() {
    const f = $("#sim-ent");
    const q = f.siret.value.replace(/\s/g, "");
    const msg = $("#siret-msg");
    if (!/^\d{9}(\d{5})?$/.test(q)) { msg.textContent = "Saisissez un SIREN (9 chiffres) ou un SIRET (14 chiffres)."; return; }
    msg.textContent = "Recherche…";
    try {
      const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${q}&per_page=1`);
      const d = (await r.json()).results?.[0];
      if (!d) { msg.textContent = "Aucune entreprise trouvée."; return; }
      f.nom.value = d.nom_complet || "";
      f.forme.value = formeDepuisCode(d.nature_juridique, d.complements);
      f.secteur.value = d.activite_principale || "";
      if (secteurDepuisNAF(f.secteur.value)) f.secteur_cat.value = secteurDepuisNAF(f.secteur.value);
      const eff = TRANCHES[d.tranche_effectif_salarie];
      if (eff != null) f.effectif.value = Math.round(eff);
      const years = Object.keys(d.finances || {}).sort();
      if (years.length) {
        const fin = d.finances[years[years.length - 1]];
        if (fin.ca != null) f.ca.value = fin.ca;
        if (fin.resultat_net != null) f.resultat.value = fin.resultat_net;
      }
      msg.innerHTML = `✓ <strong>${A.esc(d.nom_complet)}</strong> · ${A.esc(d.categorie_entreprise || "")} · créée le ${A.esc(d.date_creation || "?")}${years.length ? ` · comptes ${years[years.length - 1]}` : " · comptes non publiés"}. Vérifiez et complétez les champs.`;
    } catch (e) {
      msg.textContent = "Service de recherche indisponible, saisissez les informations à la main.";
    }
  }
  function simEntreprise() {
    if (!MF) return whenReady(simEntreprise);
    const e = readForm($("#sim-ent"));
    const { M, is } = mesuresEntreprise(e);
    const ids = Object.keys(S.stances).filter((id) => A.C[id]);
    const intro = `<div class="sim-sum">
        <div><small>${A.esc(e.nom || "Votre entreprise")}</small><strong>${eurPlain(e.ca)}</strong><small>chiffre d'affaires</small></div>
        <div><small>Impôt sur les sociétés estimé</small><strong>${["micro", "ei", "asso"].includes(e.forme) ? "—" : eurPlain(is)}</strong><small>${["micro", "ei"].includes(e.forme) ? "imposition à l'IR du dirigeant" : "taux 15 % / 25 %"}</small></div>
        <div><small>Effectif</small><strong>${e.effectif || 0}</strong><small>dont ${e.nb_smic || 0} au SMIC</small></div>
      </div><h3>🏢 Effet des programmes sur votre entreprise</h3>
      <p class="muted small">Montants annuels estimés quand la mesure est chiffrable ; sinon, effet qualitatif (▲ favorable, ▼ défavorable, ⚠ risque).</p>`;
    renderImpacts($("#sim-ent-out"), M, ids, intro);
    $("#sim-ent-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ------------ Portrait idéologique (réutilisé par la rubrique Fun) ------------ */
  const CHOICES = [["-2", "Pas du tout"], ["-1", "Plutôt pas"], ["0", "Sans avis"], ["1", "Plutôt"], ["2", "Tout à fait"]];
  function quizHTML(prefix = "", values = {}) {
    return S.quiz.map((q, i) => `<fieldset class="qz"><legend>${i + 1}. ${A.esc(q.q)}</legend>
      ${CHOICES.map(([v, l]) => `<label><input type="radio" name="${prefix}${q.id}" value="${v}"${String(values[q.id] ?? 0) === v ? " checked" : ""}><span>${l}</span></label>`).join("")}
    </fieldset>`).join("");
  }
  function readAnswers(prefix = "", root = document) {
    const ans = {};
    S.quiz.forEach((q) => (ans[q.id] = +(root.querySelector(`input[name="${prefix}${q.id}"]:checked`)?.value || 0)));
    return ans;
  }
  // position sur chaque axe, de -1 (libellé de gauche) à +1 (libellé de droite)
  function axisPos(st) {
    const out = {};
    Object.keys(S.axes).forEach((ax) => {
      const qs = S.quiz.filter((q) => q.axe === ax);
      out[ax] = qs.reduce((a, q) => a + (q.inv ? -1 : 1) * (st[q.id] ?? 0), 0) / (qs.length * 2);
    });
    return out;
  }
  function compute(ans) {
    const answered = S.quiz.filter((q) => ans[q.id] !== 0);
    const ids = Object.keys(S.stances).filter((id) => A.C[id]);
    const qs = answered.length ? answered : S.quiz;
    const prox = ids.map((id) => {
      const st = S.stances[id];
      const d = qs.reduce((a, q) => a + Math.abs(ans[q.id] - (st[q.id] ?? 0)), 0) / qs.length;
      return { id, pct: Math.round((1 - d / 4) * 100) };
    }).sort((a, b) => b.pct - a.pct);
    return { prox, axes: axisPos(ans), answered: answered.length };
  }
  // dots = [{label, pos:{axe:val}, cls}] supplémentaires (ex. moyenne d'un groupe)
  function axesHTML(me, top, meLabel = "VOUS", extra = []) {
    return `<div class="axes">${Object.entries(S.axes).map(([ax, [l, r]]) => `<div class="axe"><div class="axe-l"><span>${l}</span><span>${r}</span></div>
      <div class="axe-track">${top.map((t) => `<span class="axe-dot" title="${A.esc(A.C[t.id].short)}" style="left:${(axisPos(S.stances[t.id])[ax] + 1) * 50}%">${A.avatar(t.id, 24)}</span>`).join("")}
      ${extra.map((e) => `<span class="axe-me ${e.cls || ""}" style="left:${(e.pos[ax] + 1) * 50}%">${A.esc(e.label)}</span>`).join("")}
      ${me ? `<span class="axe-me" style="left:${(me[ax] + 1) * 50}%">${A.esc(meLabel)}</span>` : ""}</div></div>`).join("")}</div>`;
  }
  const proxHTML = (prox) => `<div class="prox">${prox.map((p) => `<div class="prox-r">${A.avatar(p.id, 28)}<span>${A.esc(A.C[p.id].name)}</span><span class="prox-b"><i style="width:${p.pct}%;background:${A.C[p.id].color === "#404040" ? "#8a8f98" : A.C[p.id].color}"></i></span><strong>${p.pct} %</strong>${p.partial ? `<small class="muted" title="Positions trop peu connues sur le questionnaire approfondi : comparé sur le questionnaire de base">*</small>` : ""}</div>`).join("")}${prox.some((p) => p.partial) ? `<p class="muted small">* Comparé sur le questionnaire de base seulement : positions publiques encore trop peu connues sur les sujets approfondis.</p>` : ""}</div>`;
  function portraitHTML(res, title = "🧭 Votre portrait idéologique", withAxes = true) {
    return `${withAxes ? `<h3>${title}</h3>
      ${res.answered < 5 ? `<p class="warn">Répondez à au moins 5 affirmations pour un portrait fiable (${res.answered} réponse(s) pour l'instant).</p>` : ""}
      ${axesHTML(res.axes, res.prox.slice(0, 3))}` : ""}
      <h3>Candidats les plus proches de vos réponses</h3>${proxHTML(res.prox)}
      <p class="muted small">Proximité = écart moyen entre vos réponses et notre lecture des positions publiques de chaque candidat. Indicatif : ce n'est pas une consigne de vote.</p>`;
  }
  /* Portrait du simulateur : une affirmation par écran (précédent / suivant) */
  const QZ = { i: 0, ans: {} };
  function renderQuiz() {
    const qs = S.quiz, n = qs.length, box = $("#quiz");
    const done = qs.filter((q) => QZ.ans[q.id] !== undefined).length;
    const dots = `<div class="st-prog"><i style="width:${(Math.min(QZ.i, n) / n) * 100}%"></i></div>
      <div class="st-dots">${qs.map((q, k) => `<button type="button" class="st-dot ${k === QZ.i ? "cur" : ""} ${QZ.ans[q.id] !== undefined ? "done" : ""}" data-go="${k}" aria-label="Question ${k + 1}"></button>`).join("")}</div>`;
    if (QZ.i < n) {
      const q = qs[QZ.i], cur = QZ.ans[q.id];
      box.innerHTML = `${dots}<div class="st-card"><div class="st-num">Question ${QZ.i + 1} / ${n}</div><p class="st-q">${A.esc(q.q)}</p>
        <div class="st-choices">${CHOICES.map(([v, l]) => `<button type="button" class="st-ch ${String(cur) === v ? "on" : ""}" data-v="${v}">${l === "Plutôt" ? "Plutôt d'accord" : l === "Plutôt pas" ? "Plutôt pas d'accord" : l === "Pas du tout" ? "Pas du tout d'accord" : l === "Tout à fait" ? "Tout à fait d'accord" : l}</button>`).join("")}</div></div>
        <div class="st-nav"><button type="button" class="ghost" id="qz-prev" ${QZ.i === 0 ? "disabled" : ""}>← Précédent</button>
          <span class="muted small">${done} réponse${done > 1 ? "s" : ""} sur ${n}</span>
          <button type="button" class="cta small" id="qz-next">${QZ.i === n - 1 ? "Voir mon portrait →" : cur === undefined ? "Passer →" : "Suivant →"}</button></div>`;
    } else {
      box.innerHTML = `${dots}<div class="st-nav"><button type="button" class="ghost" id="qz-prev">← Modifier mes réponses</button><span></span>
        <button type="button" class="ghost" id="qz-restart">Recommencer</button></div>`;
    }
    $$("[data-go]", box).forEach((d) => (d.onclick = () => { QZ.i = +d.dataset.go; renderQuiz(); }));
    $("#qz-prev").onclick = () => { QZ.i = Math.max(0, Math.min(QZ.i, n) - 1); $("#quiz-out").innerHTML = ""; renderQuiz(); };
    const next = $("#qz-next");
    if (next) next.onclick = () => { QZ.i++; QZ.i >= n ? portrait() : renderQuiz(); };
    const rs = $("#qz-restart");
    if (rs) rs.onclick = () => { QZ.i = 0; QZ.ans = {}; $("#quiz-out").innerHTML = ""; renderQuiz(); };
    $$(".st-ch", box).forEach((c) => (c.onclick = () => {
      QZ.ans[qs[QZ.i].id] = +c.dataset.v;
      $$(".st-ch", box).forEach((x) => x.classList.toggle("on", x === c));
      setTimeout(() => { QZ.i++; QZ.i >= n ? portrait() : renderQuiz(); }, 220);
    }));
  }
  function portrait() {
    QZ.i = S.quiz.length;
    renderQuiz();
    const ans = {};
    S.quiz.forEach((q) => (ans[q.id] = QZ.ans[q.id] ?? 0));
    $("#quiz-out").innerHTML = portraitHTML(compute(ans));
    $("#quiz-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* Formulaires en étapes : un bloc (fieldset) par écran */
  function wizard(form) {
    const steps = $$("fieldset", form), submit = $("button[type=submit]", form);
    if (steps.length < 2) return;
    let i = 0;
    const bar = document.createElement("div");
    bar.className = "wz-head";
    form.prepend(bar);
    const nav = document.createElement("div");
    nav.className = "st-nav wz-nav";
    nav.innerHTML = `<button type="button" class="ghost wz-prev">← Précédent</button><span class="muted small wz-count"></span><button type="button" class="cta small wz-next">Suivant →</button>`;
    submit.before(nav);
    nav.append(submit);
    const show = () => {
      steps.forEach((f, k) => (f.hidden = k !== i));
      bar.innerHTML = `<div class="st-prog"><i style="width:${((i + 1) / steps.length) * 100}%"></i></div>
        <div class="wz-steps">${steps.map((f, k) => `<button type="button" class="wz-step ${k === i ? "cur" : k < i ? "done" : ""}" data-k="${k}"><b>${k + 1}</b><span>${A.esc(f.querySelector("legend")?.textContent || "")}</span></button>`).join("")}</div>`;
      $(".wz-prev", nav).disabled = i === 0;
      $(".wz-next", nav).hidden = i === steps.length - 1;
      submit.hidden = i !== steps.length - 1;
      $(".wz-count", nav).textContent = `Étape ${i + 1} / ${steps.length}`;
      $$(".wz-step", bar).forEach((b) => (b.onclick = () => { if (+b.dataset.k <= i || valid()) { i = +b.dataset.k; show(); } }));
    };
    const valid = () => [...steps[i].querySelectorAll("input, select")].every((el) => el.reportValidity());
    $(".wz-prev", nav).onclick = () => { if (i > 0) { i--; show(); } };
    $(".wz-next", nav).onclick = () => { if (valid() && i < steps.length - 1) { i++; show(); bar.scrollIntoView({ behavior: "smooth", block: "nearest" }); } };
    form.addEventListener("keydown", (e) => {   // Entrée = étape suivante tant qu'on n'est pas à la fin
      if (e.key === "Enter" && e.target.tagName === "INPUT" && i < steps.length - 1) { e.preventDefault(); $(".wz-next", nav).click(); }
    });
    show();
  }

  /* ------------ Initialisation ------------ */
  function init(app, sim) {
    A = app; S = sim; P = sim.params;
    $("#sim-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#sim-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$(".sim-pane").forEach((p) => (p.hidden = p.id !== b.dataset.p));
    });
    $("#sim-part").addEventListener("submit", (e) => { e.preventDefault(); simParticulier(); });
    $("#sim-ent").addEventListener("submit", (e) => { e.preventDefault(); simEntreprise(); });
    $("#siret-btn").addEventListener("click", lookupSiret);
    $("#sim-ent").secteur.addEventListener("change", (e) => { const k = secteurDepuisNAF(e.target.value); if (k) $("#sim-ent").secteur_cat.value = k; });
    fetch("data/mesures_fiscales.json?v=202611101600").then((r) => r.json()).then((d) => (MF = d)).catch(() => (MF = { part: [], ent: [] }));
    if ($("#quiz")) renderQuiz();
    wizard($("#sim-part"));
    wizard($("#sim-ent"));
  }
  window.Simulateur = {
    init,
    rerun: (f) => (f === "#sim-ent" ? simEntreprise() : simParticulier()),
    quiz: { quizHTML, readAnswers, compute, axesHTML, proxHTML, portraitHTML, axisPos, stancesOf: (id) => S.stances[id], get questions() { return S.quiz; }, get axes() { return S.axes; } },
  };
})();
