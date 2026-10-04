// =========================================================
// Sauvegarde des données dans le navigateur (localStorage)
//
// localStorage ne sait stocker que du texte : on transforme donc
// toutes les données en texte JSON pour les enregistrer, et on fait
// l'inverse au chargement.
// =========================================================

const STORAGE_KEY = 'budgetMacao.v1';

const DEFAULT_CATEGORIES = ['Loyer', 'Bouffe', 'Sorties', 'Voyages', 'Transport', 'Études', 'Autre'];

// Données d'un tout nouvel utilisateur.
function createDefaultData() {
  return {
    version: 1,
    settings: {
      mainCurrency: 'EUR',      // devise affichée en grand (bouton EUR ⇄ MOP, étape 3)
      lastCurrency: 'MOP',      // dernière devise choisie dans le formulaire
      manualRate: null,         // taux saisi à la main (étape 3)
      useManualRate: false,
      lastRate: null,           // dernier taux automatique obtenu (étape 3)
      categories: DEFAULT_CATEGORIES.slice()
    },
    // "J'avais tant d'argent à telle date" : point de départ du solde.
    startingBalance: { amount: 0, currency: 'EUR', date: todayISO() },
    transactions: [],
    budgets: { global: null, byCategory: {} } // étape 6
  };
}

// Complète des données chargées avec les valeurs par défaut manquantes
// (utile quand on ajoutera de nouveaux réglages dans les prochaines étapes).
function withDefaults(data) {
  const defaults = createDefaultData();
  return {
    version: 1,
    settings: Object.assign({}, defaults.settings, data.settings),
    startingBalance: Object.assign({}, defaults.startingBalance, data.startingBalance),
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    budgets: Object.assign({}, defaults.budgets, data.budgets)
  };
}

// Lit les données enregistrées, ou crée des données vides la première fois.
function loadData() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn('localStorage indisponible :', e);
  }
  if (!raw) return createDefaultData();

  try {
    return withDefaults(JSON.parse(raw));
  } catch (e) {
    // Données illisibles : on les met de côté au lieu de les écraser.
    console.error('Données illisibles, copie gardée sous', STORAGE_KEY + '.corrompu', e);
    try { localStorage.setItem(STORAGE_KEY + '.corrompu', raw); } catch (ignored) { /* rien */ }
    return createDefaultData();
  }
}

// Enregistre toutes les données. Appelée après chaque modification.
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    return true;
  } catch (e) {
    console.error('Échec de la sauvegarde :', e);
    alert("Impossible d'enregistrer dans ce navigateur (navigation privée ?). " +
          'Tes modifications seront perdues en fermant la page.');
    return false;
  }
}

// Toutes les données de l'appli, chargées une seule fois au démarrage.
let appData = loadData();
