// =========================================================
// Réglages : catégories, sauvegarde (export / import JSON),
// remise à zéro
// =========================================================

const PROTECTED_CATEGORY = 'Autre';   // reçoit les dépenses des catégories supprimées
const BACKUP_REMINDER_DAYS = 14;      // rappel de sauvegarde au bout de 14 jours

// Après un import ou une remise à zéro : on remet tous les formulaires d'accord avec les données.
function refreshAfterDataReplaced() {
  fillCategoryOptions();
  resetTransactionForm();
  fillStartForm();
  fillRateForm();
  budgetFormDirty = false;
  renderAll();
}

// ---------- Catégories ----------

function categoryUsage(cat) {
  return appData.transactions.filter(function (tx) { return tx.category === cat; }).length;
}

function renderCategories() {
  document.getElementById('category-list').innerHTML = appData.settings.categories.map(function (cat) {
    const used = categoryUsage(cat);
    const removable = cat !== PROTECTED_CATEGORY;
    return '<li class="tx-item" data-category="' + escapeHtml(cat) + '">' +
      '<div class="tx-main"><p class="tx-title">' + escapeHtml(cat) + '</p>' +
      '<p class="tx-meta">' + (used ? used + ' opération' + (used > 1 ? 's' : '') : 'pas encore utilisée') + '</p></div>' +
      (removable
        ? '<div class="tx-actions"><button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer ' + escapeHtml(cat) + '">' + icon('trash') + '</button></div>'
        : '<span class="badge" title="Reçoit les dépenses des catégories supprimées">par défaut</span>') +
    '</li>';
  }).join('');
}

function addCategory(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return 'Donne un nom à la catégorie.';
  const exists = appData.settings.categories.some(function (c) { return c.toLowerCase() === clean.toLowerCase(); });
  if (exists) return 'Cette catégorie existe déjà.';
  // On l'insère juste avant "Autre", qui reste en dernier.
  const list = appData.settings.categories;
  const otherIndex = list.indexOf(PROTECTED_CATEGORY);
  list.splice(otherIndex === -1 ? list.length : otherIndex, 0, clean);
  saveData();
  return null;
}

function deleteCategory(cat) {
  const used = categoryUsage(cat);
  let message = 'Supprimer la catégorie « ' + cat + ' » ?';
  if (used) message += '\n\nSes ' + used + ' opération(s) passeront dans « ' + PROTECTED_CATEGORY + ' ».';
  if (appData.budgets.byCategory[cat]) message += '\nSa limite de budget sera supprimée.';
  if (!confirm(message)) return false;

  appData.transactions.forEach(function (tx) {
    if (tx.category === cat) tx.category = PROTECTED_CATEGORY;
  });
  if (appData.settings.categories.indexOf(PROTECTED_CATEGORY) === -1) {
    appData.settings.categories.push(PROTECTED_CATEGORY);
  }
  appData.settings.categories = appData.settings.categories.filter(function (c) { return c !== cat; });
  delete appData.budgets.byCategory[cat];
  saveData();
  return true;
}

// ---------- Sauvegarde : export ----------

function exportData() {
  const today = todayISO();
  appData.settings.lastExport = today;
  saveData();

  // On ajoute deux infos pour reconnaître le fichier à l'import.
  const backup = Object.assign({ app: 'budget-macao', exportedAt: new Date().toISOString() }, appData);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Astuce classique : un lien invisible avec l'attribut "download", sur lequel on clique.
  const link = document.createElement('a');
  link.href = url;
  link.download = 'budget-macao-' + today + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

  showToast('Sauvegarde téléchargée');
  renderAll();
}

// ---------- Sauvegarde : import ----------

