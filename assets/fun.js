/* Rubrique « Petit vote entre amis » : compte express, portrait idéologique, lien de groupe à partager et
   tableau de bord du créateur du lien. Backend : Supabase (Auth + Postgres avec RLS). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let A, Q, sb, user = null, profile = null;
  const PENDING = "fun_pending_code";
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };
  const el = () => $("#fun-app");
  const esc = (s) => A.esc(s);
  const msg = (t, kind = "") => `<p class="fun-msg ${kind}">${t}</p>`;

  /* ---------- Lien d'invitation : #fun?g=CODE ---------- */
  function codeFromUrl() {
    const m = location.hash.match(/[?&]g=([a-z0-9]{6,20})/i);
    return m ? m[1] : null;
  }
  const linkFor = (code) => `${location.origin}${location.pathname}#fun?g=${code}`;

  /* ---------- Partage ---------- */
  function shareHTML(url, title) {
    const t = encodeURIComponent(title), u = encodeURIComponent(url), tu = encodeURIComponent(`${title} ${url}`);
    const items = [
      ["WhatsApp", `https://wa.me/?text=${tu}`, "#25D366"],
      ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`, "#2AABEE"],
      ["X", `https://x.com/intent/post?text=${t}&url=${u}`, "#9aa4b2"],
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`, "#1877F2"],
      ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, "#0A66C2"],
      ["E-mail", `mailto:?subject=${t}&body=${tu}`, "#ff2d55"],
      ["SMS", `sms:?&body=${tu}`, "#3ddc97"],
    ];
    return `<div class="share">
      <div class="share-link"><input type="text" readonly value="${esc(url)}" aria-label="Lien à partager"><button type="button" data-copy="${esc(url)}">Copier</button></div>
      <div class="share-btns">${navigator.share ? `<button type="button" class="sh" data-native="${esc(url)}" data-title="${esc(title)}" style="--sc:#fff">Partager…</button>` : ""}
      ${items.map(([n, href, c]) => `<a class="sh" style="--sc:${c}" href="${href}" target="_blank" rel="noopener">${n}</a>`).join("")}</div></div>`;
  }
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = "Copié ✓"; }
      catch { c.previousElementSibling?.select(); document.execCommand?.("copy"); c.textContent = "Copié ✓"; }
      setTimeout(() => (c.textContent = "Copier"), 1800);
    }
    const n = e.target.closest("[data-native]");
    if (n) navigator.share({ title: n.dataset.title, text: n.dataset.title, url: n.dataset.native }).catch(() => {});
  });

  /* ---------- Écrans ---------- */
  async function inviteBanner() {
    const code = codeFromUrl() || store.get(PENDING);
    if (!code) return "";
    const { data } = await sb.rpc("group_invite", { p_code: code });
    const g = data?.[0];
    if (!g) return msg("Ce lien d'invitation n'est plus valide.", "err");
    return `<div class="invite">🎉 <strong>${esc(g.owner_pseudo)}</strong> vous invite à rejoindre « <strong>${esc(g.name)}</strong> ».
      ${user ? "" : "Créez votre compte en 20 secondes, puis remplissez votre portrait idéologique."}</div>`;
  }

  async function renderAuth() {
    el().innerHTML = `${await inviteBanner()}
      <div class="fun-card">
        <div class="seg" id="auth-tabs"><button data-t="up" class="on">Créer un compte</button><button data-t="in">Se connecter</button></div>
        <form id="auth-form" class="fun-form">
          <label class="f-up">Pseudo (visible par le créateur du lien)<input name="pseudo" required minlength="2" maxlength="30" autocomplete="nickname"></label>
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Mot de passe<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
          <button class="cta" type="submit">Créer mon compte →</button>
          <div id="auth-msg"></div>
        </form>
        <p class="muted small">Votre e-mail sert uniquement à vous connecter : il n'est jamais montré aux autres utilisateurs.</p>
      </div>`;
    let mode = "up";
    const f = $("#auth-form");
    $("#auth-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      mode = b.dataset.t;
      $$("#auth-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $(".f-up", f).hidden = mode !== "up";
      f.pseudo.required = mode === "up";
      f.password.autocomplete = mode === "up" ? "new-password" : "current-password";
      $("button[type=submit]", f).textContent = mode === "up" ? "Créer mon compte →" : "Me connecter →";
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#auth-msg");
      out.innerHTML = msg("Un instant…");
      const email = f.email.value.trim(), password = f.password.value;
      if (mode === "up") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { pseudo: f.pseudo.value.trim() } } });
        if (error) return (out.innerHTML = msg(esc(error.message), "err"));
        if (!data.session) return (out.innerHTML = msg("Compte créé : confirmez votre adresse via l'e-mail reçu, puis connectez-vous.", "ok"));
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return (out.innerHTML = msg("E-mail ou mot de passe incorrect.", "err"));
      }
    });
  }

  async function ensureProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) return data;
    const pseudo = (user.user_metadata?.pseudo || user.email.split("@")[0]).slice(0, 30);
    const { data: created } = await sb.from("profiles").insert({ id: user.id, pseudo }).select().single();
    return created;
  }

  async function joinPending() {
    const code = codeFromUrl() || store.get(PENDING);
    if (!code) return "";
    const { data, error } = await sb.rpc("join_group", { p_code: code });
    store.del(PENDING);
    if (location.hash.includes("?g=")) history.replaceState(null, "", "#fun");
    return error ? msg("Impossible de rejoindre ce groupe : lien invalide.", "err")
      : msg(`✓ Vous avez rejoint « <strong>${esc(data)}</strong> ». Remplissez votre portrait ci-dessous : vous découvrirez ensuite les résultats du groupe.`, "ok");
  }

  async function renderApp(notice = "") {
    profile = await ensureProfile();
    const cands = Object.values(A.C).filter((c) => c.id !== "bardella");
    el().innerHTML = `${notice}
      <div class="fun-head"><div>Connecté en tant que <strong>${esc(profile.pseudo)}</strong></div><button type="button" id="logout" class="ghost">Se déconnecter</button></div>
      <div class="seg big" id="fun-tabs"><button data-p="f-portrait" class="on">🧭 Mon portrait</button><button data-p="f-groups">🔗 Mes liens de partage</button><button data-p="f-joined">👥 Mes groupes</button></div>
      <div class="fun-pane" id="f-portrait">
        ${profile.completed_at ? msg(`Portrait validé le ${new Date(profile.completed_at).toLocaleDateString("fr-FR")}. Vous pouvez le modifier à tout moment.`, "ok") : ""}
        <div id="fun-quiz">${Q.quizHTML("f_", profile.answers || {})}</div>
        <div class="fun-card"><label class="choose">Et finalement, pour qui pensez-vous voter, quel que soit le résultat du quiz ?
          <select id="fun-choice"><option value="">— Choisir —</option><option value="indecis">Je ne sais pas encore</option>
          ${cands.map((c) => `<option value="${c.id}"${profile.chosen_candidate === c.id ? " selected" : ""}>${esc(c.name)} (${esc(c.party)})</option>`).join("")}
          <option value="blanc"${profile.chosen_candidate === "blanc" ? " selected" : ""}>Vote blanc / abstention</option></select></label>
          <button class="cta" type="button" id="fun-save">Valider mon portrait →</button><div id="fun-save-msg"></div></div>
        <div id="fun-result" class="sim-out">${profile.answers ? Q.portraitHTML(Q.compute(profile.answers)) : ""}</div>
      </div>
      <div class="fun-pane" id="f-groups" hidden>
        <div class="fun-card"><form id="grp-form" class="fun-form inline">
          <label>Nom de votre groupe<input name="name" required minlength="2" maxlength="60" placeholder="ex. Les copains du foot"></label>
          <button class="cta" type="submit">Générer un lien</button></form>
          <p class="muted small">Partagez le lien : chaque personne qui crée son compte et valide son portrait apparaît dans les résultats (pseudo uniquement). Les membres voient eux aussi les résultats du groupe, une fois leur portrait validé.</p></div>
        <div id="grp-list"></div>
      </div>
      <div class="fun-pane" id="f-joined" hidden><div id="joined-list"></div></div>`;
    if (!profile.chosen_candidate) $("#fun-choice").value = "";
    $("#logout").onclick = () => sb.auth.signOut();
    $("#fun-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#fun-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$(".fun-pane").forEach((p) => (p.hidden = p.id !== b.dataset.p));
      if (b.dataset.p === "f-groups") renderGroups();
      if (b.dataset.p === "f-joined") renderJoined();
    });
    $("#fun-save").onclick = savePortrait;
    $("#grp-form").addEventListener("submit", createGroup);
  }

  async function savePortrait() {
    const ans = Q.readAnswers("f_", $("#fun-quiz"));
    const res = Q.compute(ans);
    const out = $("#fun-save-msg");
    if (res.answered < 5) return (out.innerHTML = msg("Répondez à au moins 5 affirmations pour valider votre portrait.", "err"));
    const chosen = $("#fun-choice").value;
    if (!chosen) return (out.innerHTML = msg("Indiquez votre choix de candidat (ou « Je ne sais pas encore »).", "err"));
    const row = { answers: ans, axes: res.axes, top_candidate: res.prox[0].id, top_pct: res.prox[0].pct, chosen_candidate: chosen, completed_at: new Date().toISOString() };
    const { error } = await sb.from("profiles").update(row).eq("id", user.id);
    if (error) return (out.innerHTML = msg("Enregistrement impossible : " + esc(error.message), "err"));
    Object.assign(profile, row);
    out.innerHTML = msg("✓ Portrait enregistré. Il apparaît dans vos groupes, dont vous pouvez maintenant voir les résultats.", "ok")
      + `<button type="button" class="cta" id="see-groups">Voir les résultats de mes groupes →</button>`;
    $("#see-groups").onclick = () => $('#fun-tabs [data-p="f-joined"]').click();
    $("#fun-result").innerHTML = Q.portraitHTML(res);
  }

  async function createGroup(e) {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const { data: g, error } = await sb.from("groups").insert({ name }).select().single();
    if (error) return alert("Création impossible : " + error.message);
    await sb.rpc("join_group", { p_code: g.code }); // le créateur compte aussi dans les résultats
    e.target.reset();
    renderGroups();
  }

  /* ---------- Tableau de bord du créateur ---------- */
  function dashboard(rows) {
    const done = rows.filter((r) => r.completed);
    if (!rows.length) return `<p class="muted">Personne n'a encore utilisé ce lien.</p>`;
    if (!done.length) return `<p class="muted">${rows.length} membre(s), aucun portrait validé pour l'instant.</p>`;
    const count = (key) => {
      const c = {};
      done.forEach((r) => (c[r[key]] = (c[r[key]] || 0) + 1));
      return Object.entries(c).sort((a, b) => b[1] - a[1]);
    };
    const label = (id) => (A.C[id] ? A.C[id].short : id === "indecis" ? "Indécis" : id === "blanc" ? "Blanc / abst." : id || "—");
    const color = (id) => (A.C[id] ? (A.C[id].color === "#404040" ? "#8a8f98" : A.C[id].color) : "#6b7280");
    const bars = (list) => `<div class="gbars">${list.map(([id, n]) => `<div class="gbar">${A.C[id] ? A.avatar(id, 24) : "<span class='av-ph'></span>"}<span>${esc(label(id))}</span><span class="prox-b"><i style="width:${(n / done.length) * 100}%;background:${color(id)}"></i></span><strong>${Math.round((n / done.length) * 100)} %</strong><small>${n}</small></div>`).join("")}</div>`;
    // moyenne des positions sur les axes et des réponses
    const avgAxes = {};
    Object.keys(Q.axes).forEach((ax) => (avgAxes[ax] = done.reduce((a, r) => a + (r.axes?.[ax] || 0), 0) / done.length));
    const avgAns = {};
    Q.questions.forEach((q) => (avgAns[q.id] = done.reduce((a, r) => a + (r.answers?.[q.id] || 0), 0) / done.length));
    const groupRes = Q.compute(avgAns);
    const coherent = done.filter((r) => r.chosen_candidate === r.top_candidate).length;
    return `<div class="sim-sum">
        <div><small>Membres du groupe</small><strong>${rows.length}</strong><small>${done.length} portrait(s) validé(s)</small></div>
        <div><small>Candidat le plus choisi</small><strong>${esc(label(count("chosen_candidate")[0][0]))}</strong><small>${count("chosen_candidate")[0][1]} sur ${done.length}</small></div>
        <div><small>Choix = résultat du quiz</small><strong>${Math.round((coherent / done.length) * 100)} %</strong><small>cohérence vote / idées</small></div>
      </div>
      <h4>🗳️ Candidats choisis par le groupe</h4>${bars(count("chosen_candidate"))}
      <h4>🧭 Candidats les plus proches selon le quiz</h4>${bars(count("top_candidate"))}
      <h4>📍 Position moyenne du groupe</h4>${Q.axesHTML(null, groupRes.prox.slice(0, 3), "", [{ label: "GROUPE", pos: avgAxes, cls: "grp" }])}
      <h4>🤝 Proximité du « portrait moyen » du groupe avec chaque candidat</h4>${Q.proxHTML(groupRes.prox.slice(0, 6))}
      <h4>📊 Réponses moyennes</h4><div class="avgq">${Q.questions.map((q) => { const v = avgAns[q.id]; return `<div class="avgq-r"><span>${esc(q.q)}</span><span class="avgq-b"><b style="left:${(v + 2) * 25}%"></b></span><strong>${v > 0 ? "+" : ""}${v.toFixed(1)}</strong></div>`; }).join("")}</div>
      <p class="muted small">Échelle des réponses : −2 pas du tout d'accord … +2 tout à fait d'accord.</p>
      <h4>👤 Participants (pseudos)</h4>
      <div class="table-scroll"><table class="tbl"><thead><tr><th>Pseudo</th><th>Candidat choisi</th><th>Plus proche selon le quiz</th><th>Inscrit le</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.pseudo)}</td><td>${r.completed ? esc(label(r.chosen_candidate)) : "<span class='muted'>portrait non validé</span>"}</td><td>${r.completed ? `${esc(label(r.top_candidate))} (${r.top_pct} %)` : "—"}</td><td>${new Date(r.joined_at).toLocaleDateString("fr-FR")}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  async function renderGroups() {
    const box = $("#grp-list");
    box.innerHTML = msg("Chargement…");
    const { data: groups, error } = await sb.from("groups").select("*").order("created_at", { ascending: false });
    if (error) return (box.innerHTML = msg(esc(error.message), "err"));
    if (!groups.length) return (box.innerHTML = `<p class="muted">Vous n'avez pas encore créé de lien.</p>`);
    box.innerHTML = groups.map((g) => `<details class="grp" data-id="${g.id}"><summary><strong>${esc(g.name)}</strong><span class="muted small">créé le ${new Date(g.created_at).toLocaleDateString("fr-FR")}</span></summary>
      <div class="grp-in">${shareHTML(linkFor(g.code), `${profile.pseudo} vous invite à comparer vos idées pour la présidentielle 2027 (« ${g.name} »)`)}
      <div class="grp-dash">${msg("Chargement des résultats…")}</div>
      <button type="button" class="ghost danger" data-del="${g.id}">Supprimer ce lien</button></div></details>`).join("");
    $$(".grp", box).forEach((d) => d.addEventListener("toggle", async () => {
      if (!d.open) return;
      const { data, error: err } = await sb.rpc("group_results", { p_group: d.dataset.id });
      $(".grp-dash", d).innerHTML = err ? msg(esc(err.message), "err") : dashboard(data || []);
    }));
    if (groups.length) $(".grp", box).open = true;
    $$("[data-del]", box).forEach((b) => (b.onclick = async () => {
      if (!confirm("Supprimer ce lien ? Les membres n'y seront plus rattachés (leurs comptes restent).")) return;
      await sb.from("groups").delete().eq("id", b.dataset.del);
      renderGroups();
    }));
  }

  async function renderJoined() {
    const box = $("#joined-list");
    box.innerHTML = msg("Chargement…");
    const { data, error } = await sb.rpc("my_joined_groups");
    if (error) return (box.innerHTML = msg(esc(error.message), "err"));
    if (!data?.length) return (box.innerHTML = `<p class="muted">Vous n'avez encore rejoint aucun groupe. Créez un lien dans « Mes liens de partage » ou demandez-en un à un ami !</p>`);
    const done = !!profile.completed_at;
    box.innerHTML = (done ? "" : msg("Validez votre portrait (onglet « Mon portrait ») pour découvrir les résultats de vos groupes.", "err"))
      + data.map((g) => `<details class="grp" data-id="${g.group_id}"><summary><strong>${esc(g.name)}</strong>
          <span class="muted small">${g.is_owner ? "créé par vous" : `créé par ${esc(g.owner_pseudo)}`} · ${g.members} membre${g.members > 1 ? "s" : ""}</span></summary>
          <div class="grp-in"><div class="grp-dash">${done ? msg("Chargement des résultats…") : `<p class="muted">🔒 Résultats visibles après validation de votre portrait.</p>`}</div>
          ${g.is_owner ? "" : `<button type="button" class="ghost danger" data-leave="${g.group_id}">Quitter ce groupe</button>`}</div></details>`).join("")
      + `<p class="muted small">Dans chaque groupe, les membres voient les pseudos, le candidat choisi et les tendances — jamais les e-mails.</p>`;
    if (done) {
      $$(".grp", box).forEach((d) => d.addEventListener("toggle", async () => {
        if (!d.open) return;
        const { data: rows, error: err } = await sb.rpc("group_results", { p_group: d.dataset.id });
        $(".grp-dash", d).innerHTML = err ? msg(esc(err.message), "err") : dashboard(rows || []);
      }));
      $(".grp", box).open = true;
    }
    $$("[data-leave]", box).forEach((b) => (b.onclick = async () => {
      if (!confirm("Quitter ce groupe ? Votre portrait n'y sera plus comptabilisé.")) return;
      await sb.from("group_members").delete().eq("group_id", b.dataset.leave).eq("user_id", user.id);
      renderJoined();
    }));
  }

  /* ---------- Démarrage ---------- */
  async function refresh(session) {
    user = session?.user || null;
    if (!user) return renderAuth();
    const notice = await joinPending();
    await renderApp(notice);
    if (notice.includes("ok") && profile?.completed_at) $('#fun-tabs [data-p="f-joined"]').click();
  }

  function init(app) {
    A = app; Q = window.Simulateur.quiz;
    const code = codeFromUrl();
    if (code) store.set(PENDING, code);
    const cfg = window.FUN_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      el().innerHTML = `<div class="fun-card"><h3>🚧 Bientôt disponible</h3><p class="muted">Cette rubrique sera activée très prochainement. En attendant, vous pouvez faire votre portrait idéologique dans la rubrique « Mon impact ».</p></div>`;
      return;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    let last;
    sb.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id || null;
      if (id === last) return; // évite les rafraîchissements inutiles (rafraîchissement du jeton…)
      last = id;
      refresh(session);
    });
  }
  window.Fun = { init };
})();
