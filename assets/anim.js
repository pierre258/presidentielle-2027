/* Animations d'interface : apparition au défilement, compteurs des sondages, cascade des lignes.
   Tout est désactivé si l'utilisateur a demandé de réduire les animations. */
(() => {
  if (!window.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("anim");

  // 1. Apparition douce des blocs quand ils entrent à l'écran
  const SEL = ".poll-card, .race-card, .fun-card, .grp-blocks > .grp, .dcard, .plat-cards, .panel-head, .site-foot .foot-grid > div, .bcard, #prog-grid > .pick, .tp-row, .parr-bars, .parr-status";
  const io = new IntersectionObserver((ents) => ents.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("rv-on"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  const tag = (root) => {
    (root.matches?.(SEL) ? [root] : []).concat([...(root.querySelectorAll?.(SEL) || [])]).forEach((el) => {
      if (el.classList.contains("rv")) return;
      el.classList.add("rv");
      // déjà visible : on l'anime tout de suite
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) requestAnimationFrame(() => el.classList.add("rv-on"));
      else io.observe(el);
    });
  };

  // 2. Sondages : chiffres qui défilent jusqu'à leur valeur, lignes en cascade
  const last = new Map();
  const parse = (t) => parseFloat(String(t).replace(",", ".")) || 0;
  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString("fr-FR");
  function countUp(box) {
    box.querySelectorAll(".prow").forEach((row, i) => {
      row.style.setProperty("--i", i);
      row.classList.remove("cascade"); void row.offsetWidth; row.classList.add("cascade");
      const sc = row.querySelector(".score"), node = sc?.firstChild;
      if (!node || node.nodeType !== 3) return;
      const id = row.dataset.cand, to = parse(node.textContent), from = last.get(id) ?? 0;
      last.set(id, to);
      if (from === to) return;
      const t0 = performance.now(), D = 900 + i * 40;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
        node.textContent = fmt(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step); else node.textContent = fmt(to);
      };
      requestAnimationFrame(step);
    });
  }

  // filet de sécurité : vérification directe à chaque défilement / changement de rubrique
  let pend = false;
  const sweep = () => {
    pend = false;
    document.querySelectorAll(".rv:not(.rv-on)").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < innerHeight * 0.95 && r.bottom > 0) { el.classList.add("rv-on"); io.unobserve(el); }
    });
  };
  const soon = () => { if (!pend) { pend = true; requestAnimationFrame(sweep); } };
  addEventListener("scroll", soon, { passive: true });
  addEventListener("resize", soon);
  addEventListener("hashchange", () => setTimeout(sweep, 60));
  setInterval(sweep, 1200);

  const start = () => {
    tag(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) tag(n);
      soon();
    }).observe(document.body, { childList: true, subtree: true });
    const bars = document.getElementById("poll-bars");
    if (bars) {
      new MutationObserver(() => countUp(bars)).observe(bars, { childList: true });
      if (bars.children.length) countUp(bars);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