// Vérifie qu'un fichier ressemble bien à une sauvegarde. Renvoie un message d'erreur, ou null si tout va bien.
function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return "Ce fichier n'est pas une sauvegarde Budget Macao.";
  if (!Array.isArray(data.transactions)) return "Ce fichier n'est pas une sauvegarde Budget Macao (pas de liste d'opérations).";
  if (!data.settings || !data.startingBalance) return 'Sauvegarde incomplète (réglages ou solde de départ manquants).';

  const isDate = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); };
  const isCurrency = function (v) { return CURRENCIES.indexOf(v) !== -1; };

  if (!isDate(data.startingBalance.date) || !isCurrency(data.startingBalance.currency) ||
      typeof data.startingBalance.amount !== 'number') {
    return 'Le solde de départ du fichier est invalide.';
  }
  for (let i = 0; i < data.transactions.length; i++) {
    const tx = data.transactions[i];
    const ok = tx && typeof tx.id === 'string' &&
      (tx.type === 'income' || tx.type === 'expense') &&
      typeof tx.amount === 'number' && tx.amount > 0 &&
      isCurrency(tx.currency) && isDate(tx.date) &&
      (!tx.recurring || (tx.recurring.frequency === 'monthly' && (!tx.recurring.endDate || isDate(tx.recurring.endDate))));
    if (!ok) return "L'opération n° " + (i + 1) + ' du fichier est invalide.';
  }
  if (!Array.isArray(data.settings.categories)) return 'La liste des catégories du fichier est invalide.';
  return null;
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = function () {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      alert("Impossible de lire ce fichier : ce n'est pas du JSON valide.");
      return;
    }
    const error = validateBackup(data);
    if (error) {
      alert(error);
      return;
    }

    const when = data.exportedAt ? ' (sauvegarde du ' + formatDate(data.exportedAt.slice(0, 10)) + ')' : '';
    const ok = confirm('Remplacer tes données actuelles (' + appData.transactions.length + ' opérations) ' +
      'par celles du fichier' + when + ' : ' + data.transactions.length + ' opérations ?\n\n' +
      'Tes données actuelles seront perdues si tu ne les as pas exportées.' +
      (syncUser ? '\nTu es connecté : tous tes appareils recevront ces données.' : ''));
    if (!ok) return;

    appData = withDefaults(data);
    // Les dépenses dont la catégorie n'existe plus vont dans "Autre".
    if (appData.settings.categories.indexOf(PROTECTED_CATEGORY) === -1) appData.settings.categories.push(PROTECTED_CATEGORY);
    appData.transactions.forEach(function (tx) {
      if (tx.type === 'expense' && appData.settings.categories.indexOf(tx.category) === -1) tx.category = PROTECTED_CATEGORY;
    });
    appData.settings.lastExport = data.exportedAt ? data.exportedAt.slice(0, 10) : appData.settings.lastExport;
    saveData();
    refreshAfterDataReplaced();
    showToast('Sauvegarde importée');
  };
  reader.onerror = function () { alert('Impossible de lire ce fichier.'); };
  reader.readAsText(file);
}

// ---------- Remise à zéro ----------

function resetAllData() {
  const answer = prompt('Tout effacer : opérations, budgets et réglages. Impossible à annuler !\n' +
    (syncUser ? 'Tu es connecté : les données seront aussi effacées dans le cloud et sur TOUS tes appareils.\n' : '') +
    'Pense à exporter une sauvegarde avant.\n\nTape EFFACER pour confirmer :');
  if (answer === null) return;
  if (answer.trim().toUpperCase() !== 'EFFACER') {
    alert('Rien n\'a été effacé (il fallait taper EFFACER).');
    return;
  }
  appData = createDefaultData();
  saveData();
  refreshAfterDataReplaced();
  showView('home');
  showToast('Toutes les données ont été effacées');
}

// ---------- Affichage ----------

// Nombre de jours depuis une date "AAAA-MM-JJ".
function daysSince(iso) {
  return Math.round((new Date(todayISO()) - new Date(iso)) / 86400000);
}

function renderBackupInfo() {
  const last = appData.settings.lastExport;
  document.getElementById('backup-info').textContent = last
    ? 'Dernière sauvegarde : ' + formatDate(last) + (daysSince(last) === 0 ? " (aujourd'hui)" : ' (il y a ' + daysSince(last) + ' j)')
    : 'Aucune sauvegarde pour l\'instant.';

  // Rappel sur l'accueil s'il y a des données et pas de sauvegarde récente.
  const needed = appData.transactions.length > 0 && (!last || daysSince(last) >= BACKUP_REMINDER_DAYS);
  document.getElementById('home-backup').hidden = !needed;
}

// Guide de démarrage sur l'accueil tant que l'appli est vide.
function renderOnboarding() {
  const empty = appData.transactions.length === 0 && appData.startingBalance.amount === 0;
  document.getElementById('home-start').hidden = !empty;
}

function renderSettings() {
  renderCategories();
  renderBackupInfo();
  renderOnboarding();
}

// ---------- Saisie ----------

function initSettings() {
  document.getElementById('category-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const input = event.target.elements.name;
    const error = addCategory(input.value);
    if (error) {
      alert(error);
      return;
    }
    input.value = '';
    fillCategoryOptions();
    showToast('Catégorie ajoutée');
    renderAll();
  });

  document.getElementById('category-list').addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action="delete"]');
    if (!button) return;
    const cat = button.closest('[data-category]').dataset.category;
    if (deleteCategory(cat)) {
      fillCategoryOptions();
      budgetFormDirty = false;
      showToast('Catégorie supprimée');
      renderAll();
    }
  });

  document.getElementById('export-btn').addEventListener('click', exportData);

  // Le vrai champ fichier est caché : le bouton "Importer" clique dessus.
  const fileInput = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) importFile(fileInput.files[0]);
    fileInput.value = ''; // pour pouvoir réimporter le même fichier
  });

  document.getElementById('reset-btn').addEventListener('click', resetAllData);
}
