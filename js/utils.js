// =========================================================
// Petites fonctions utilitaires partagées par tous les fichiers
// =========================================================

// Date du jour au format "AAAA-MM-JJ" (le format des champs <input type="date">).
// On la construit à la main pour rester sur l'heure locale (Macao) et pas l'heure UTC.
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// "2026-10-04" -> "4 oct. 2026"
function formatDate(iso) {
  const parts = iso.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Identifiant unique pour chaque opération (sert à la modifier ou la supprimer).
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Protège l'affichage : un libellé comme "<b>" s'affiche tel quel au lieu
// d'être interprété comme du HTML.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Arrondit au centime (évite les 0.1 + 0.2 = 0.30000000000000004).
function roundCents(value) {
  return Math.round(value * 100) / 100;
}

// ---------- Icônes au trait (dessinées en SVG, sans fichier image) ----------
// Chaque icône est une liste de tracés dans un carré de 24 x 24.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>',
  list: '<path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m21 16-4 4-4-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/>',
  cloudOff: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/><path d="M3 3l18 18"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3"/><path d="M20 20v-4h-4"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
};

// Renvoie le code SVG d'une icône : icon('trash')
function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
}

// Remplace chaque <span data-icon="..."> de la page par l'icône correspondante.
function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(function (el) {
    el.innerHTML = icon(el.dataset.icon);
  });
}

// L'utilisateur a-t-il demandé à son appareil de réduire les animations ?
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Petit message temporaire en bas de l'écran ("Enregistré", etc.).
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  // 3,5 secondes : assez pour lire, puis le message disparaît tout seul
  showToast.timer = setTimeout(function () { toast.hidden = true; }, 3500);
}
