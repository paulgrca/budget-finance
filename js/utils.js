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

// Petit message temporaire en bas de l'écran ("Enregistré", etc.).
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function () { toast.hidden = true; }, 2200);
}
