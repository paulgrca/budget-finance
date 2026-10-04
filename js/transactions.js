// =========================================================
// Revenus et dépenses : calculs, formulaire et historique
// =========================================================

// ---------- Calculs ----------

// Une opération compte dans le solde si elle a déjà eu lieu (pas dans le futur)
// et si elle date d'après le solde de départ (sinon elle y est déjà incluse).
function isCounted(tx) {
  return tx.date <= todayISO() && tx.date >= appData.startingBalance.date;
}

// +montant pour un revenu, -montant pour une dépense.
function signedAmount(tx) {
  return tx.type === 'income' ? tx.amount : -tx.amount;
}

// Solde actuel, séparé par devise : { EUR: 1200, MOP: -350 }.
// (Le total converti en une seule devise arrive à l'étape 3.)
function computeBalance() {
  const totals = { EUR: 0, MOP: 0 };
  const start = appData.startingBalance;
  totals[start.currency] += start.amount;

  appData.transactions.forEach(function (tx) {
    if (isCounted(tx)) totals[tx.currency] += signedAmount(tx);
  });

  totals.EUR = roundCents(totals.EUR);
  totals.MOP = roundCents(totals.MOP);
  return totals;
}

// Revenus et dépenses d'un mois ("2026-10"), séparés par devise.
function computeMonthTotals(month) {
  const result = { income: { EUR: 0, MOP: 0 }, expense: { EUR: 0, MOP: 0 } };
  appData.transactions.forEach(function (tx) {
    if (tx.date.slice(0, 7) === month) {
      result[tx.type][tx.currency] = roundCents(result[tx.type][tx.currency] + tx.amount);
    }
  });
  return result;
}

// ---------- Modifications ----------

function addTransaction(fields) {
  const tx = Object.assign({ id: makeId(), recurring: false }, fields);
  appData.transactions.push(tx);
  saveData();
}

function updateTransaction(id, fields) {
  const tx = appData.transactions.find(function (t) { return t.id === id; });
  if (!tx) return;
  Object.assign(tx, fields);
  saveData();
}

function deleteTransaction(id) {
  appData.transactions = appData.transactions.filter(function (t) { return t.id !== id; });
  saveData();
}

// ---------- Formulaire d'ajout / modification ----------

let editingId = null; // id de l'opération en cours de modification, sinon null

function fillCategoryOptions() {
  const select = document.getElementById('tx-category');
  select.innerHTML = appData.settings.categories.map(function (cat) {
    return '<option value="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</option>';
  }).join('');
}

// Affiche le choix de catégorie seulement pour les dépenses.
function updateFormForType() {
  const form = document.getElementById('tx-form');
  const isExpense = form.elements.type.value === 'expense';
  document.getElementById('tx-category-field').hidden = !isExpense;
  document.getElementById('tx-label').placeholder = isExpense
    ? 'ex. Courses au supermarché'
    : 'ex. Bourse, virement parents, job';
}

// Remet le formulaire à zéro (en gardant la dernière devise utilisée).
function resetTransactionForm() {
  const form = document.getElementById('tx-form');
  form.reset();
  editingId = null;
  form.elements.currency.value = appData.settings.lastCurrency;
  form.elements.date.value = todayISO();
  document.getElementById('tx-form-title').textContent = 'Ajouter une opération';
  document.getElementById('tx-submit').textContent = 'Ajouter';
  document.getElementById('tx-cancel').hidden = true;
  updateFormForType();
}

