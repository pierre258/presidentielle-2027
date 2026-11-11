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
  const FROM_RESET = /[?&]reset=1/.test(location.search) || /type=recovery/.test(location.hash);
  const PENDING_GROUP = "mds_pending_group"; // nom de groupe saisi avant d'avoir un compte
  function modal() {
    let m = $("#auth-modal");
    if (!m) {
      document.body.insertAdjacentHTML("beforeend", `<div id="auth-modal" class="am" hidden><div class="am-box" role="dialog" aria-modal="true" aria-label="Mon compte">
        <button type="button" class="am-x" aria-label="Fermer">✕</button><div class="am-body"></div></div></div>`);
      m = $("#auth-modal");
      m.addEventListener("click", (e) => { if (!m.classList.contains("lock") && (e.target === m || e.target.closest(".am-x"))) closeModal(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.hidden && !m.classList.contains("lock")) closeModal(); });
    }
    m.hidden = false; m.classList.remove("lock"); document.body.classList.add("am-open");
    return $(".am-body", m);
  }
  function closeModal() { const m = $("#auth-modal"); if (m) m.hidden = true; document.body.classList.remove("am-open"); }
  // Bouton compte du header (en haut à droite)
  function renderHeaderAcct() {
    const h = $("#hdr-acct"); if (!h) return;
    h.innerHTML = user
      ? `<a href="#fun" class="ha-me" title="Mon compte">👤 ${esc(profile?.pseudo || "Mon compte")}</a><span class="ha-btns"><button type="button" data-acct="logout">Se déconnecter</button><button type="button" data-acct="export">Télécharger mes données</button><button type="button" data-acct="delete" class="ha-del">Supprimer mon compte</button></span>`
      : `<button type="button" data-auth="up">Créer un compte</button><button type="button" data-auth="in">Se connecter</button>`;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-acct]");
    if (a && sb && user) {
      e.preventDefault();
      if (a.dataset.acct === "logout") sb.auth.signOut();
      else if (a.dataset.acct === "export") exportData();
      else if (a.dataset.acct === "delete") { if (location.hash !== "#fun") location.hash = "#fun"; setTimeout(() => { confirmDelete(); $("#fun")?.scrollIntoView({ behavior: "smooth" }); }, 50); }
      return;
    }
    const b = e.target.closest("[data-auth]");
    if (b && sb) { e.preventDefault(); renderAuth(b.dataset.auth, "", { open: true }); }
  });
  const pel = () => $("#portrait-app"); // volet « Trouver le candidat de mes convictions » de la page Candidats
  const toPortrait = `<button type="button" class="cta small" onclick="document.getElementById('portrait-app').scrollIntoView({behavior:'smooth'})">🧭 Répondre au questionnaire ↓</button>`;
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
    const I = {
      "WhatsApp": ["#25D366", '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.2c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.3 0 .5-.1.7l-.5.6c.6 1.2 1.6 2.1 2.8 2.7l.6-.6c.2-.2.4-.2.7-.1l1.6.8c.3.1.4.3.4.6v.4c0 .4-.2.8-.6 1-.5.3-1.2.4-2 .1-2.6-.9-4.6-2.9-5.5-5.4-.3-.9-.1-1.6.1-2.4Z" fill="currentColor"/>'],
      "Messenger": ["#0084FF", '<path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.4S17 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m7 13.5 3.3-3.5 2.2 2 3.5-2-3.3 3.5-2.2-2Z" fill="currentColor"/>'],
      "Telegram": ["#2AABEE", '<path d="M21 4 3 11l6 2 2 6 3-4 5 4 2-15Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 13 9-6" stroke="currentColor" stroke-width="1.6"/>'],
      "SMS": ["#3ddc97", '<path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="9" cy="10.5" r="1.1" fill="currentColor"/><circle cx="12" cy="10.5" r="1.1" fill="currentColor"/><circle cx="15" cy="10.5" r="1.1" fill="currentColor"/>'],
      "E-mail": ["#ff8fa3", '<rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8"/>'],
      "X": ["#e7e9ea", '<path d="M4 4l16 16M20 4 4 20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'],
      "Facebook": ["#1877F2", '<path d="M14 21v-7.5h2.6l.4-3H14V8.7c0-.9.3-1.5 1.5-1.5H17V4.5c-.3 0-1.2-.1-2.2-.1-2.2 0-3.8 1.3-3.8 3.8v2.3H8.5v3H11V21" fill="currentColor"/>'],
      "LinkedIn": ["#0A66C2", '<rect x="4" y="9" width="3.2" height="11" fill="currentColor"/><circle cx="5.6" cy="5.6" r="1.9" fill="currentColor"/><path d="M10 9h3v1.6c.6-1.1 1.8-1.9 3.4-1.9 2.6 0 3.6 1.7 3.6 4.4V20h-3.2v-6.1c0-1.4-.4-2.4-1.7-2.4-1.4 0-2 1-2 2.5V20H10V9Z" fill="currentColor"/>']
    };
    const items = [
      ["WhatsApp", `https://wa.me/?text=${tu}`],
      ["Messenger", `fb-messenger://share/?link=${u}`],
      ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`],
      ["SMS", `sms:?&body=${tu}`],
      ["E-mail", `mailto:?subject=${t}&body=${tu}`],
      ["X", `https://x.com/intent/post?text=${t}&url=${u}`],
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
      ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ];
    return `<div class="share-ico">${navigator.share ? `<button type="button" data-native="${esc(url)}" data-title="${esc(title)}" title="Plus d'options" aria-label="Plus d'options de partage" style="--sc:#fff">📤</button>` : ""}${items.map(([n, href]) => `<a href="${href}" target="_blank" rel="noopener" title="Partager sur ${n}" aria-label="Partager sur ${n}" style="--sc:${I[n][0]}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${I[n][1]}</svg></a>`).join("")}
        <button type="button" data-copy="${esc(url)}" data-label="🔗" title="Copier le lien" aria-label="Copier le lien" style="--sc:#fff">🔗</button></div>
      <p class="share-url">${esc(url)}</p>`;
  }
  document.addEventListener("click", (e) => {
    const menu = $("#share-menu");
    if (!menu) return;
    const t = e.target.closest("#share-toggle");
    if (!t) { if (!e.target.closest("#share-menu")) { menu.hidden = true; $("#share-toggle")?.setAttribute("aria-expanded", "false"); } return; }
    if (!menu.hidden) { menu.hidden = true; t.setAttribute("aria-expanded", "false"); return; }
    const g = $("#grp-list .grp[open][data-link]") || $("#grp-list .grp[data-link]");
    menu.innerHTML = g
      ? `<p class="share-for">Lien du groupe « <strong>${esc(g.dataset.name)}</strong> »</p>${shareHTML(g.dataset.link, `Je vous invite à comparer vos idées pour la présidentielle 2027 (« ${g.dataset.name} »)`)}`
      : `<p class="share-for">Donnez d'abord un nom à votre groupe, puis cliquez sur « Générer un lien ».</p>`;
    menu.hidden = false; t.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const lab = c.dataset.label || "Copier";
      try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = lab.length > 2 ? "Lien copié ✓" : "✓"; }
      catch { window.prompt("Copiez ce lien :", c.dataset.copy); }
      setTimeout(() => (c.textContent = lab), 1800);
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
      ${user ? "" : "Choisissez votre candidat ci-dessous et validez : aucun questionnaire à remplir."}</div>`;
  }

  // Adresses jetables refusées dès l'inscription (la base les exclut aussi des résultats)
  const DISPOSABLE = /@(yopmail\.(com|fr|net)|mailinator\.(com|net)|guerrillamail\.\w+|sharklasers\.com|grr\.la|10minutemail\.\w+|temp-?mail\.\w+|tempmailo?\.com|tempinbox\.com|tempr\.email|trashmail\.\w+|throwawaymail\.com|getnada\.com|nada\.email|maildrop\.cc|dispostable\.com|fakeinbox\.com|mytemp\.email|moakt\.com|mohmal\.com|burnermail\.io|mailnesia\.com|jetable\.org|mail-temporaire\.\w+|tmpmail\.\w+|minuteinbox\.com|emailfake\.com|discard\.email|mailsac\.com|dropmail\.me|33mail\.com|wegwerfmail\.de|simplelogin\.(com|fr)|aleeas\.com|slmail\.me|anonaddy\.(com|me)|addy\.io|duck\.com|mozmail\.com|relay\.firefox\.com|proton\.me|protonmail\.(com|ch)|pm\.me|mail\.tm|tuta\.io)$/i;
  // pas de « # » dans l'adresse de retour : Supabase y ajoute son propre fragment (#access_token=…)
  const redirectUrl = () => `${location.origin}${location.pathname}?confirm=1`;

  function checkEmailScreen(email, note = "", opts = {}) {
    const box = modal();
    box.innerHTML = `<div class="fun-card mailbox">
        <div class="mail-ico">📩</div>
        <h3>Vérifiez votre boîte mail</h3>
        <p>Un e-mail de confirmation vient d'être envoyé à <strong>${esc(email)}</strong>.<br>Cliquez sur le lien qu'il contient pour activer votre compte.</p>
        ${opts.voted ? `<p class="fun-msg ok">✓ Votre vote est enregistré : il compte déjà dans les résultats du groupe. Il comptera aussi dans « Le vote des participants » (tous groupes confondus) dès que votre adresse sera confirmée.</p>` : ""}
        ${note}
        <p class="muted small">Pensez à regarder dans les courriers indésirables. Le lien vous ramènera directement ici.</p>
        <div class="mail-actions"><button type="button" class="ghost" id="resend">Renvoyer l'e-mail</button><button type="button" class="ghost" id="back-login">J'ai confirmé : me connecter</button></div>
        <div id="resend-msg"></div></div>`;
    $("#resend", box).onclick = async () => {
      const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectUrl() } });
      $("#resend-msg", box).innerHTML = error ? msg("Envoi impossible pour le moment (limite d'envoi atteinte ?) : réessayez dans quelques minutes.", "err") : msg("✓ E-mail renvoyé.", "ok");
    };
    $("#back-login", box).onclick = () => renderAuth("in", email);
  }

  async function renderAuth(startMode = "up", prefill = "", opts = {}) {
    const box = modal();
    box.innerHTML = `${opts.note || ""}
      <div class="fun-card auth-card">
        <div class="auth-bar"><div class="seg" id="auth-tabs"><button data-t="up" class="on">Créer un compte</button><button data-t="in">Se connecter</button></div></div>
        <form id="auth-form" class="fun-form">
          <label>E-mail<input name="email" type="email" required autocomplete="email" value="${esc(prefill)}"><small class="f-up">Un e-mail de confirmation vous sera envoyé. Les adresses temporaires ne sont pas acceptées.</small></label>
          <label>Mot de passe<input name="password" type="password" required minlength="8" autocomplete="new-password"><small class="f-up">8 caractères minimum.</small></label>
          <button type="button" class="linkish f-in forgot" id="forgot">Mot de passe oublié ?</button>
          <label class="f-up consent"><input type="checkbox" name="consent" required> <span>J'ai au moins 15 ans et j'accepte les <a href="#cgu" target="_blank">conditions d'utilisation</a> et la <a href="#confidentialite" target="_blank">politique de confidentialité</a>.</span></label>
          <div id="captcha-box" class="captcha-box"></div>
          <button class="cta" type="submit">Créer mon compte →</button>
          <div id="auth-msg"></div>
        </form>
        <p class="muted small auth-note">🔒 Aucun pseudo à choisir : un pseudo anonyme (ex. « anonyme245 ») vous est attribué. Votre e-mail sert uniquement à vous connecter : il n'est jamais montré aux autres utilisateurs, ni à l'auteur d'un lien. Votre vote compte aussitôt dans vos groupes ; il ne compte dans « Le vote des participants » qu'une fois votre adresse confirmée.</p>
      </div>`;
    let mode = "up";
    const f = $("#auth-form", box);
    const setMode = (m) => {
      mode = m;
      $$("#auth-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === m));
      $$(".f-up", f).forEach((x) => (x.hidden = m !== "up"));
      $$(".f-in", f).forEach((x) => (x.hidden = m !== "in"));
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
    $("#auth-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      setMode(b.dataset.t);
    });
    setMode(startMode);
    // Mot de passe oublié : e-mail de réinitialisation (réponse identique que le compte existe ou non)
    $("#forgot", box).onclick = async () => {
      const out = $("#auth-msg", box), email = f.email.value.trim();
      if (!f.email.checkValidity() || !email) { f.email.focus(); return (out.innerHTML = msg("Saisissez d'abord votre adresse e-mail ci-dessus.", "err")); }
      if (window.TURNSTILE_SITE_KEY && !captchaToken) return (out.innerHTML = msg("Merci de valider la vérification anti-robot ci-dessus.", "err"));
      out.innerHTML = msg("Un instant…");
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}?reset=1`, captchaToken: captchaToken || undefined });
      if (error && /rate limit|seconds/i.test(error.message)) return (out.innerHTML = msg("Trop de demandes en ce moment : réessayez dans quelques minutes.", "err"));
      out.innerHTML = msg(`📩 Si un compte existe pour <strong>${esc(email)}</strong>, un e-mail vient de vous être envoyé avec un lien pour choisir un nouveau mot de passe. Pensez à regarder dans les courriers indésirables.`, "ok");
    };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#auth-msg", box);
      const email = f.email.value.trim(), password = f.password.value;
      if (window.TURNSTILE_SITE_KEY && !captchaToken) return (out.innerHTML = msg("Merci de valider la vérification anti-robot ci-dessus.", "err"));
      if (mode === "up" && DISPOSABLE.test(email)) return (out.innerHTML = msg("Les adresses e-mail temporaires ne sont pas acceptées : utilisez votre adresse habituelle.", "err"));
      out.innerHTML = msg("Un instant…");
      if (mode === "up") {
        const pending = codeFromUrl() || store.get(PENDING) || undefined;
        const pv = pendingVote(), dv = pv?.ready && pv.chosen && pv.consent ? { pending_vote: pv.chosen, vote_consent: true } : {};
        const { data, error } = await sb.auth.signUp({ email, password,
          options: { captchaToken: captchaToken || undefined, emailRedirectTo: redirectUrl(), data: { pseudo: anonPseudo(), pending_group: pending, cgu_at: new Date().toISOString(), ...dv } } });
        if (error) return (out.innerHTML = msg(/rate limit/i.test(error.message) ? "Trop d'inscriptions en ce moment : réessayez dans quelques minutes." : esc(error.message), "err"));
        if (data.user && !data.user.identities?.length) return (out.innerHTML = msg("Un compte existe déjà avec cette adresse : connectez-vous.", "err"));
        if (!data.session) { return checkEmailScreen(email, "", { voted: !!dv.pending_vote }); }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken || undefined } });
        if (error && /confirm/i.test(error.message)) return checkEmailScreen(email, msg("Votre adresse n'est pas encore confirmée.", "err"));
        if (error) return (out.innerHTML = msg("E-mail ou mot de passe incorrect.", "err"));
      }
    });
  }

  function groupFormHTML() {
    return `<div class="fun-card grp-top"><h3 class="grp-h">🔗 Je sonde mes proches <span class="anon-badge inline">🔒 <strong>100 % anonyme</strong></span></h3>
        <p class="muted small">Créez un lien de groupe et partagez-le : vous n'avez pas besoin d'avoir voté ni rempli votre portrait pour le créer.</p>
        <form id="grp-form" class="fun-form inline">
          <label>Nom de votre groupe<input name="name" required minlength="2" maxlength="60" placeholder="ex. Les copains du foot"></label>
          <span class="grp-actions"><button class="cta" type="submit">Générer un lien</button>
          <span class="share-dd"><button type="button" class="ghost share-toggle" id="share-toggle" aria-expanded="false">📤 Partager</button><div class="share-menu" id="share-menu" hidden></div></span></span></form>
        <div id="grp-list"></div></div>`;
  }
  async function renderLoggedOut() {
    const inv = await inviteBanner(), pv = pendingVote();
    if (pv?.direct) direct.chosen = pv.chosen || direct.chosen;
    el().innerHTML = `${inv}${inv.includes("invite") ? directVoteHTML() : ""}${groupFormHTML()}`;
    bindDirectVote();
    $("#grp-form").addEventListener("submit", (e) => {
      e.preventDefault();
      store.set(PENDING_GROUP, e.target.name.value.trim());
      renderAuth("up", "", { open: true, note: msg("Dernière étape : créez votre compte (ou connectez-vous). Votre lien « <strong>" + esc(e.target.name.value.trim()) + "</strong> » sera généré automatiquement.", "ok") });
    });
  }

  function renderNewPassword() {
    if ($("#pw-form")) return;
    const box = modal();
    $("#auth-modal").classList.add("lock");
    if (/[?&]reset=1/.test(location.search)) history.replaceState(null, "", location.pathname);
    if (location.hash !== "#fun") location.hash = "#fun";
    box.innerHTML = `<div class="fun-card auth-card"><h3>🔑 Choisissez un nouveau mot de passe</h3>
        <p class="muted small">Saisissez-le deux fois pour éviter toute erreur de frappe. Vous serez ensuite connecté automatiquement.</p>
        <form id="pw-form" class="fun-form">
          <label>Nouveau mot de passe<input name="pw" type="password" required minlength="8" autocomplete="new-password"><small>8 caractères minimum.</small></label>
          <label>Confirmez-le<input name="pw2" type="password" required minlength="8" autocomplete="new-password"></label>
          <label class="pw-show"><input type="checkbox" id="pw-see"> Afficher les mots de passe</label>
          <button class="cta" type="submit">Valider mon nouveau mot de passe →</button><div id="pw-msg"></div></form></div>`;
    const f = $("#pw-form", box);
    $("#pw-see", box).onchange = (e) => [f.pw, f.pw2].forEach((i) => (i.type = e.target.checked ? "text" : "password"));
    f.pw.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#pw-msg", box);
      if (f.pw.value !== f.pw2.value) return (out.innerHTML = msg("Les deux mots de passe ne correspondent pas.", "err"));
      out.innerHTML = msg("Un instant…");
      const { error } = await sb.auth.updateUser({ password: f.pw.value });
      if (error) return (out.innerHTML = msg(/different|same/i.test(error.message) ? "Choisissez un mot de passe différent de l'ancien." : /session|expired|missing/i.test(error.message) ? "Le lien a expiré : refaites une demande de « Mot de passe oublié »." : "Modification impossible : " + esc(error.message), "err"));
      $("#auth-modal").classList.remove("lock");
      box.innerHTML = `<div class="fun-card mailbox"><div class="mail-ico">✅</div><h3>Mot de passe modifié</h3><p>Vous êtes maintenant connecté avec votre nouveau mot de passe.</p></div>`;
      setTimeout(() => { closeModal(); location.hash = "#fun"; }, 1800);
    });
  }

  // pseudo anonyme attribué à chaque participant (jamais dérivé de l'e-mail)
  function anonPseudo() {
    const n = new Uint32Array(1); crypto.getRandomValues(n);
    return "anonyme" + (100 + (n[0] % 9900));
  }
  async function ensureProfile() {
    let { data } = await sb.from("profiles").select("id, pseudo, created_at").eq("id", user.id).maybeSingle();
    if (!data) {
      const meta = user.user_metadata?.pseudo;
      const pseudo = /^anonyme\d+$/.test(meta || "") ? meta : anonPseudo();
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
      : msg(`✓ Vous avez rejoint « <strong>${esc(data)}</strong> ». Si ce n'est pas déjà fait, votez ci-dessous pour découvrir les résultats du groupe.`, "ok");
  }

  /* Questionnaire approfondi (optionnel) : 30 affirmations sur les grands sujets de société */
  let EXT = null;
  const MIN_COVER = 10; // un candidat n'est comparé sur l'approfondi que s'il a au moins 10 positions connues
  const extCover = (id) => Object.values(EXT?.stances?.[id] || {}).filter((v) => v).length;
  function computeFull(ans) {
    const base = Q.compute(ans);
    if (!EXT || !Object.keys(ans).some((k) => k.startsWith("a_"))) return base;
    const prio = new Set(ans._prio || []);
    const ids = base.prox.map((p) => p.id);
    const prox = ids.map((id) => {
      const st = { ...(window.Simulateur.quiz.stancesOf?.(id) || {}) };
      let sum = 0, w = 0;
      Q.questions.forEach((q) => { if (ans[q.id]) { sum += Math.abs(ans[q.id] - (st[q.id] ?? 0)); w += 1; } });
      if (extCover(id) >= MIN_COVER) EXT.questions.forEach((q) => {
        if (ans[q.id] === undefined || ans[q.id] === 0) return;
        const k = prio.has(q.theme) ? 2 : 1;
        sum += k * Math.abs(ans[q.id] - (EXT.stances[id]?.[q.id] ?? 0)); w += k;
      });
      return { id, pct: w ? Math.round((1 - sum / w / 4) * 100) : 0, partial: extCover(id) < MIN_COVER };
    }).sort((a, b) => b.pct - a.pct);
    return { ...base, prox, answered: base.answered + EXT.questions.filter((q) => ans[q.id]).length, extended: true };
  }

  /* Choix du vote : pictos de tous les candidats, ordre alphabétique (neutralité) */
  const surname = (n) => n.replace(/^\S+\s+/, "").replace(/^(de|d'|du)\s+/i, "");
  const candList = () => Object.values(A.C).filter((c) => c.id !== "bardella").sort((a, b) => surname(a.name).localeCompare(surname(b.name), "fr"));
  const choiceLabel = (ch) => A.C[ch] ? A.C[ch].name : ch === "indecis" ? "Je ne sais pas encore" : ch === "blanc" ? "Vote blanc / abstention" : "";
  function voteGridHTML() {
    return `<div class="vote-pick"><h3>🗳️ Pour qui voulez-vous voter ?</h3>
      <p class="muted small">Touchez un candidat (présentés par ordre alphabétique). Vous pouvez changer d'avis à tout moment.</p>
      <div class="avatar-grid vp-grid">${candList().map((c) => `<button type="button" class="pick ${stepper.chosen === c.id ? "on" : ""}" data-vote="${c.id}">${A.avatar(c.id, 56)}${esc(c.short)}</button>`).join("")}
        <button type="button" class="pick vp-other ${stepper.chosen === "indecis" ? "on" : ""}" data-vote="indecis"><span class="vp-ico">🤔</span>Je ne sais pas encore</button>
        <button type="button" class="pick vp-other ${stepper.chosen === "blanc" ? "on" : ""}" data-vote="blanc"><span class="vp-ico">⚪</span>Vote blanc</button></div></div>`;
  }
  function bindVoteGrid() {
    $$("#portrait-app [data-vote]").forEach((b) => (b.onclick = () => {
      stepper.chosen = b.dataset.vote;
      savePendingDraft();
      $$("#portrait-app [data-vote]").forEach((x) => x.classList.toggle("on", x === b));
      if ($("#stepper") && stepper.i >= (stepper.ext ? Q.questions.length + EXT.questions.length : Q.questions.length)) renderStep();
    }));
  }

  /* Vote direct (page « Que votent mes amis ? ») : choix du candidat, sans questionnaire */
  const direct = { chosen: "", open: false };
  function directVoteHTML() {
    const ch = direct.chosen;
    return `<div class="fun-card wide vote-direct" id="vote-direct"><h3>🗳️ Pour qui voulez-vous voter ?</h3>
      <p class="muted small">Touchez un candidat (ordre alphabétique), puis validez. Vous pourrez changer d'avis à tout moment.</p>
      <div class="avatar-grid vp-grid">${candList().map((c) => `<button type="button" class="pick ${ch === c.id ? "on" : ""}" data-dvote="${c.id}">${A.avatar(c.id, 56)}${esc(c.short)}</button>`).join("")}
        <button type="button" class="pick vp-other ${ch === "indecis" ? "on" : ""}" data-dvote="indecis"><span class="vp-ico">🤔</span>Je ne sais pas encore</button>
        <button type="button" class="pick vp-other ${ch === "blanc" ? "on" : ""}" data-dvote="blanc"><span class="vp-ico">⚪</span>Vote blanc</button></div>
      <label class="consent-vote"><input type="checkbox" id="dv-consent"> <span><b>Je consens au traitement de mon opinion politique</b> (mon choix de candidat) pour le « Que votent mes amis ? » et ses résultats. Consentement distinct des conditions d'utilisation, retirable à tout moment (« Retirer mon vote ») ; mon vote est conservé à part de mon adresse e-mail et supprimé après l'élection.</span></label>
      <div class="dv-go"><button type="button" class="cta" id="dv-save">${user ? "Valider mon vote ✓" : "Valider mon vote →"}</button>
        ${user ? "" : `<small class="muted">Création d'un compte gratuit requise (e-mail + mot de passe) pour valider.</small>`}</div>
      <div id="dv-msg"></div></div>`;
  }
  function myVoteHTML() {
    const ch = profile.chosen_candidate;
    return `<div class="fun-card wide my-vote"><div class="port-ch">${A.C[ch] ? A.avatar(ch, 44) : ""}<div><small class="muted">Mon vote</small><strong>${esc(choiceLabel(ch) || "—")}</strong></div></div>
      <div class="port-btns"><button type="button" class="ghost" id="dv-change">✏️ Changer mon vote</button><button type="button" class="ghost danger" id="dv-withdraw">↩︎ Retirer mon vote</button></div></div>`;
  }
  function bindDirectVote() {
    $$("[data-dvote]").forEach((b) => (b.onclick = () => {
      direct.chosen = b.dataset.dvote;
      $$("[data-dvote]").forEach((x) => x.classList.toggle("on", x === b));
    }));
    const ch = $("#dv-change");
    if (ch) ch.onclick = () => { direct.open = true; direct.chosen = profile.chosen_candidate || ""; ch.closest(".my-vote").outerHTML = directVoteHTML(); bindDirectVote(); };
    const wd = $("#dv-withdraw");
    if (wd) wd.onclick = async () => {
      wd.disabled = true;
      const { error } = await sb.rpc("delete_my_ballot");
      if (error) { wd.disabled = false; return alert("Impossible de retirer le vote : " + error.message); }
      ["answers", "axes", "top_candidate", "top_pct", "chosen_candidate", "completed_at", "consent_at"].forEach((k) => delete profile[k]);
      direct.chosen = ""; direct.open = false;
      await renderApp(msg("✓ Votre vote a été supprimé. Votre compte reste actif : vous pouvez revoter quand vous voulez.", "ok"));
    };
    const sv = $("#dv-save");
    if (sv) sv.onclick = saveDirectVote;
  }
  async function saveDirectVote() {
    const out = $("#dv-msg");
    if (!direct.chosen) return (out.innerHTML = msg("Touchez d'abord un candidat (ou « Je ne sais pas encore »).", "err"));
    if (!$("#dv-consent")?.checked) return (out.innerHTML = msg("Cochez la case de consentement pour enregistrer votre vote.", "err"));
    if (!user) {
      store.set(PENDING_VOTE, JSON.stringify({ chosen: direct.chosen, ready: true, consent: true, direct: true, at: new Date().toISOString() }));
      out.innerHTML = msg("Dernière étape : créez votre compte pour valider votre vote.", "ok");
      return renderAuth("up", "", { open: true, note: msg(`🗳️ Votre choix : <strong>${esc(choiceLabel(direct.chosen))}</strong>. Dernière étape : créez votre compte (ou connectez-vous) pour valider votre vote. Il est enregistré dès la création du compte, même avant la confirmation de votre e-mail.`, "ok") });
    }
    $("#dv-save").disabled = true;
    // le questionnaire éventuel déjà rempli est conservé
    const { error } = await sb.rpc("save_ballot", { p_answers: profile.answers || null, p_axes: profile.axes || null, p_top: profile.top_candidate || null, p_pct: profile.top_pct ?? null, p_chosen: direct.chosen, p_consent: true });
    if (error) { $("#dv-save").disabled = false; return (out.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les votes reprendront après la fermeture des bureaux (20 h)." : "Enregistrement impossible : " + esc(error.message), "err")); }
    Object.assign(profile, { chosen_candidate: direct.chosen, completed_at: profile.completed_at || new Date().toISOString(), consent_at: new Date().toISOString() });
    direct.open = false;
    await renderApp(msg("✓ Vote enregistré ! Découvrez ci-dessous les résultats de vos groupes et de tous les participants.", "ok"));
    if ($('#fun-tabs [data-p="f-joined"]') && (await sb.rpc("my_joined_groups")).data?.length) $('#fun-tabs [data-p="f-joined"]').click();
  }

  /* Vote préparé sans compte : gardé sur l'appareil jusqu'à la création du compte */
  const PENDING_VOTE = "mds_pending_ballot";
  const pendingVote = () => { try { return JSON.parse(store.get(PENDING_VOTE) || "null"); } catch { return null; } };
  function savePendingDraft(extra = {}) {
    if (user) return;
    store.set(PENDING_VOTE, JSON.stringify({ ...(pendingVote() || {}), ans: stepper.ans, chosen: stepper.chosen, ext: !!stepper.ext, ...extra }));
  }

  /* Questionnaire pas à pas : une affirmation par écran, flèches précédent / suivant */
  const CHOICES = [["-2", "Pas du tout d'accord"], ["-1", "Plutôt pas d'accord"], ["0", "Sans avis"], ["1", "Plutôt d'accord"], ["2", "Tout à fait d'accord"]];
  const stepper = { i: 0, ans: {}, chosen: "" };
  function renderPrio() {
    const box = $("#stepper"), sel = new Set(stepper.ans._prio || []);
    box.innerHTML = `<div class="st-card ext-intro"><div class="st-num">🔎 Questionnaire approfondi · facultatif</div>
        <p class="st-q">Quels sujets comptent le plus pour vous ?</p>
        <p class="muted small">${esc(EXT.intro)} Choisissez jusqu'à 3 priorités : elles compteront double dans le calcul.</p>
        <div class="prio-grid">${EXT.themes.map((t) => `<button type="button" class="prio ${sel.has(t.id) ? "on" : ""}" data-t="${t.id}"><span>${t.icon}</span>${esc(t.label)}</button>`).join("")}</div></div>
      <div class="st-nav"><button type="button" class="ghost" id="prio-back">← Revenir</button><span class="muted small" id="prio-n">${sel.size}/3</span>
        <button type="button" class="cta small" id="prio-go">Commencer les ${EXT.questions.length} affirmations →</button></div>`;
    $$(".prio", box).forEach((b) => (b.onclick = () => {
      const t = b.dataset.t;
      if (sel.has(t)) sel.delete(t); else if (sel.size < 3) sel.add(t);
      $$(".prio", box).forEach((x) => x.classList.toggle("on", sel.has(x.dataset.t)));
      $("#prio-n").textContent = `${sel.size}/3`;
    }));
    $("#prio-back").onclick = () => { stepper.ext = false; stepper.i = Q.questions.length; renderStep(); };
    $("#prio-go").onclick = () => { stepper.ans._prio = [...sel]; stepper.prio = false; stepper.i = Q.questions.length; renderStep(); };
  }
  function renderStep() {
    if (stepper.prio) return renderPrio();
    const qs = stepper.ext ? [...Q.questions, ...EXT.questions] : Q.questions, n = qs.length, box = $("#stepper");
    const answered = qs.filter((q) => stepper.ans[q.id] !== undefined).length;
    const prog = `<div class="st-prog"><i style="width:${(Math.min(stepper.i, n) / n) * 100}%"></i></div>
      <div class="st-dots">${qs.map((q, k) => `<button type="button" class="st-dot ${k === stepper.i ? "cur" : ""} ${stepper.ans[q.id] !== undefined ? "done" : ""}" data-go="${k}" aria-label="Question ${k + 1}"></button>`).join("")}<button type="button" class="st-dot last ${stepper.i === n ? "cur" : ""}" data-go="${n}" aria-label="Choix du candidat">🗳</button></div>`;
    if (stepper.i < n) {
      const q = qs[stepper.i], cur = stepper.ans[q.id];
      box.innerHTML = `${prog}
        <div class="st-card">
          <div class="st-num">Question ${stepper.i + 1} / ${n}${q.theme ? ` · <span class="ext-chip">${(EXT.themes.find((t) => t.id === q.theme) || {}).icon || ""} ${esc((EXT.themes.find((t) => t.id === q.theme) || {}).label || "")}${(stepper.ans._prio || []).includes(q.theme) ? " · priorité ×2" : ""}</span>` : ""}</div>
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
          ${EXT && !stepper.ext ? `<div class="ext-offer"><div><b>🔎 Envie d'un résultat plus précis ?</b><span class="muted small">Facultatif : ${EXT.questions.length} affirmations de plus sur ${EXT.themes.length} grands sujets de société (santé, sécurité, pouvoir d'achat, logement…), comparées aux programmes. Environ 6 minutes.</span></div><button type="button" class="ghost" id="ext-go">Approfondir mon portrait →</button></div>` : ""}
          ${stepper.ext ? `<p class="muted small">✓ Questionnaire approfondi : ${EXT.questions.filter((q) => stepper.ans[q.id] !== undefined).length} affirmation(s) renseignée(s)${(stepper.ans._prio || []).length ? `, priorités : ${stepper.ans._prio.map((t) => (EXT.themes.find((x) => x.id === t) || {}).label).join(", ")}` : ""}.</p>` : ""}
          <div class="st-num">Dernière étape</div>
          <p class="st-q">Votre vote</p>
          ${stepper.chosen ? `<div class="vp-recap">${A.C[stepper.chosen] ? A.avatar(stepper.chosen, 44) : ""}<b>${esc(choiceLabel(stepper.chosen))}</b><span class="muted small">(modifiable dans la grille ci-dessus)</span></div>`
            : `<p class="warn">⬆️ Choisissez votre candidat dans la grille ci-dessus.</p>`}
          <p class="muted small">${answered} affirmation${answered > 1 ? "s" : ""} renseignée${answered > 1 ? "s" : ""} sur ${n}${answered < 5 ? " — il en faut au moins 5 pour valider." : "."}</p>
          <label class="consent-vote"><input type="checkbox" id="vote-consent"> <span><b>Je consens au traitement de mon opinion politique</b> (mes réponses et mon choix de candidat) pour le « Que votent mes amis ? » et ses résultats. Ce consentement est distinct des conditions d'utilisation ; je peux le retirer à tout moment en un clic (« Retirer mon vote »). Mon vote est conservé à part de mon adresse e-mail et supprimé après l'élection.</span></label>
        </div>
        <div class="st-nav"><button type="button" class="ghost" id="st-prev">← Précédent</button><span></span>
          <button type="button" class="cta" id="fun-save">${user ? "Valider mon vote ✓" : "Valider et créer mon compte →"}</button></div><div id="fun-save-msg"></div>`;
      $("#fun-save").onclick = savePortrait;
      const eg = $("#ext-go");
      if (eg) eg.onclick = () => { stepper.ext = true; stepper.prio = true; renderStep(); };
    }
    $$("[data-go]", box).forEach((d) => (d.onclick = () => { stepper.i = +d.dataset.go; renderStep(); }));
    $("#st-prev").onclick = () => { if (stepper.i > 0) { stepper.i--; renderStep(); } };
    const next = $("#st-next");
    if (next) next.onclick = () => { stepper.i++; renderStep(); };
    $$(".st-ch", box).forEach((c) => (c.onclick = () => {
      stepper.ans[qs[stepper.i].id] = +c.dataset.v;
      savePendingDraft();
      $$(".st-ch", box).forEach((x) => x.classList.toggle("on", x === c));
      setTimeout(() => { stepper.i++; renderStep(); }, 220); // passe tout seul à la question suivante
    }));
  }

  // Barre d'onglets du Petit vote : « Je sonde mes proches » à gauche, puis les résultats
  // « Je sonde mes proches » : bouton à part, tout à gauche ; puis les résultats
  function tabsHTML() {
    return `<div class="seg big fun-tabs"><button data-p="f-all" class="on">📊 Le vote des participants</button><button data-p="f-joined">👥 Mes groupes</button></div>`;
  }

  function portraitLoggedOut() {
    if (!pel()) return;
    profile = {};
    const pv = pendingVote();
    stepper.ans = { ...(pv?.ans || {}) }; stepper.chosen = pv?.chosen || ""; stepper.ext = !!(pv?.ext && EXT); stepper.prio = false; stepper.i = 0; stepper.editing = false;
    pel().innerHTML = `${voteGridHTML()}<div id="f-portrait">${portraitPane()}</div><div id="port-msg"></div>`;
    bindVoteGrid(); bindPortrait();
  }

  const hasQuiz = () => !!profile?.completed_at && !!profile.answers && Object.keys(profile.answers).length > 0;
  function portraitPane() {
    const done = hasQuiz();
    if (done && !stepper.editing) {
      const res = computeFull(profile.answers || {});
      const ch = profile.chosen_candidate;
      const chLabel = A.C[ch] ? A.C[ch].name : ch === "indecis" ? "Je ne sais pas encore" : ch === "blanc" ? "Vote blanc / abstention" : "—";
      return `<div class="fun-card wide port-sum">
          <div><small class="muted">Mon choix</small><div class="port-ch">${A.C[ch] ? A.avatar(ch, 44) : ""}<strong>${esc(chLabel)}</strong></div></div>
          <div><small class="muted">Le plus proche selon le quiz</small><div class="port-ch">${A.avatar(res.prox[0].id, 44)}<strong>${esc(A.C[res.prox[0].id].name)} · ${res.prox[0].pct} %</strong></div></div>
          <div class="port-btns"><button type="button" class="ghost" id="edit-portrait">✏️ Modifier mon portrait</button>
            <button type="button" class="ghost danger" id="withdraw-vote">↩︎ Retirer mon vote</button></div></div>`;
    }
    return `<h3 class="quiz-title">🧭 Vérifiez si vos idées correspondent au programme du candidat que vous soutenez</h3>
      <div id="stepper" class="stepper"></div><div id="fun-result" class="sim-out"></div>`;
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
    const pv = pendingVote();
    if (pv?.ready && pv.chosen) {
      if (!profile.completed_at) {
        const res = pv.full ? computeFull(pv.full) : null;
        const row = { answers: pv.full || null, axes: res?.axes || null, top_candidate: res?.prox[0].id || null, top_pct: res?.prox[0].pct ?? null };
        const { error } = await sb.rpc("save_ballot", { p_answers: row.answers, p_axes: row.axes, p_top: row.top_candidate, p_pct: row.top_pct, p_chosen: pv.chosen, p_consent: !!pv.consent });
        if (!error) { Object.assign(profile, row, { chosen_candidate: pv.chosen, completed_at: new Date().toISOString() }); notice += msg("✓ Votre vote a bien été enregistré.", "ok"); }
      }
      store.del(PENDING_VOTE);
    } else if (pv) store.del(PENDING_VOTE);
    notice += await statusNote();
    const done = !!profile.completed_at;
    if (done) notice = notice.replace(" Si ce n'est pas déjà fait, votez ci-dessous pour découvrir les résultats du groupe.", "");
    stepper.ans = { ...(profile.answers || {}) };
    stepper.ext = !!EXT && Object.keys(stepper.ans).some((k) => k.startsWith("a_")); stepper.prio = false;
    stepper.chosen = profile.chosen_candidate || "";
    stepper.i = 0;
    el().innerHTML = `${notice}
      ${done && !direct.open ? myVoteHTML() : directVoteHTML()}
      ${groupFormHTML()}
      <div class="fun-tabbar" id="fun-tabs">${tabsHTML()}</div>
      <div class="fun-pane" id="f-joined" hidden><div id="joined-list"></div></div>
      <div class="fun-pane" id="f-all"><div id="all-results"></div></div>`;
    pel().innerHTML = `${hasQuiz() && !stepper.editing ? "" : voteGridHTML()}<div id="f-portrait">${portraitPane()}</div><div id="port-msg"></div>`;
    bindVoteGrid();
    $("#fun-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (!b.dataset.p) return;
      $$("#fun-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$(".fun-pane").forEach((p) => (p.hidden = p.id !== b.dataset.p));
      if (b.dataset.p === "f-joined") renderJoined();
      if (b.dataset.p === "f-all") renderAll();
    });
    $("#grp-form").addEventListener("submit", createGroup);
    if (!done) direct.chosen = direct.chosen || "";
    bindDirectVote();
    bindPortrait();
    renderAll();
    const pg = store.get(PENDING_GROUP);
    if (pg) { store.del(PENDING_GROUP); await createGroup(null, pg); } else renderGroups();
  }

  /* ---------- Télécharger mes données (droits d'accès et de portabilité) ---------- */
  async function exportData() {
    const [{ data: prof }, { data: ballot }, { data: groups }] = await Promise.all([
      sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      sb.rpc("my_ballot"),
      sb.rpc("my_joined_groups"),
    ]);
    const out = {
      export: "moyennedessondages2027.fr — vos données personnelles", date: new Date().toISOString(),
      compte: { email: user.email, cree_le: user.created_at, email_confirme_le: user.email_confirmed_at, derniere_connexion: user.last_sign_in_at, cgu_acceptees_le: user.user_metadata?.cgu_at || null },
      profil: prof || null, bulletin: (ballot && ballot[0]) || null, groupes: groups || [],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "mes-donnees-moyennedessondages2027.json" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
      $("#del-back").onclick = () => { deleting = false; renderHeaderAcct(); renderLoggedOut(); };
    };
  }

  function bindPortrait() {
    if ($("#stepper")) renderStep();
    const ed = $("#edit-portrait");
    if (ed) ed.onclick = () => { stepper.editing = true; $("#f-portrait").insertAdjacentHTML("beforebegin", voteGridHTML()); $("#f-portrait").innerHTML = portraitPane(); bindVoteGrid(); bindPortrait(); };
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
    if (stepper.ext && EXT) { EXT.questions.forEach((q) => { if (stepper.ans[q.id] !== undefined) ans[q.id] = stepper.ans[q.id]; }); ans._prio = stepper.ans._prio || []; }
    const res = computeFull(ans);
    const out = $("#fun-save-msg");
    const filled = Q.questions.filter((q) => stepper.ans[q.id] !== undefined).length;
    if (filled < 5) return (out.innerHTML = msg("Répondez à au moins 5 affirmations pour valider votre portrait.", "err"));
    const chosen = stepper.chosen;
    if (!chosen) return (out.innerHTML = msg("Indiquez votre choix de candidat (ou « Je ne sais pas encore »).", "err"));
    if (!$("#vote-consent")?.checked) return (out.innerHTML = msg("Cochez la case de consentement au traitement de votre opinion politique pour enregistrer votre vote.", "err"));
    if (!user) {
      savePendingDraft({ ready: true, consent: true, at: new Date().toISOString(), full: ans });
      out.innerHTML = msg("✓ Vos réponses sont gardées sur cet appareil. Dernière étape : créez votre compte (ou connectez-vous). Votre vote sera enregistré dès votre adresse e-mail confirmée.", "ok");
      await renderAuth("up", "", { open: true, note: msg("✓ Vos réponses sont gardées sur cet appareil. Dernière étape : créez votre compte (ou connectez-vous) pour enregistrer votre vote.", "ok") });
      return;
    }
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

  async function createGroup(e, pendingName) {
    e?.preventDefault();
    const name = pendingName || e.target.name.value.trim();
    const { data: g, error } = await sb.from("groups").insert({ name }).select().single();
    if (error) { renderGroups(); return alert("Création impossible : " + error.message); }
    await sb.rpc("join_group", { p_code: g.code }); // le créateur compte aussi dans les résultats
    e?.target.reset();
    await renderGroups();
    if (pendingName) $("#grp-list")?.insertAdjacentHTML("afterbegin", msg(`✓ Votre lien « <strong>${esc(name)}</strong> » est prêt : cliquez sur « 📤 Partager ».`, "ok"));
  }

  /* ---------- Tableau de bord du créateur ---------- */
  function dashboard(rows, opt = {}) {
    const G = !!opt.global; // vue « Le vote des participants » : anonyme, sans pseudos
    const done = rows.filter((r) => r.completed);
    if (!rows.length) return `<p class="muted">${G ? "Aucun vote validé pour l'instant." : "Personne n'a encore utilisé ce lien."}</p>`;
    if (!done.length) return `<p class="muted">${rows.length} membre(s), aucun vote validé pour l'instant.</p>`;
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
    const chosen = count("chosen_candidate");
    const row = ([id, n], i) => `<div class="prow ${i < 4 ? "" : "small"}">
        ${A.C[id] ? A.avatar(id, i < 4 ? 52 : 32) : `<span class="av-ph" style="width:${i < 4 ? 52 : 32}px;height:${i < 4 ? 52 : 32}px"></span>`}
        <div><div class="name">${esc(A.C[id] ? A.C[id].name : label(id))}${A.C[id] ? ` <span class="party">${esc(A.C[id].party || "")}</span>` : ""}</div>
          <div class="bar"><i style="width:${(n / chosen[0][1]) * 100}%;background:${i < 4 ? "#fff" : "rgba(255,255,255,.85)"}"></i></div></div>
        <div><div class="score">${pct(n)}<sup>%</sup></div><small class="muted">${n} vote${n > 1 ? "s" : ""}</small></div></div>`;
    return `<div class="dash">
      <div class="poll-card grp-poll"><div class="poll-card-title"><span>${G ? "Le vote des participants" : "Le vote du groupe"} :</span> ${done.length} vote${done.length > 1 ? "s" : ""}</div>
        ${chosen.map(row).join("")}</div>
      ${G ? `<p class="muted small">Seuls les comptes à l'adresse e-mail confirmée (hors adresses temporaires) sont comptés.</p>` : ""}
      <p class="anon-badge">🔒 <strong>100 % anonyme</strong></p>
    </div>`;
  }

  async function renderGroups() {
    const box = $("#grp-list");
    box.innerHTML = msg("Chargement…");
    const { data: groups, error } = await sb.from("groups").select("*").order("created_at", { ascending: false });
    if (error) return (box.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les résultats sont masqués la veille et le jour du vote, jusqu'à 20 h." : esc(error.message), "err"));
    if (!groups.length) return (box.innerHTML = `<p class="muted">Vous n'avez pas encore créé de lien.</p>`);
    box.innerHTML = groups.map((g) => `<details class="grp" data-id="${g.id}" data-link="${esc(linkFor(g.code))}" data-name="${esc(g.name)}"><summary><strong>${esc(g.name)}</strong><span class="muted small">créé le ${new Date(g.created_at).toLocaleDateString("fr-FR")}</span></summary>
      <div class="grp-in">
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
    box.innerHTML = (done ? "" : msg("Votez ci-dessus pour découvrir les résultats de vos groupes.", "err"))
      + data.map((g) => `<details class="grp" data-id="${g.group_id}"><summary><strong>${esc(g.name)}</strong>
          <span class="muted small">${g.is_owner ? "créé par vous" : `créé par ${esc(g.owner_pseudo)}`} · ${g.members} membre${g.members > 1 ? "s" : ""}</span></summary>
          <div class="grp-in"><div class="grp-dash">${done ? msg("Chargement des résultats…") : `<p class="muted">🔒 Résultats visibles une fois votre vote validé.</p>`}</div>
          ${g.is_owner ? "" : `<button type="button" class="ghost danger" data-leave="${g.group_id}">Quitter ce groupe</button>`}</div></details>`).join("")
      + `<p class="anon-badge">🔒 <strong>100 % anonyme</strong></p>`;
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
    if (!profile.completed_at) return (box.innerHTML = msg("🔒 Votez ci-dessus pour découvrir les résultats de tous les participants.", "err"));
    box.innerHTML = msg("Chargement…");
    const { data, error } = await sb.rpc("global_results");
    if (error) return (box.innerHTML = msg(/réserve/.test(error.message) ? "🔒 Période de réserve électorale : les résultats sont masqués la veille et le jour du vote, jusqu'à 20 h." : esc(error.message), "err"));
    const rows = (data || []).map((r) => ({ ...r, completed: true }));
    box.innerHTML = `<div class="fun-card wide"><h3>📊 Le vote des participants — tous groupes confondus</h3>
      <p class="muted small">Tous les votes validés, tous groupes confondus, des seuls comptes à l'adresse e-mail confirmée. Échantillon non représentatif de la population : ce n'est pas un sondage.</p>
      ${dashboard(rows, { global: true, groups: data?.[0]?.groups })}</div>`;
  }

  /* ---------- Démarrage ---------- */
  async function refresh(session) {
    user = session?.user || null;
    if (!user) { profile = null; renderHeaderAcct(); portraitLoggedOut(); return renderLoggedOut(); }
    if (!$("#pw-form")) closeModal();
    const notice = await joinPending();
    await renderApp(notice);
    renderHeaderAcct();
    if (notice.includes("ok") && profile?.completed_at) $('#fun-tabs [data-p="f-joined"]').click();
  }

  function init(app) {
    A = app; Q = window.Simulateur.quiz;
    fetch("data/quiz_approfondi.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((d) => (EXT = d)).catch(() => {});
    const code = codeFromUrl();
    if (code) store.set(PENDING, code);
    const cfg = window.FUN_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      $("#hdr-acct")?.remove();
      el().innerHTML = `<div class="fun-card"><h3>🚧 Bientôt disponible</h3><p class="muted">Cette rubrique sera activée très prochainement. En attendant, vous pouvez estimer l'impact des programmes sur votre vie dans la rubrique « Candidats ».</p></div>`;
      if (pel()) pel().innerHTML = el().innerHTML;
      return;
    }
    const fromMail = /access_token=|error_description=|type=signup/.test(location.hash) || /[?&](reset|confirm)=1/.test(location.search);
    const mailError = (location.hash.match(/error_description=([^&]+)/) || [])[1];
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: true, persistSession: true } });
    if (fromMail) setTimeout(() => { history.replaceState(null, "", location.pathname); location.hash = "#fun"; }, 1500);
    if (mailError) {
      setTimeout(() => renderAuth("in", "", { open: true, note: msg("Le lien de confirmation n'est plus valide (" + esc(decodeURIComponent(mailError.replace(/\+/g, " "))) + "). Connectez-vous pour en recevoir un nouveau.", "err") }), 600);
    }
    let last;
    let recovering = FROM_RESET;
    sb.auth.onAuthStateChange((ev, session) => {
      const id = session?.user?.id || null;
      if (ev === "PASSWORD_RECOVERY" || (recovering && id)) { recovering = false; setTimeout(renderNewPassword, 900); }
      if (deleting) { last = id; return; }
      if (id === last) return; // évite les rafraîchissements inutiles (rafraîchissement du jeton…)
      last = id;
      refresh(session);
    });
  }
  window.Fun = { init };
})();
