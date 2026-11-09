/* « Prêt à voter ? » : check-list ludique de l'électeur (inscription, bureau de vote, procuration,
   calendrier). Les cases cochées restent dans le navigateur (localStorage), rien n'est envoyé. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let A;
  const esc = (s) => A.esc(s ?? "");
  const KEY = "mds_pret_a_voter";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

  // Dates légales pour un 1er tour le dimanche 18 avril 2027 (sous réserve du décret de convocation)
  const D = (s) => new Date(s);
  const INSCR_LIGNE = D("2027-03-10T23:59:59");   // 6e mercredi avant le scrutin (en ligne)
  const INSCR_MAIRIE = D("2027-03-12T18:00:00");  // 6e vendredi (mairie ou courrier)
  const LINKS = {
    verifier: "https://www.service-public.fr/particuliers/vosdroits/services-en-ligne-et-formulaires/ISE",
    inscrire: "https://www.service-public.fr/particuliers/vosdroits/R16396",
    procuration: "https://www.maprocuration.gouv.fr/",
    procuInfo: "https://www.service-public.fr/particuliers/vosdroits/F1604",
  };
  const OFFICIEL = [
    { date: "2027-02-07", type: "officiel", titre: "Date limite de publication du décret de convocation des électeurs", approx: true },
    { date: "2027-03-10", type: "officiel", titre: "Dernier jour pour s'inscrire sur les listes électorales en ligne", cle: true },
    { date: "2027-03-12", heure: "18:00", type: "officiel", titre: "Fin du dépôt des parrainages · dernier jour d'inscription en mairie ou par courrier", cle: true },
    { date: "2027-03-16", type: "officiel", titre: "Publication de la liste officielle des candidats par le Conseil constitutionnel (date indicative)", approx: true },
    { date: "2027-04-05", type: "officiel", titre: "Début de la campagne officielle (clips, affiches, égalité stricte du temps de parole)" },
    { date: "2027-04-17", type: "officiel", titre: "Veille du scrutin : plus aucun sondage ni propagande électorale" },
    { date: "2027-04-18", heure: "08:00", type: "vote", titre: "🗳️ 1er tour de l'élection présidentielle", cle: true },
    { date: "2027-04-28", heure: "21:00", type: "debat", titre: "Débat de l'entre-deux-tours (date habituelle, à confirmer)", approx: true },
    { date: "2027-05-02", heure: "08:00", type: "vote", titre: "🗳️ 2nd tour de l'élection présidentielle", cle: true },
  ];
  const TYPES = { officiel: "📌 Date officielle", vote: "🗳️ Scrutin", debat: "🎙️ Débat", emission: "📺 Émission", meeting: "📣 Meeting", primaire: "🗳️ Primaire / vote interne", autre: "📅 Événement" };
  const TASKS = [
    ["inscrit", "Je suis inscrit(e) sur les listes électorales"],
    ["bureau", "Je connais mon bureau de vote"],
    ["procu", "Je serai là le jour J… ou j'ai fait ma procuration"],
    ["dates", "J'ai noté les dates dans mon agenda"],
  ];

  /* ---------- Fichier agenda (.ics) généré dans le navigateur ---------- */
  function ics(events, name) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const day = (d) => d.replace(/-/g, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MDS 2027//moyennedessondages2027.fr//FR", "CALSCALE:GREGORIAN"];
    events.forEach((e, i) => {
      const next = new Date(e.date); next.setDate(next.getDate() + 1);
      lines.push("BEGIN:VEVENT", `UID:mds2027-${day(e.date)}-${i}@moyennedessondages2027.fr`, `DTSTAMP:${stamp}`,
        e.heure ? `DTSTART;TZID=Europe/Paris:${day(e.date)}T${e.heure.replace(":", "")}00` : `DTSTART;VALUE=DATE:${day(e.date)}`,
        e.heure ? `DURATION:PT2H` : `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
        `SUMMARY:${e.titre.replace(/[,;]/g, " ")}`, `DESCRIPTION:${(e.lieu ? e.lieu + " — " : "") + "Calendrier MDS 2027 : https://moyennedessondages2027.fr/#jevote"}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function countdownHTML() {
    const now = new Date();
    const target = now < INSCR_LIGNE ? INSCR_LIGNE : INSCR_MAIRIE;
    const ms = target - now;
    if (ms <= 0) return `<div class="jv-cd over">Les inscriptions pour 2027 sont closes. Vous pouvez encore vérifier votre inscription et votre bureau de vote.</div>`;
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    const box = (n, l) => `<span class="jv-n"><b>${String(n).padStart(2, "0")}</b><small>${l}</small></span>`;
    return `<div class="jv-cd"><div class="jv-digits">${box(d, "jours")}${box(h, "heures")}${box(m, "min")}${box(s, "s")}</div>
      <p>pour vous inscrire ${now < INSCR_LIGNE ? "<b>en ligne</b> (jusqu'au mercredi 10 mars 2027)" : "<b>en mairie ou par courrier</b> (jusqu'au vendredi 12 mars 2027, 18 h)"}</p></div>`;
  }

  function render(events) {
    const st = load();
    const done = TASKS.filter(([k]) => st[k]).length;
    const pct = Math.round((done / TASKS.length) * 100);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const all = [...OFFICIEL, ...events].sort((a, b) => a.date.localeCompare(b.date) || (a.heure || "").localeCompare(b.heure || ""));
    const upcoming = all.filter((e) => new Date(e.date) >= today);
    const fd = (d) => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    $("#jv-app").innerHTML = `
      <div class="jv-top">
        <div class="jv-score"><div class="jv-ring" style="--p:${pct}"><b>${done}/${TASKS.length}</b></div>
          <div><h2>${pct === 100 ? "🎉 Vous êtes prêt(e) à voter !" : "Êtes-vous prêt(e) à voter ?"}</h2>
          <p class="muted">Cochez les étapes au fur et à mesure. ${pct === 100 ? "Rendez-vous le 18 avril !" : "4 étapes, 5 minutes."}</p></div></div>
        <ul class="jv-tasks">${TASKS.map(([k, l]) => `<li><label><input type="checkbox" data-k="${k}" ${st[k] ? "checked" : ""}><span>${l}</span></label></li>`).join("")}</ul>
      </div>

      <div class="jv-grid">
        <article class="jv-card">
          <h3>① Suis-je bien inscrit(e) ?</h3>
          ${countdownHTML()}
          <div class="jv-actions"><a class="cta" href="${LINKS.verifier}" target="_blank" rel="noopener">🔎 Vérifier mon inscription sur les listes</a>
            <a class="ghost" href="${LINKS.inscrire}" target="_blank" rel="noopener">✍️ M'inscrire</a></div>
          <p class="muted small">Le service officiel de service-public.fr vous indique aussi <b>votre bureau de vote</b> ② et votre numéro national d'électeur. Vous avez déménagé ? Pensez à vous réinscrire dans votre nouvelle commune.</p>
        </article>

        <article class="jv-card">
          <h3>③ Absent le jour J ? La procuration en 4 étapes</h3>
          <ol class="jv-steps">
            <li><b>Choisissez une personne de confiance</b><span>Elle doit être inscrite sur les listes électorales, dans n'importe quelle commune, mais viendra voter dans <i>votre</i> bureau.</span></li>
            <li><b>Faites la demande en ligne</b><span>Sur maprocuration.gouv.fr, avec votre numéro national d'électeur et le sien (ou sa date de naissance et son état civil).</span></li>
            <li><b>Validez votre identité</b><span>Au commissariat, à la gendarmerie ou au consulat avec la référence reçue par e-mail, ou entièrement en ligne avec l'application France Identité.</span></li>
            <li><b>C'est confirmé par e-mail</b><span>Votre mandataire vote à votre place avec sa propre pièce d'identité. Vous pouvez la faire pour un tour, les deux, ou jusqu'à un an.</span></li>
          </ol>
          <div class="jv-actions"><a class="cta" href="${LINKS.procuration}" target="_blank" rel="noopener">🤝 Faire ma procuration</a>
            <a class="ghost" href="${LINKS.procuInfo}" target="_blank" rel="noopener">En savoir plus</a></div>
          <p class="muted small">💡 Faites-la au plus tôt : la mairie doit l'avoir reçue avant le scrutin. Une personne ne peut détenir qu'une procuration établie en France.</p>
        </article>
      </div>

      <article class="jv-card jv-cal">
        <div class="jv-cal-head"><h3>④ Le calendrier de la campagne</h3>
          <button type="button" class="ghost" id="jv-ics-all">📅 Ajouter les dates clés à mon agenda</button></div>
        <div class="seg" id="jv-filter"><button data-f="" class="on">Tout</button><button data-f="officiel">📌 Dates officielles</button><button data-f="debat">🎙️ Débats et émissions</button><button data-f="meeting">📣 Meetings</button></div>
        <ol class="jv-timeline">${upcoming.map((e, i) => `<li class="t-${esc(e.type)} ${e.cle ? "key" : ""}" data-type="${esc(e.type === "emission" ? "debat" : e.type === "vote" ? "officiel" : e.type === "primaire" || e.type === "autre" ? "meeting" : e.type)}">
            <time>${fd(e.date)}${e.heure ? ` · ${e.heure.replace(":", " h ")}` : ""}</time>
            <div class="jv-ev"><span class="jv-type">${TYPES[e.type] || TYPES.autre}${e.approx ? " · indicatif" : ""}</span>
              <b>${esc(e.titre)}</b>
              <span class="muted small">${(e.candidats || []).filter((c) => A.C[c]).map((c) => `${A.avatar(c, 18)} ${esc(A.C[c].short)}`).join(" ")}${e.lieu ? ` · 📍 ${esc(e.lieu)}` : ""}${e.media ? ` · 📺 ${esc(e.media)}` : ""}${e.source?.url ? ` · <a href="${esc(e.source.url)}" target="_blank" rel="noopener">${esc(e.source.label || "source")}</a>` : ""}</span></div>
            <button type="button" class="jv-add" data-i="${i}" title="Ajouter à mon agenda">＋📅</button></li>`).join("")}</ol>
        <p class="muted small">Dates officielles calculées pour un 1er tour le 18 avril 2027, sous réserve du décret de convocation. Les meetings et débats sont ajoutés dès qu'ils sont annoncés.</p>
      </article>`;
    $$("#jv-app .jv-tasks input").forEach((c) => (c.onchange = () => { const s = load(); s[c.dataset.k] = c.checked; save(s); render(events); }));
    $("#jv-ics-all").onclick = () => ics(all.filter((e) => e.type === "officiel" || e.type === "vote"), "presidentielle-2027-dates-cles.ics");
    $$("#jv-app .jv-add").forEach((b) => (b.onclick = () => { const e = upcoming[+b.dataset.i]; ics([e], `mds2027-${e.date}.ics`); }));
    $("#jv-filter").onclick = (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      $$("#jv-filter button").forEach((x) => x.classList.toggle("on", x === b));
      $$("#jv-app .jv-timeline li").forEach((li) => (li.hidden = b.dataset.f && li.dataset.type !== b.dataset.f));
    };
  }

  async function init(app) {
    A = app;
    if (!$("#jv-app")) return;
    const data = await fetch("data/agenda_evenements.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const events = (data?.evenements || []).filter((e) => e.date && e.titre);
    render(events);
    // compte à rebours vivant (seulement quand la rubrique est affichée)
    setInterval(() => { const box = $("#jv-app .jv-cd"); if (box && !$("#jevote").hidden) box.outerHTML = countdownHTML(); }, 1000);
    // badge dans l'en-tête : progression de la check-list
    const badge = () => { const n = TASKS.filter(([k]) => load()[k]).length; const el = $("#jv-badge"); if (el) el.textContent = n === TASKS.length ? "✅ Prêt à voter" : "🗳️ Prêt à voter ?"; };
    badge(); document.addEventListener("change", badge);
  }
  window.JeVote = { init };
})();
