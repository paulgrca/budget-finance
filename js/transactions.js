// =========================================================
// Revenus et dépenses : calculs, formulaire et historique
// =========================================================

// ---------- Calculs ----------

// +montant pour un revenu, -montant pour une dépense.
function signedAmount(tx) {
  return tx.type === 'income' ? tx.amount : -tx.amount;
}

// Ajoute k mois à une date, en gardant le même jour du mois.
// Si ce jour n'existe pas, on prend le dernier jour du mois :
// "2026-01-31" + 1 mois -> "2026-02-28".
function addMonths(iso, k) {
  const parts = iso.split('-').map(Number);
  const monthIndex = parts[1] - 1 + k;             // peut dépasser 11 : on recalcule l'année
  const year = parts[0] + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(parts[2], daysInMonth);
  return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// Toutes les dates où une opération a lieu entre "from" et "to" (inclus).
// - ponctuelle : sa date, si elle est dans l'intervalle ;
// - mensuelle : le même jour chaque mois, depuis sa date de début
//   jusqu'à sa date de fin (ou sans fin).
// Les dates "AAAA-MM-JJ" se comparent directement comme du texte.
function occurrenceDates(tx, from, to) {
  if (!tx.recurring) {
    return tx.date >= from && tx.date <= to ? [tx.date] : [];
  }
  const end = tx.recurring.endDate && tx.recurring.endDate < to ? tx.recurring.endDate : to;
  const dates = [];
  for (let k = 0; k < 1200; k++) {   // 1200 mois = 100 ans : simple sécurité anti-boucle infinie
    const date = addMonths(tx.date, k);
    if (date > end) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

// Solde actuel, séparé par devise : { EUR: 1200, MOP: -350 }.
// = solde de départ + toutes les occurrences entre la date du solde de départ
//   et aujourd'hui (les plus anciennes sont déjà incluses dans le solde de départ).
// (La conversion en une seule devise se fait à l'affichage, voir sumIn.)
function computeBalance() {
  const totals = { EUR: 0, MOP: 0 };
  const start = appData.startingBalance;
  totals[start.currency] += start.amount;

  const today = todayISO();
  appData.transactions.forEach(function (tx) {
    const count = occurrenceDates(tx, start.date, today).length;
    totals[tx.currency] += signedAmount(tx) * count;
  });

  totals.EUR = roundCents(totals.EUR);
  totals.MOP = roundCents(totals.MOP);
  return totals;
}

// Revenus et dépenses d'un mois ("2026-10"), séparés par devise,
// en comptant aussi les opérations récurrentes de ce mois.
function computeMonthTotals(month) {
  const result = { income: { EUR: 0, MOP: 0 }, expense: { EUR: 0, MOP: 0 } };
  appData.transactions.forEach(function (tx) {
    const count = occurrenceDates(tx, month + '-01', month + '-31').length;
    if (count) {
      result[tx.type][tx.currency] = roundCents(result[tx.type][tx.currency] + tx.amount * count);
    }
  });
  return result;
}

// Total mensuel des opérations récurrentes encore actives, séparé par devise :
// { income: {EUR, MOP}, expense: {EUR, MOP} }.
function computeRecurringMonthly() {
  const today = todayISO();
  const result = { income: { EUR: 0, MOP: 0 }, expense: { EUR: 0, MOP: 0 } };
  appData.transactions.forEach(function (tx) {
    if (tx.recurring && !(tx.recurring.endDate && tx.recurring.endDate < today)) {
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

// Case "Tous les mois" : affiche la date de fin et renomme la date en "date de début".
function updateFormForRecurring() {
  const form = document.getElementById('tx-form');
  const isRecurring = form.elements.recurring.checked;
  document.getElementById('tx-end-field').hidden = !isRecurring;
  document.getElementById('tx-date-label').textContent = isRecurring ? 'Première fois le' : 'Date';
  // La date de fin ne peut pas être avant la date de début.
  form.elements.endDate.min = form.elements.date.value;
}

// Sous le champ montant : "≈ 9,09 €" pendant que tu tapes.
function updateConvertHint() {
  const form = document.getElementById('tx-form');
  const amount = Number(form.elements.amount.value);
  document.getElementById('tx-convert-hint').textContent =
    amount > 0 ? approxInOther(amount, form.elements.currency.value) : '';
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
  updateFormForRecurring();
  updateConvertHint();
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
  form.elements.recurring.checked = Boolean(tx.recurring);
  form.elements.endDate.value = (tx.recurring && tx.recurring.endDate) || '';
  document.getElementById('tx-form-title').textContent = "Modifier l'opération";
  document.getElementById('tx-submit').textContent = 'Enregistrer';
  document.getElementById('tx-cancel').hidden = false;
  updateFormForType();
  updateFormForRecurring();
  updateConvertHint();
  document.getElementById('tx-form-card').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
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
    date: form.elements.date.value,
    recurring: form.elements.recurring.checked
      ? { frequency: 'monthly', endDate: form.elements.endDate.value || null }
      : false
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
  form.elements.recurring.addEventListener('change', updateFormForRecurring);
  form.elements.date.addEventListener('change', updateFormForRecurring);
  form.elements.amount.addEventListener('input', updateConvertHint);
  form.elements.currency.forEach(function (radio) {
    radio.addEventListener('change', updateConvertHint);
  });
  document.getElementById('tx-cancel').addEventListener('click', resetTransactionForm);

  // Boutons modifier / supprimer : un seul écouteur par liste (récurrents et historique).
  ['tx-recurring-list', 'tx-list'].forEach(function (listId) {
    document.getElementById(listId).addEventListener('click', handleListClick);
  });
}

function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('[data-id]').dataset.id;

  if (button.dataset.action === 'edit') {
    startEditTransaction(id);
  } else if (button.dataset.action === 'delete') {
    const tx = appData.transactions.find(function (t) { return t.id === id; });
    const name = tx.label || tx.category || (tx.type === 'income' ? 'ce revenu' : 'cette dépense');
    let message = 'Supprimer « ' + name + ' » (' + formatMoney(tx.amount, tx.currency) + ') ?';
    if (tx.recurring) {
      message += '\n\nToutes ses occurrences, y compris les mois passés, disparaîtront du solde. ' +
        "Pour simplement l'arrêter, modifie-le plutôt et mets une date de fin.";
    }
    if (confirm(message)) {
      deleteTransaction(id);
      if (editingId === id) resetTransactionForm();
      showToast('Opération supprimée');
      renderAll();
    }
  }
}

// ---------- Historique ----------

// "le 5 de chaque mois" (le 29, 30 ou 31 : "ou le dernier jour du mois" si besoin)
function monthlyDayText(iso) {
  const day = Number(iso.slice(8, 10));
  return 'le ' + (day === 1 ? '1er' : day) + ' de chaque mois' + (day > 28 ? ' (ou le dernier jour)' : '');
}

function renderTransactionList() {
  const today = todayISO();
  const byDateDesc = function (a, b) { return b.date.localeCompare(a.date); }; // plus récentes en premier

  // --- Opérations récurrentes ---
  const recurring = appData.transactions.filter(function (tx) { return tx.recurring; }).sort(byDateDesc);
  document.getElementById('tx-recurring-card').hidden = recurring.length === 0;
  document.getElementById('tx-recurring-list').innerHTML = recurring.map(function (tx) {
    const end = tx.recurring.endDate;
    const meta = [tx.type === 'income' ? 'Revenu' : tx.category, monthlyDayText(tx.date)];
    meta.push((tx.date > today ? 'à partir du ' : 'depuis le ') + formatDate(tx.date));
    if (end) meta.push("jusqu'au " + formatDate(end));
    const count = occurrenceDates(tx, appData.startingBalance.date, today).length;
    if (count > 0) meta.push('compté ' + count + ' fois');

    let badge = '';
    if (tx.date > today) badge = '<span class="badge">à venir</span>';
    else if (end && end < today) badge = '<span class="badge">terminé</span>';

    return txItemHtml(tx, meta, badge);
  }).join('');

  const monthly = computeRecurringMonthly();
  document.getElementById('tx-recurring-summary').innerHTML =
    moneyLines('Revenus par mois', monthly.income, 'is-income', '+') +
    moneyLines('Dépenses par mois', monthly.expense, 'is-expense', '−');

  // --- Opérations ponctuelles ---
  const oneOff = appData.transactions.filter(function (tx) { return !tx.recurring; }).sort(byDateDesc);
  document.getElementById('tx-empty').hidden = oneOff.length > 0;
  document.getElementById('tx-list').innerHTML = oneOff.map(function (tx) {
    const meta = [tx.type === 'income' ? 'Revenu' : tx.category, formatDate(tx.date)];
    let badge = '';
    if (tx.date > today) {
      badge = '<span class="badge">à venir</span>';
    } else if (tx.date < appData.startingBalance.date) {
      badge = '<span class="badge" title="Antérieure au solde de départ, donc déjà incluse dedans">non comptée</span>';
    }
    return txItemHtml(tx, meta, badge);
  }).join('');
}

// Une ligne de liste : titre + infos à gauche, montant au milieu, boutons à droite.
function txItemHtml(tx, meta, badge) {
  const isIncome = tx.type === 'income';
  const title = tx.label || tx.category || (isIncome ? 'Revenu' : 'Dépense');
  // Inutile de répéter la catégorie si c'est déjà le titre ("Loyer · Loyer").
  meta = meta.filter(function (text) { return text && text !== title; });
  // Pastille de couleur : vert pour un revenu, couleur de la catégorie (comme le camembert) pour une dépense.
  const dotColor = isIncome ? 'var(--income)' : categoryColor(tx.category || 'Autre');
  return '<li class="tx-item tx-op" data-id="' + tx.id + '">' +
      '<span class="tx-dot" style="background:' + dotColor + '"></span>' +
      '<div class="tx-main">' +
        '<p class="tx-title">' + escapeHtml(title) + badge + '</p>' +
        '<p class="tx-meta">' + escapeHtml(meta.filter(Boolean).join(' · ')) + '</p>' +
      '</div>' +
      '<div class="tx-amounts">' +
        '<p class="tx-amount ' + (isIncome ? 'is-income' : 'is-expense') + '">' +
          (isIncome ? '+' : '−') + formatMoney(tx.amount, tx.currency) +
        '</p>' +
        '<p class="approx">' + approxInOther(tx.amount, tx.currency) + '</p>' +
      '</div>' +
      '<div class="tx-actions">' +
        '<button type="button" class="icon-btn" data-action="edit" aria-label="Modifier">' + icon('pencil') + '</button>' +
        '<button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer">' + icon('trash') + '</button>' +
      '</div>' +
    '</li>';
}
