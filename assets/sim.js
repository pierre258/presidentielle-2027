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
    p += Math.min(k, 2) * 0.5 + Math.max(0, k - 2);
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

  /* ------------ Mesures par candidat (particulier) ------------ */
  function mesuresParticulier(u) {
    const sal = ["salarie_prive", "fonctionnaire"].includes(u.statut);
    const prive = u.statut === "salarie_prive";
    const net = u.net;
    const irActuel = impotRevenu(u.revenu, u);
    const energie = u.energie * 12;
    const tvaGain = energie * (1 - (1 + P.tva_reduite) / (1 + P.tva_normale));
    const smic = (cible) => (sal && net > 0 && net < cible ? (cible - net) * 12 : 0);
    const nonFr = u.nationalite && u.nationalite !== "francaise";
    const aides = u.aides_montant * 12;
    const rpart = u.revenu / parts(u).p;
    const isfAncien = (taux) => (u.patrimoine > P.isf_ancien_seuil ? -(u.patrimoine - P.isf_ancien_seuil) * taux : 0);
    const M = {};
    const add = (id, theme, label, amount, note, kind) => (M[id] = M[id] || []).push({ theme, label, amount, note, kind: kind || (amount > 0 ? "gain" : amount < 0 ? "cost" : "neutral") });

    // Marine Le Pen
    if (energie) add("lepen", "Énergie", "TVA ramenée à 5,5 % sur carburants, électricité et gaz", tvaGain, `Sur ${eurPlain(energie)} de dépenses d'énergie par an.`);
    if (u.age < 30 && irActuel && sal) add("lepen", "Impôts", "Exonération d'impôt sur le revenu pour les moins de 30 ans", irActuel, "Mesure du programme 2022, à confirmer pour 2027.", "gain");
    if (nonFr && aides) add("lepen", "Aides", "Priorité nationale : accès aux aides (logement, prestations) réservé en priorité aux Français", -aides, "Risque de perte de tout ou partie des aides déclarées.", "risk");
    if (sal) add("lepen", "Salaire", "Hausses de salaire encouragées par exonération de cotisations patronales", 0, "Dépend de votre employeur : pas d'effet automatique.", "neutral");

    // Jean-Luc Mélenchon
    const s1700 = smic(1700);
    if (s1700) add("melenchon", "Salaire", "SMIC porté à 1 700 € net", s1700, `Votre salaire passerait de ${eurPlain(net)} à 1 700 € net par mois.`);
    if (u.revenu) {
      const k = rpart < 45000 ? -0.10 : rpart < 100000 ? 0.10 : 0.30;
      add("melenchon", "Impôts", "Impôt sur le revenu à 14 tranches (plus progressif)", -irActuel * k, `Hypothèse : ${k < 0 ? "baisse de 10 %" : "hausse de " + Math.round(k * 100) + " %"} de votre impôt (${eurPlain(irActuel)} aujourd'hui).`);
    }
    if (u.patrimoine > P.isf_ancien_seuil) add("melenchon", "Patrimoine", "Rétablissement de l'ISF (avec volet climatique)", isfAncien(0.007), "Hypothèse : barème de l'ancien ISF (seuil 1,3 M€).");
    if (u.mutuelle) add("melenchon", "Santé", "« 100 % Sécu » : remboursement intégral, fin des complémentaires", u.mutuelle * 12, "Économie de votre cotisation de mutuelle.");
    if (u.statut === "etudiant") add("melenchon", "Études", "Allocation d'autonomie pour les étudiants", 0, "Montant non chiffré dans le programme 2027 à ce stade.", "gain");

    // Édouard Philippe
    if (sal) add("philippe", "Salaire", "Pas de hausse du SMIC décrétée ; « travailler plus » pour gagner plus", 0, "Pas d'effet automatique sur votre salaire.", "neutral");
    if (aides) add("philippe", "Aides", "Maîtrise de la dépense publique et conditionnalité des prestations", 0, "Risque de durcissement des conditions d'accès, non chiffré.", "risk");

    // Raphaël Glucksmann
    if (u.patrimoine > 100e6) add("glucksmann", "Patrimoine", "Impôt plancher de 2 % sur les très hauts patrimoines", -(u.patrimoine * 0.02), "Concerne les patrimoines de plus de 100 M€.");
    if (sal && net < P.smic_net_mensuel * 1.3) add("glucksmann", "Salaire", "Revalorisation des bas salaires négociée par branche", 0, "Montant non chiffré.", "gain");

    // David Lisnard
    if (sal && net) add("lisnard", "Salaire", "Transfert de cotisations sociales vers le salaire net", Math.min(net * 0.18, 400) * 12, "Hypothèse : jusqu'à +400 €/mois pour 2 200 € net, soit environ +18 %.");
    if (aides) add("lisnard", "Aides", "Forte baisse de la dépense publique", 0, "Risque sur certaines prestations, non chiffré.", "risk");

    // Gabriel Attal
    if (sal && net > P.smic_net_mensuel * 1.2 && net < P.smic_net_mensuel * 2.5) add("attal", "Salaire", "Baisse des cotisations sur les salaires moyens", 0, "Gain annoncé mais non chiffré à ce stade.", "gain");

    // Bruno Retailleau
    if (prive && net) add("retailleau", "Salaire", "37 h 30 : 30 minutes de plus par jour pour un 13e mois", net, "Contre 2 h 30 de travail en plus par semaine.");
    if (aides) add("retailleau", "Aides", "Plafonnement du cumul des aides sociales", 0, "Peut réduire vos aides si leur cumul dépasse le plafond (non publié).", "risk");

    // Éric Zemmour
    if (nonFr && aides) add("zemmour", "Aides", "Allocations réservées aux Français", -aides, "Perte probable des aides déclarées.", "risk");
    if (u.heritage > 0 && u.heritage < 500000) add("zemmour", "Patrimoine", "Suppression des droits de succession pour la classe moyenne", u.heritage * 0.1, "Hypothèse : droits évités ≈ 10 % de l'héritage attendu (versement unique).", "gain");
    if (sal) add("zemmour", "Salaire", "« Prime zéro charge » versable par l'employeur", 0, "Dépend de votre employeur.", "neutral");

    // Marine Tondelier
    if (u.statut === "fonctionnaire" && net) add("tondelier", "Salaire", "Point d'indice indexé sur l'inflation", net * 12 * P.inflation_hyp, "Hypothèse : inflation de 2 %/an.");
    if (u.patrimoine > P.isf_ancien_seuil) add("tondelier", "Patrimoine", "ISF climatique", isfAncien(0.008), "Hypothèse : seuil de l'ancien ISF.");

    // Fabien Roussel
    if (sal && net < P.smic_net_mensuel * 1.5) add("roussel", "Salaire", "Hausse générale des salaires et du SMIC", 0, "Montant non chiffré.", "gain");
    if (energie) add("roussel", "Énergie", "Baisse des prix de l'énergie via un pôle public", 0, "Non chiffré.", "gain");

    // Dominique de Villepin
    if (prive) add("villepin", "Salaire", "1 500 € par an pour chaque salarié, financés sur les dividendes", 1500, "Pour les salariés d'entreprises versant des dividendes.");

    // Nicolas Dupont-Aignan
    if (energie) add("dupontaignan", "Énergie", "Baisse des taxes sur l'énergie", tvaGain * 0.8, "Hypothèse proche de la baisse de TVA à 5,5 %.");

    // Nathalie Arthaud
    const s2000 = smic(2000);
    if (s2000) add("arthaud", "Salaire", "SMIC et salaire minimum à 2 000 € net", s2000, `Votre salaire passerait à 2 000 € net par mois.`);

    return { M, irActuel };
  }

  /* ------------ Mesures par candidat (entreprise) ------------ */
  const coutSmic = (cible, n) => n > 0 ? -n * ((cible - P.smic_net_mensuel) / P.net_vers_brut) * P.charges_patronales_smic * 12 : 0;
  function isActuel(e) {
    if (["micro", "ei", "asso"].includes(e.forme) || e.resultat <= 0) return 0;
    if (e.ca < 10e6) return Math.min(e.resultat, P.is_seuil_reduit) * P.is_taux_reduit + Math.max(0, e.resultat - P.is_seuil_reduit) * P.is_taux_normal;
    return e.resultat * P.is_taux_normal;
  }
  function mesuresEntreprise(e) {
    const M = {};
    const add = (id, theme, label, amount, note, kind) => (M[id] = M[id] || []).push({ theme, label, amount, note, kind: kind || (amount > 0 ? "gain" : amount < 0 ? "cost" : "neutral") });
    const smicN = e.nb_smic;
    if (smicN) add("melenchon", "Masse salariale", "SMIC à 1 700 € net", coutSmic(1700, smicN), `${smicN} salarié(s) au SMIC ; coût employeur estimé (allègements non recalculés).`);
    if (e.dividendes > 0) add("melenchon", "Fiscalité", "Taxation renforcée des dividendes et des superprofits", 0, "Non chiffré.", "risk");
    if (smicN) add("arthaud", "Masse salariale", "Salaire minimum à 2 000 € net", coutSmic(2000, smicN), "Coût employeur estimé.");
    add("arthaud", "Social", "Interdiction des licenciements", 0, "Contrainte forte sur la gestion des effectifs.", "risk");
    if (e.effectif > 0) add("villepin", "Partage de la valeur", "1 500 € par salarié et par an, financés sur les dividendes", -Math.min(e.effectif * 1500, Math.max(e.dividendes, 0)), e.dividendes > 0 ? `Plafonné à vos dividendes (${eurPlain(e.dividendes)}).` : "Sans dividendes versés : pas d'effet.");
    add("lepen", "Fiscalité", "Baisse des impôts de production", 0, "Gain non chiffré (C3S, CFE…).", "gain");
    if (e.effectif) add("lepen", "Masse salariale", "Exonération de cotisations sur les hausses de salaire", 0, "Si vous augmentez vos salariés.", "gain");
    if (e.energie) add("lepen", "Énergie", "Sortie du marché européen de l'électricité", 0, "Baisse possible des prix, non chiffrée (la TVA est déjà récupérée par l'entreprise).", "gain");
    add("zemmour", "Fiscalité", "Suppression des impôts de production", 0, "Gain non chiffré.", "gain");
    if (e.effectif) add("zemmour", "Masse salariale", "« Prime zéro charge »", 0, "Primes sans cotisations.", "gain");
    add("lisnard", "Fiscalité", "Baisse des prélèvements obligatoires et simplification", 0, "Gain non chiffré.", "gain");
    if (e.effectif) add("lisnard", "Masse salariale", "Transfert de cotisations vers le net", 0, "Coût employeur inchangé, salaires nets en hausse.", "neutral");
    if (e.effectif) add("retailleau", "Temps de travail", "Passage à 37 h 30 contre un 13e mois", 0, `Environ +7 % d'heures travaillées pour ${e.effectif} salarié(s), financées par le 13e mois.`, "neutral");
    add("retailleau", "Normes", "Allègement des normes", 0, "Non chiffré.", "gain");
    add("philippe", "Fiscalité", "Stabilité fiscale et redressement des comptes", 0, "Pas de baisse d'impôt annoncée.", "neutral");
    if (e.effectif) add("attal", "Masse salariale", "Baisse des cotisations sur les salaires moyens", 0, "Non chiffré.", "gain");
    if (e.import_hors_ue > 0) add("glucksmann", "Commerce", "Taxe carbone aux frontières de l'UE", -e.achats * (e.import_hors_ue / 100) * 0.02, "Hypothèse : surcoût de 2 % sur vos achats hors UE.");
    if (e.ca > 750e6) add("glucksmann", "Fiscalité", "Impôt minimum effectif des multinationales", 0, "Non chiffré.", "risk");
    if (e.resultat > 0) add("tondelier", "Fiscalité", "Taxation des superprofits", 0, "Concerne surtout les grandes entreprises.", e.ca > 750e6 ? "risk" : "neutral");
    if (smicN) add("roussel", "Masse salariale", "Hausse générale des salaires", 0, "Non chiffré.", "risk");
    if (e.energie) add("dupontaignan", "Énergie", "Baisse des taxes sur l'énergie", e.energie * 0.05, "Hypothèse : baisse de 5 % de la facture HT.");
    return { M, is: isActuel(e) };
  }

  /* ------------ Rendu ------------ */
  const KIND = { gain: ["▲", "var(--pos)"], cost: ["▼", "var(--neg)"], risk: ["⚠", "#ffb020"], neutral: ["•", "var(--muted)"] };
  function renderImpacts(target, M, ids, intro) {
    const rows = ids.map((id) => {
      const list = M[id] || [];
      const total = list.reduce((a, m) => a + (m.amount || 0), 0);
      return { id, list, total };
    }).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.total)));
    target.innerHTML = intro + rows.map((r) => `
      <details class="imp">
        <summary>
          <span class="imp-who">${A.avatar(r.id, 40)}<span><strong>${A.esc(A.C[r.id].name)}</strong><small>${r.list.length} mesure(s) vous concernant</small></span></span>
          <span class="imp-bar"><i style="width:${(Math.abs(r.total) / max) * 50}%;${r.total >= 0 ? "left:50%;background:var(--pos)" : `right:50%;background:var(--neg)`}"></i></span>
          <span class="imp-total" style="color:${r.total > 0 ? "var(--pos)" : r.total < 0 ? "var(--neg)" : "var(--muted)"}">${r.total ? eur(r.total) + "<small>/an</small>" : "non chiffré"}</span>
        </summary>
        <ul>${r.list.map((m) => `<li><span class="k" style="color:${KIND[m.kind][1]}">${KIND[m.kind][0]}</span><div><strong>${A.esc(m.theme)} — ${A.esc(m.label)}</strong>${m.amount ? ` <span style="color:${m.amount > 0 ? "var(--pos)" : "var(--neg)"}">${eur(m.amount)}/an</span>` : ""}<br><small>${A.esc(m.note || "")}</small></div></li>`).join("") || "<li><span class='k'>•</span><div>Aucune mesure identifiée qui vous concerne directement.</div></li>"}</ul>
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

  function simParticulier() {
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
  const proxHTML = (prox) => `<div class="prox">${prox.map((p) => `<div class="prox-r">${A.avatar(p.id, 28)}<span>${A.esc(A.C[p.id].name)}</span><span class="prox-b"><i style="width:${p.pct}%;background:${A.C[p.id].color === "#404040" ? "#8a8f98" : A.C[p.id].color}"></i></span><strong>${p.pct} %</strong></div>`).join("")}</div>`;
  function portraitHTML(res, title = "🧭 Votre portrait idéologique") {
    return `<h3>${title}</h3>
      ${res.answered < 5 ? `<p class="warn">Répondez à au moins 5 affirmations pour un portrait fiable (${res.answered} réponse(s) pour l'instant).</p>` : ""}
      ${axesHTML(res.axes, res.prox.slice(0, 3))}
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
    if ($("#quiz")) renderQuiz();
    wizard($("#sim-part"));
    wizard($("#sim-ent"));
  }
  window.Simulateur = {
    init,
    quiz: { quizHTML, readAnswers, compute, axesHTML, proxHTML, portraitHTML, axisPos, get questions() { return S.quiz; }, get axes() { return S.axes; } },
  };
})();
