/* Rubrique « Que votent mes amis ? » : compte express, portrait idéologique, lien de groupe à partager et
   tableau de bord du créateur du lien. Backend : Supabase (Auth + Postgres avec RLS). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let A, Q, sb, user = null, profile = null, deleting = false;
  const PENDING = "fun_pending_code";
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };
  const el = () => $("#fun-app");
  const pel = () => $("#portrait-app"); // volet « Trouver le candidat de mes convictions » de la page Candidats
  const toPortrait = `<a class="cta small" href="#portrait">🧭 Trouver le candidat de mes convictions →</a>`;
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

  // Adresses jetables refusées dès l'inscription (la base les exclut aussi des résultats)
  const DISPOSABLE = /@(yopmail\.(com|fr|net)|mailinator\.(com|net)|guerrillamail\.\w+|sharklasers\.com|grr\.la|10minutemail\.\w+|temp-?mail\.\w+|tempmailo?\.com|tempinbox\.com|tempr\.email|trashmail\.\w+|throwawaymail\.com|getnada\.com|nada\.email|maildrop\.cc|dispostable\.com|fakeinbox\.com|mytemp\.email|moakt\.com|mohmal\.com|burnermail\.io|mailnesia\.com|jetable\.org|mail-temporaire\.\w+|tmpmail\.\w+|minuteinbox\.com|emailfake\.com|discard\.email|mailsac\.com|dropmail\.me|33mail\.com|wegwerfmail\.de|simplelogin\.(com|fr)|aleeas\.com|slmail\.me|anonaddy\.(com|me)|addy\.io|duck\.com|mozmail\.com|relay\.firefox\.com|proton\.me|protonmail\.(com|ch)|pm\.me|mail\.tm|tuta\.io)$/i;
  const redirectUrl = () => `${location.origin}${location.pathname}#fun`;

  function checkEmailScreen(email, note = "") {
    el().innerHTML = `<div class="fun-card mailbox">
        <div class="mail-ico">📩</div>
        <h3>Vérifiez votre boîte mail</h3>
        <p>Un e-mail de confirmation vient d'être envoyé à <strong>${esc(email)}</strong>.<br>Cliquez sur le lien qu'il contient pour activer votre compte : <strong>votre vote ne sera compté qu'une fois votre adresse confirmée</strong>.</p>
        ${note}
        <p class="muted small">Pensez à regarder dans les courriers indésirables. Le lien vous ramènera directement ici.</p>
        <div class="mail-actions"><button type="button" class="ghost" id="resend">Renvoyer l'e-mail</button><button type="button" class="ghost" id="back-login">J'ai confirmé : me connecter</button></div>
        <div id="resend-msg"></div></div>`;
    $("#resend").onclick = async () => {
      const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectUrl() } });
      $("#resend-msg").innerHTML = error ? msg("Envoi impossible pour le moment (limite d'envoi atteinte ?) : réessayez dans quelques minutes.", "err") : msg("✓ E-mail renvoyé.", "ok");
    };
    $("#back-login").onclick = () => renderAuth("in", email);
  }

  async function renderAuth(startMode = "up", prefill = "") {
    el().innerHTML = `${await inviteBanner()}
      <div class="fun-card">
        <div class="seg" id="auth-tabs"><button data-t="up" class="on">Créer un compte</button><button data-t="in">Se connecter</button></div>
        <form id="auth-form" class="fun-form">
          <label class="f-up">Pseudo (visible par les membres de vos groupes)<input name="pseudo" required minlength="2" maxlength="30" autocomplete="nickname"><small>Évitez votre nom complet si vous souhaitez rester discret.</small></label>
          <label>E-mail<input name="email" type="email" required autocomplete="email" value="${esc(prefill)}"><small class="f-up">Un e-mail de confirmation vous sera envoyé. Les adresses temporaires ne sont pas acceptées.</small></label>
          <label>Mot de passe<input name="password" type="password" required minlength="8" autocomplete="new-password"><small class="f-up">8 caractères minimum.</small></label>
          <label class="f-up consent"><input type="checkbox" name="consent" required> <span>J'accepte les <a href="#cgu" target="_blank">conditions d'utilisation</a> et la <a href="#confidentialite" target="_blank">politique de confidentialité</a>.</span></label>
          <div id="captcha-box" class="captcha-box"></div>
          <button class="cta" type="submit">Créer mon compte →</button>
          <div id="auth-msg"></div>
        </form>
        <p class="muted small">🔒 Votre e-mail sert uniquement à vous connecter : il n'est jamais montré aux autres utilisateurs, ni à l'auteur d'un lien. Seuls les comptes à l'adresse confirmée sont comptés dans les résultats.</p>
      </div>`;
    let mode = "up";
    const f = $("#auth-form");
    const setMode = (m) => {
      mode = m;
      $$("#auth-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === m));
      $$(".f-up", f).forEach((x) => (x.hidden = m !== "up"));
      f.pseudo.required = m === "up";
      f.consent.required = m === "up";
      f.password.autocomplete = m === "up" ? "new-password" : "current-password";
      f.password.minLength = m === "up" ? 8 : 1;
      $("button[type=submit]", f).textContent = m === "up" ? "Créer mon compte →" : "Me connecter →";
    };
    // CAPTCHA (si configuré) : jeton transmis à Supabase, qui le vérifie côté serveur
    let captchaToken = null;
    const loadCaptcha = () => {
      if (!window.TURNSTILE_SITE_KEY) return;
      const draw = () => window.turnstile.render("#captcha-box", { sitekey: window.TURNSTILE_SITE_KEY, language: "fr", theme: "dark",
        callback: (t) => (captchaToken = t), "expired-callback": () => (captchaToken = null) });
      if (window.turnstile) return draw();
      const sc = document.createElement("script");
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true; sc.onload = draw;
      document.head.appendChild(sc);
    };
    loadCaptcha();
    $("#auth-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.t); });
    setMode(startMode);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#auth-msg");
      const email = f.email.value.trim(), password = f.password.value;
      if (window.TURNSTILE_SITE_KEY && !captchaToken) return (out.innerHTML = msg("Merci de valider la vérification anti-robot ci-dessus.", "err"));
      if (mode === "up" && DISPOSABLE.test(email)) return (out.innerHTML = msg("Les adresses e-mail temporaires ne sont pas acceptées : utilisez votre adresse habituelle.", "err"));
      out.innerHTML = msg("Un instant…");
      if (mode === "up") {
        const pending = codeFromUrl() || store.get(PENDING) || undefined;
        const { data, error } = await sb.auth.signUp({ email, password,
          options: { captchaToken: captchaToken || undefined, emailRedirectTo: redirectUrl(), data: { pseudo: f.pseudo.value.trim(), pending_group: pending, cgu_at: new Date().toISOString() } } });
        if (error) return (out.innerHTML = msg(/rate limit/i.test(error.message) ? "Trop d'inscriptions en ce moment : réessayez dans quelques minutes." : esc(error.message), "err"));
        if (data.user && !data.user.identities?.length) return (out.innerHTML = msg("Un compte existe déjà avec cette adresse : connectez-vous.", "err"));
        if (!data.session) return checkEmailScreen(email);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken || undefined } });
        if (error && /confirm/i.test(error.message)) return checkEmailScreen(email, msg("Votre adresse n'est pas encore confirmée.", "err"));
        if (error) return (out.innerHTML = msg("E-mail ou mot de passe incorrect.", "err"));
      }
    });
  }

  async function ensureProfile() {
    let { data } = await sb.from("profiles").select("id, pseudo, created_at").eq("id", user.id).maybeSingle();
    if (!data) {
      const pseudo = (user.user_metadata?.pseudo || user.email.split("@")[0]).slice(0, 30);
      ({ data } = await sb.from("profiles").insert({ id: user.id, pseudo }).select("id, pseudo, created_at").single());
    }
    // le bulletin (réponses + vote) est stocké à part, relié au compte par une empreinte chiffrée
    const { data: b } = await sb.rpc("my_ballot");
    return { ...data, ...((b && b[0]) || {}) };
  }

  async function joinPending() {
    const meta = user.user_metadata?.pending_group;
    const code = codeFromUrl() || store.get(PENDING) || meta;
    if (!code) return "";
    const { data, error } = await sb.rpc("join_group", { p_code: code });
    store.del(PENDING);
    if (meta) sb.auth.updateUser({ data: { pending_group: null } }); // code consommé
    if (location.hash.includes("?g=")) history.replaceState(null, "", "#fun");
    return error ? msg("Impossible de rejoindre ce groupe : lien invalide.", "err")
      : msg(`✓ Vous avez rejoint « <strong>${esc(data)}</strong> ». Remplissez votre portrait ci-dessous : vous découvrirez ensuite les résultats du groupe.`, "ok");
  }

  /* Questionnaire pas à pas : une affirmation par écran, flèches précédent / suivant */
  const CHOICES = [["-2", "Pas du tout d'accord"], ["-1", "Plutôt pas d'accord"], ["0", "Sans avis"], ["1", "Plutôt d'accord"], ["2", "Tout à fait d'accord"]];
  const stepper = { i: 0, ans: {}, chosen: "" };
  function renderStep() {
    const qs = Q.questions, n = qs.length, box = $("#stepper");
    const answered = qs.filter((q) => stepper.ans[q.id] !== undefined).length;
    const prog = `<div class="st-prog"><i style="width:${(Math.min(stepper.i, n) / n) * 100}%"></i></div>
      <div class="st-dots">${qs.map((q, k) => `<button type="button" class="st-dot ${k === stepper.i ? "cur" : ""} ${stepper.ans[q.id] !== undefined ? "done" : ""}" data-go="${k}" aria-label="Question ${k + 1}"></button>`).join("")}<button type="button" class="st-dot last ${stepper.i === n ? "cur" : ""}" data-go="${n}" aria-label="Choix du candidat">🗳</button></div>`;
    if (stepper.i < n) {
      const q = qs[stepper.i], cur = stepper.ans[q.id];
      box.innerHTML = `${prog}
        <div class="st-card">
          <div class="st-num">Question ${stepper.i + 1} / ${n}</div>
          <p class="st-q">${esc(q.q)}</p>
          <div class="st-choices">${CHOICES.map(([v, l]) => `<button type="button" class="st-ch ${String(cur) === v ? "on" : ""}" data-v="${v}" data-k="${v}">${l}</button>`).join("")}</div>
        </div>
        <div class="st-nav"><button type="button" class="ghost" id="st-prev" ${stepper.i === 0 ? "disabled" : ""}>← Précédent</button>
          <span class="muted small">${answered} réponse${answered > 1 ? "s" : ""} sur ${n}</span>
          <button type="button" class="cta small" id="st-next">${cur === undefined ? "Passer →" : "Suivant →"}</button></div>`;
    } else {
      const surname = (n) => n.replace(/^\S+\s+/, "").replace(/^(de|d'|du)\s+/i, "");
      const cands = Object.values(A.C).filter((c) => c.id !== "bardella").sort((a, b) => surname(a.name).localeCompare(surname(b.name), "fr"));
      box.innerHTML = `${prog}
        <div class="st-card">
          <div class="st-num">Dernière étape</div>
          <p class="st-q">Et finalement, pour qui pensez-vous voter, quel que soit le résultat du quiz ?</p>
          <select id="fun-choice" class="st-select"><option value="">— Choisir —</option><option value="indecis">Je ne sais pas encore</option>
            ${cands.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.party)})</option>`).join("")}
            <option value="blanc">Vote blanc / abstention</option></select>
          <p class="muted small">${answered} affirmation${answered > 1 ? "s" : ""} renseignée${answered > 1 ? "s" : ""} sur ${n}${answered < 5 ? " — il en faut au moins 5 pour valider." : "."}</p>
          <label class="consent-vote"><input type="checkbox" id="vote-consent"> <span><b>Je consens au traitement de mon opinion politique</b> (mes réponses et mon choix de candidat) pour le « Que votent mes amis ? » et ses résultats. Ce consentement est distinct des conditions d'utilisation ; je peux le retirer à tout moment en un clic (« Retirer mon vote »). Mon vote est conservé à part de mon adresse e-mail et supprimé après l'élection.</span></label>
        </div>
        <div class="st-nav"><button type="button" class="ghost" id="st-prev">← Précédent</button><span></span>
          <button type="button" class="cta" id="fun-save">Valider mon portrait ✓</button></div><div id="fun-save-msg"></div>`;
      $("#fun-choice").value = stepper.chosen || "";
      $("#fun-choice").onchange = (e) => (stepper.chosen = e.target.value);
      $("#fun-save").onclick = savePortrait;
    }
    $$("[data-go]", box).forEach((d) => (d.onclick = () => { stepper.i = +d.dataset.go; renderStep(); }));
    $("#st-prev").onclick = () => { if (stepper.i > 0) { stepper.i--; renderStep(); } };
    const next = $("#st-next");
    if (next) next.onclick = () => { stepper.i++; renderStep(); };
    $$(".st-ch", box).forEach((c) => (c.onclick = () => {
      stepper.ans[Q.questions[stepper.i].id] = +c.dataset.v;
      $$(".st-ch", box).forEach((x) => x.classList.toggle("on", x === c));
      setTimeout(() => { stepper.i++; renderStep(); }, 220); // passe tout seul à la question suivante
    }));
  }

  // Barre d'onglets du Petit vote : « Je sonde mes proches » à gauche, puis les résultats
  // « Je sonde mes proches » : bouton à part, tout à gauche ; puis les résultats
  function tabsHTML() {
    return `<button type="button" class="sonde-btn" data-p="f-groups">🔗 Je sonde mes proches<small>anonymement</small></button>
      <div class="seg big fun-tabs"><button data-p="f-all" class="on">📊 Le vote des participants</button><button data-p="f-joined">👥 Mes groupes</button></div>`;
  }

  function portraitLoggedOut() {
    if (!pel()) return;
    pel().innerHTML = `<div class="fun-card"><h3>🧭 Votre portrait en 14 affirmations</h3>
      <p class="muted">Pour enregistrer votre portrait et votre choix de candidat, créez d'abord un compte (20 secondes). Il vous sert aussi pour le « Que votent mes amis ? ».</p>
      <a class="cta" href="#fun">Créer un compte ou me connecter →</a></div>`;
  }

  function portraitPane() {
    const done = !!profile.completed_at;
    if (done && !stepper.editing) {
      const res = Q.compute(profile.answers || {});
      const ch = profile.chosen_candidate;
      const chLabel = A.C[ch] ? A.C[ch].name : ch === "indecis" ? "Je ne sais pas encore" : ch === "blanc" ? "Vote blanc / abstention" : "—";
      return `<div class="fun-card wide port-sum">
          <div><small class="muted">Mon choix</small><div class="port-ch">${A.C[ch] ? A.avatar(ch, 44) : ""}<strong>${esc(chLabel)}</strong></div></div>
          <div><small class="muted">Le plus proche selon le quiz</small><div class="port-ch">${A.avatar(res.prox[0].id, 44)}<strong>${esc(A.C[res.prox[0].id].name)} · ${res.prox[0].pct} %</strong></div></div>
          <div class="port-btns"><button type="button" class="ghost" id="edit-portrait">✏️ Modifier mon portrait</button>
            <button type="button" class="ghost danger" id="withdraw-vote">↩︎ Retirer mon vote</button></div></div>
        <div class="sim-out">${Q.portraitHTML(res)}</div>`;
    }
    return `<div id="stepper" class="stepper"></div><div id="fun-result" class="sim-out"></div>`;
  }

  async function statusNote() {
    const { data } = await sb.rpc("my_status");
    const st = data?.[0];
    if (!st || st.counted) return "";
    if (!st.email_confirmed) return msg("⚠️ Votre adresse e-mail n'est pas confirmée : votre vote n'est pas comptabilisé.", "err");
    if (st.disposable) return msg("⚠️ Les adresses e-mail temporaires ne sont pas comptabilisées dans les résultats.", "err");
    return msg(`⏳ Par sécurité, les nouveaux comptes sont comptés à partir du ${new Date(st.counted_from).toLocaleDateString("fr-FR")}.`, "");
  }

  async function renderApp(notice = "") {
    profile = await ensureProfile();
    notice += await statusNote();
    const done = !!profile.completed_at;
    stepper.ans = { ...(profile.answers || {}) };
    stepper.chosen = profile.chosen_candidate || "";
    stepper.i = 0;
    el().innerHTML = `${notice}
      <div class="fun-head"><div>Connecté en tant que <strong>${esc(profile.pseudo)}</strong></div><div class="fun-head-btns"><button type="button" id="logout" class="ghost">Se déconnecter</button><button type="button" id="del-account" class="ghost danger">Supprimer mon compte</button></div></div>
      ${done ? "" : `<div class="fun-card port-todo"><div><strong>Première étape : votre portrait</strong><p class="muted small">Répondez aux affirmations et choisissez votre candidat : votre vote comptera dans vos groupes et dans « Le vote des participants ».</p></div>${toPortrait}</div>`}
      <div class="fun-tabbar" id="fun-tabs">${tabsHTML()}</div>
      <div class="fun-pane" id="f-groups" hidden>
        <div class="fun-card"><form id="grp-form" class="fun-form inline">
          <label>Nom de votre groupe<input name="name" required minlength="2" maxlength="60" placeholder="ex. Les copains du foot"></label>
          <button class="cta" type="submit">Générer un lien</button></form>
          <p class="muted small">Partagez le lien : chaque personne qui crée son compte et valide son portrait apparaît dans les résultats (pseudo uniquement). Les membres voient eux aussi les résultats du groupe, une fois leur portrait validé.</p></div>
        <div id="grp-list"></div>
      </div>
      <div class="fun-pane" id="f-joined" hidden><div id="joined-list"></div></div>
      <div class="fun-pane" id="f-all"><div id="all-results"></div></div>`;
    pel().innerHTML = `<div class="fun-head"><div>Connecté en tant que <strong>${esc(profile.pseudo)}</strong></div></div><div id="f-portrait">${portraitPane()}</div><div id="port-msg"></div>`;
    $("#logout").onclick = () => sb.auth.signOut();
    $("#del-account").onclick = confirmDelete;
    $("#fun-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (!b.dataset.p) return;
      $$("#fun-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$(".fun-pane").forEach((p) => (p.hidden = p.id !== b.dataset.p));
      if (b.dataset.p === "f-groups") renderGroups();
      if (b.dataset.p === "f-joined") renderJoined();
      if (b.dataset.p === "f-all") renderAll();
    });
    $("#grp-form").addEventListener("submit", createGroup);
    bindPortrait();
    renderAll();
  }

  /* ---------- Supprimer mon compte (droit à l'effacement) ---------- */
  function confirmDelete() {
    el().innerHTML = `<div class="fun-card del-card">
        <h3>🗑️ Supprimer mon compte</h3>
        <p>Cette action est <strong>définitive</strong> et immédiate. Seront effacés :</p>
        <ul><li>votre compte et votre adresse e-mail ;</li><li>votre pseudo, votre portrait et votre choix de candidat ;</li>
        <li>votre participation à tous les groupes ;</li><li>les groupes que vous avez créés, avec leurs résultats (leurs membres n'y auront plus accès).</li></ul>
        <div class="mail-actions"><button type="button" class="ghost" id="del-cancel">Annuler</button><button type="button" class="cta danger-cta" id="del-go">Supprimer définitivement</button></div>
        <div id="del-msg"></div></div>`;
    const go = $("#del-go");
    $("#del-cancel").onclick = () => renderApp();
    go.onclick = async () => {
      go.disabled = true;
      $("#del-msg").innerHTML = msg("Suppression en cours…");
      const { error } = await sb.rpc("delete_my_account");
      if (error) { go.disabled = false; return ($("#del-msg").innerHTML = msg("Suppression impossible : " + esc(error.message) + ". Réessayez ou écrivez à contact@moyennedessondages2027.fr.", "err")); }
      store.del(PENDING);
      deleting = true; // l'écran de confirmation ne doit pas être remplacé par le formulaire de connexion
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      user = null; profile = null;
      portraitLoggedOut();
      el().innerHTML = `<div class="fun-card mailbox"><div class="mail-ico">✅</div><h3>Votre compte a été supprimé</h3>
        <p>Toutes vos données ont été effacées. Merci d'avoir participé !</p>
        <button type="button" class="ghost" id="del-back">Revenir à l'accueil du Petit vote</button></div>`;
      $("#del-back").onclick = () => { deleting = false; renderAuth(); };
    };
  }

  function bindPortrait() {
    if ($("#stepper")) renderStep();
    const ed = $("#edit-portrait");
    if (ed) ed.onclick = () => { stepper.editing = true; $("#f-portrait").innerHTML = portraitPane(); bindPortrait(); };
    const wd = $("#withdraw-vote");
    if (wd) wd.onclick = async () => {
      wd.disabled = true;
      const { error } = await sb.rpc("delete_my_ballot");
      if (error) { wd.disabled = false; return ($("#port-msg").innerHTML = msg("Impossible de retirer le vote : " + esc(error.message), "err")); }
      ["answers", "axes", "top_candidate", "top_pct", "chosen_candidate", "completed_at", "consent_at"].forEach((k) => delete profile[k]);
      stepper.ans = {}; stepper.chosen = ""; stepper.i = 0;
      await renderApp(msg("✓ Votre vote et vos réponses ont été supprimés. Votre compte reste actif : vous pouvez revoter quand vous voulez.", "ok"));
    };
  }

  async function savePortrait() {
    const ans = {};
    Q.questions.forEach((q) => (ans[q.id] = stepper.ans[q.id] ?? 0));
    const res = Q.compute(ans);
    const out = $("#fun-save-msg");
    const filled = Q.questions.filter((q) => stepper.ans[q.id] !== undefined).length;
    if (filled < 5) return (out.innerHTML = msg("Répondez à au moins 5 affirmations pour valider votre portrait.", "err"));
    const chosen = $("#fun-choice").value;
    if (!chosen) return (out.innerHTML = msg("Indiquez votre choix de candidat (ou « Je ne sais pas encore »).", "err"));
    if (!$("#vote-consent")?.checked) return (out.innerHTML = msg("Cochez la case de consentement au traitement de votre opinion politique pour enregistrer votre vote.", "err"));
    const row = { answers: ans, axes: res.axes, top_candidate: res.prox[0].id, top_pct: res.prox[0].pct, chosen_candidate: chosen, completed_at: new Date().toISOString(), consent_at: new Date().toISOString() };
    const { error } = await sb.rpc("save_ballot", { p_answers: ans, p_axes: res.axes, p_top: res.prox[0].id, p_pct: res.prox[0].pct, p_chosen: chosen, p_consent: true });
    if (error) return (out.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les votes reprendront après la fermeture des bureaux (20 h)." : "Enregistrement impossible : " + esc(error.message), "err"));
    Object.assign(profile, row);
    stepper.editing = false;
    // portrait validé : direction « Que votent mes amis ? », onglet « Le vote des participants »
    await renderApp(msg("✓ Portrait enregistré ! Découvrez ci-dessous les résultats de tous les participants, puis ceux de vos groupes.", "ok"));
    location.hash = "#fun";
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  function dashboard(rows, opt = {}) {
    const G = !!opt.global; // vue « Le vote des participants » : anonyme, sans pseudos
    const done = rows.filter((r) => r.completed);
    if (!rows.length) return `<p class="muted">${G ? "Aucun portrait validé pour l'instant." : "Personne n'a encore utilisé ce lien."}</p>`;
    if (!done.length) return `<p class="muted">${rows.length} membre(s), aucun portrait validé pour l'instant.</p>`;
    const who = G ? "l'ensemble des utilisateurs" : "le groupe";
    const count = (key) => {
      const c = {};
      done.forEach((r) => (c[r[key]] = (c[r[key]] || 0) + 1));
      return Object.entries(c).sort((a, b) => b[1] - a[1]);
    };
    const label = (id) => (A.C[id] ? A.C[id].short : id === "indecis" ? "Indécis" : id === "blanc" ? "Blanc / abst." : id || "—");
    const color = (id) => (A.C[id] ? (A.C[id].color === "#404040" ? "#8a8f98" : A.C[id].color) : "#6b7280");
    const pct = (n) => Math.round((n / done.length) * 100);
    // une ligne par candidat : avatar, nom, barre, %, et les pseudos de ses votants
    const bars = (list, key, names) => `<div class="dbars">${list.map(([id, n]) => `<div class="dbar">
        <div class="dbar-h">${A.C[id] ? A.avatar(id, 34) : "<span class='av-ph'></span>"}<span class="dbar-n">${esc(label(id))}</span><strong>${pct(n)} %</strong></div>
        <div class="dbar-t"><i style="width:${pct(n)}%;background:${color(id)}"></i></div>
        ${names ? `<div class="voters">${done.filter((r) => String(r[key]) === id).map((r) => `<span class="voter" style="--vc:${color(id)}">${esc(r.pseudo)}</span>`).join("")}</div>`
          : `<small class="muted">${n} vote${n > 1 ? "s" : ""}</small>`}
      </div>`).join("")}</div>`;
    const avgAxes = {};
    Object.keys(Q.axes).forEach((ax) => (avgAxes[ax] = done.reduce((a, r) => a + (r.axes?.[ax] || 0), 0) / done.length));
    const avgAns = {};
    Q.questions.forEach((q) => (avgAns[q.id] = done.reduce((a, r) => a + (r.answers?.[q.id] || 0), 0) / done.length));
    const groupRes = Q.compute(avgAns);
    const coherent = done.filter((r) => r.chosen_candidate === r.top_candidate).length;
    const chosen = count("chosen_candidate"), top = groupRes.prox[0];
    return `<div class="dash">
      <div class="kpis">
        <div class="kpi"><span class="kpi-v">${G ? done.length : rows.length}</span><span class="kpi-l">${G ? "votants" : "membres"}</span><small>${G ? `${opt.groups ?? "?"} groupe(s) créés` : `${done.length} portrait(s) validé(s)`}</small></div>
        <div class="kpi lead">${A.C[chosen[0][0]] ? A.avatar(chosen[0][0], 46) : ""}<div><span class="kpi-l">En tête des votes</span><span class="kpi-v sm">${esc(label(chosen[0][0]))}</span><small>${pct(chosen[0][1])} % · ${chosen[0][1]} sur ${done.length}</small></div></div>
        <div class="kpi lead">${A.avatar(top.id, 46)}<div><span class="kpi-l">Idées les plus proches</span><span class="kpi-v sm">${esc(label(top.id))}</span><small>${top.pct} % de proximité moyenne</small></div></div>
        <div class="kpi"><span class="kpi-v">${pct(coherent)} %</span><span class="kpi-l">votent comme leurs idées</span><small>choix = résultat du quiz</small></div>
      </div>
      <div class="dash-grid">
        <section class="dcard"><h4>🗳️ Qui vote pour qui</h4><p class="muted small">Candidat choisi par ${who}${G ? "" : ", avec les pseudos"}.</p>${bars(chosen, "chosen_candidate", !G)}</section>
        <section class="dcard"><h4>🧭 Ce que disent les idées</h4><p class="muted small">Candidat le plus proche des réponses de chacun au quiz.</p>${bars(count("top_candidate"), "top_candidate", !G)}</section>
      </div>
      <section class="dcard"><h4>📍 Où se situe ${who}</h4><p class="muted small">Position moyenne sur les 5 grands axes, comparée aux 3 candidats les plus proches.</p>
        ${Q.axesHTML(null, groupRes.prox.slice(0, 3), "", [{ label: G ? "TOUS" : "GROUPE", pos: avgAxes, cls: "grp" }])}</section>
      <details class="dcard more-d"><summary>🤝 Proximité avec chaque candidat et 📊 réponses moyennes aux ${Q.questions.length} affirmations</summary>
        ${Q.proxHTML(groupRes.prox.slice(0, 8))}
        <div class="avgq">${Q.questions.map((q) => { const v = avgAns[q.id]; return `<div class="avgq-r"><span>${esc(q.q)}</span><span class="avgq-b"><b style="left:${(v + 2) * 25}%"></b></span><strong>${v > 0 ? "+" : ""}${v.toFixed(1)}</strong></div>`; }).join("")}</div>
        <p class="muted small">Échelle : −2 pas du tout d'accord … +2 tout à fait d'accord.</p></details>
      ${G ? `<p class="muted small">Résultats anonymes : aucun pseudo n'est affiché pour l'ensemble des utilisateurs. Seuls les comptes à l'adresse e-mail confirmée (hors adresses temporaires) ayant validé leur portrait sont comptés.</p>` : `
      <section class="dcard"><h4>👤 Les membres</h4><div class="members">${rows.map((r) => `<div class="member">
          ${r.completed && A.C[r.chosen_candidate] ? A.avatar(r.chosen_candidate, 30) : "<span class='av-ph'></span>"}
          <div><strong>${esc(r.pseudo)}</strong><small>${r.completed ? `vote ${esc(label(r.chosen_candidate))} · idées proches de ${esc(label(r.top_candidate))}` : "portrait pas encore validé"}</small></div></div>`).join("")}</div></section>`}
    </div>`;
  }

  async function renderGroups() {
    const box = $("#grp-list");
    box.innerHTML = msg("Chargement…");
    const { data: groups, error } = await sb.from("groups").select("*").order("created_at", { ascending: false });
    if (error) return (box.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les résultats sont masqués la veille et le jour du vote, jusqu'à 20 h." : esc(error.message), "err"));
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
    if (error) return (box.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les résultats sont masqués la veille et le jour du vote, jusqu'à 20 h." : esc(error.message), "err"));
    if (!data?.length) return (box.innerHTML = `<p class="muted">Vous n'avez encore rejoint aucun groupe. Créez un lien avec « Je sonde mes proches » ou demandez-en un à un ami !</p>`);
    const done = !!profile.completed_at;
    box.innerHTML = (done ? "" : msg("Validez votre portrait (<a href=\"#portrait\">Trouver le candidat de mes convictions</a>, page Candidats) pour découvrir les résultats de vos groupes.", "err"))
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

  async function renderAll() {
    const box = $("#all-results");
    if (!profile.completed_at) return (box.innerHTML = msg("🔒 Validez votre portrait (<a href=\"#portrait\">Trouver le candidat de mes convictions</a>, page Candidats) pour découvrir les résultats de tous les participants.", "err"));
    box.innerHTML = msg("Chargement…");
    const { data, error } = await sb.rpc("global_results");
    if (error) return (box.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les résultats sont masqués la veille et le jour du vote, jusqu'à 20 h." : esc(error.message), "err"));
    const rows = (data || []).map((r) => ({ ...r, completed: true }));
    box.innerHTML = `<div class="fun-card wide"><h3>📊 Le vote des participants — tous groupes confondus</h3>
      <p class="muted small">Tous les portraits validés avec un candidat choisi, tous groupes confondus. Échantillon non représentatif de la population : ce n'est pas un sondage.</p>
      ${dashboard(rows, { global: true, groups: data?.[0]?.groups })}</div>`;
  }

  /* ---------- Démarrage ---------- */
  async function refresh(session) {
    user = session?.user || null;
    if (!user) { portraitLoggedOut(); return renderAuth(); }
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
      el().innerHTML = `<div class="fun-card"><h3>🚧 Bientôt disponible</h3><p class="muted">Cette rubrique sera activée très prochainement. En attendant, vous pouvez estimer l'impact des programmes sur votre vie dans la rubrique « Candidats ».</p></div>`;
      if (pel()) pel().innerHTML = el().innerHTML;
      return;
    }
    const fromMail = /access_token=|error_description=|type=signup/.test(location.hash);
    const mailError = (location.hash.match(/error_description=([^&]+)/) || [])[1];
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: true, persistSession: true } });
    if (fromMail) setTimeout(() => history.replaceState(null, "", location.pathname + "#fun"), 1500);
    if (mailError) {
      el().innerHTML = msg("Le lien de confirmation n'est plus valide (" + esc(decodeURIComponent(mailError.replace(/\+/g, " "))) + "). Connectez-vous pour en recevoir un nouveau.", "err");
      setTimeout(() => renderAuth("in"), 2500);
    }
    let last;
    sb.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id || null;
      if (deleting) { last = id; return; }
      if (id === last) return; // évite les rafraîchissements inutiles (rafraîchissement du jeton…)
      last = id;
      refresh(session);
    });
  }
  window.Fun = { init };
})();