// Remplit le formulaire avec une opération existante pour la modifier.
function startEditTransaction(id) {
  const tx = appData.transactions.find(function (t) { return t.id === id; });
  if (!tx) return;
  const form = document.getElementById('tx-form');
  editingId = id;
  form.elements.type.value = tx.type;
  form.elements.amount.value = tx.amount;
  form.elements.currency.value = tx.currency;
  if (tx.category) form.elements.category.value = tx.category;
  form.elements.label.value = tx.label;
  form.elements.date.value = tx.date;
  document.getElementById('tx-form-title').textContent = "Modifier l'opération";
  document.getElementById('tx-submit').textContent = 'Enregistrer';
  document.getElementById('tx-cancel').hidden = false;
  updateFormForType();
  document.getElementById('tx-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.amount.focus({ preventScroll: true });
}

function handleTransactionSubmit(event) {
  event.preventDefault(); // empêche le rechargement de la page
  const form = event.target;
  if (!form.reportValidity()) return; // le navigateur affiche les champs à corriger

  const type = form.elements.type.value;
  const fields = {
    type: type,
    amount: roundCents(Number(form.elements.amount.value)),
    currency: form.elements.currency.value,
    category: type === 'expense' ? form.elements.category.value : null,
    label: form.elements.label.value.trim(),
    date: form.elements.date.value
  };

  if (editingId) {
    updateTransaction(editingId, fields);
    showToast('Opération modifiée');
  } else {
    addTransaction(fields);
    showToast(type === 'income' ? 'Revenu ajouté' : 'Dépense ajoutée');
  }

  appData.settings.lastCurrency = fields.currency;
  saveData();
  resetTransactionForm();
  renderAll();
}

function initTransactionForm() {
  const form = document.getElementById('tx-form');
  fillCategoryOptions();
  resetTransactionForm();

  form.addEventListener('submit', handleTransactionSubmit);
  form.elements.type.forEach(function (radio) {
    radio.addEventListener('change', updateFormForType);
  });
  document.getElementById('tx-cancel').addEventListener('click', resetTransactionForm);

  // Boutons ✏️ et 🗑️ de l'historique : un seul écouteur pour toute la liste.
  document.getElementById('tx-list').addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;

    if (button.dataset.action === 'edit') {
      startEditTransaction(id);
    } else if (button.dataset.action === 'delete') {
      const tx = appData.transactions.find(function (t) { return t.id === id; });
      const name = tx.label || tx.category || (tx.type === 'income' ? 'ce revenu' : 'cette dépense');
      if (confirm('Supprimer « ' + name + ' » (' + formatMoney(tx.amount, tx.currency) + ') ?')) {
        deleteTransaction(id);
        if (editingId === id) resetTransactionForm();
        showToast('Opération supprimée');
        renderAll();
      }
    }
  });
}

// ---------- Historique ----------

function renderTransactionList() {
  const list = document.getElementById('tx-list');
  const sorted = appData.transactions.slice().sort(function (a, b) {
    return b.date.localeCompare(a.date); // plus récentes en premier
  });

  document.getElementById('tx-empty').hidden = sorted.length > 0;

  const today = todayISO();
  list.innerHTML = sorted.map(function (tx) {
    const isIncome = tx.type === 'income';
    const title = tx.label || tx.category || (isIncome ? 'Revenu' : 'Dépense');
    const meta = [isIncome ? 'Revenu' : tx.category, formatDate(tx.date)];

    let badge = '';
    if (tx.date > today) {
      badge = '<span class="badge">à venir</span>';
    } else if (tx.date < appData.startingBalance.date) {
      badge = '<span class="badge" title="Antérieure au solde de départ, donc déjà incluse dedans">non comptée</span>';
    }

    return '<li class="tx-item" data-id="' + tx.id + '">' +
      '<div class="tx-main">' +
        '<p class="tx-title">' + escapeHtml(title) + badge + '</p>' +
        '<p class="tx-meta">' + escapeHtml(meta.filter(Boolean).join(' · ')) + '</p>' +
      '</div>' +
      '<p class="tx-amount ' + (isIncome ? 'is-income' : 'is-expense') + '">' +
        (isIncome ? '+' : '−') + formatMoney(tx.amount, tx.currency) +
      '</p>' +
      '<div class="tx-actions">' +
        '<button type="button" class="icon-btn" data-action="edit" aria-label="Modifier">✏️</button>' +
        '<button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer">🗑️</button>' +
      '</div>' +
    '</li>';
  }).join('');
}
