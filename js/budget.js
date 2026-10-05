// =========================================================
// Budget : limites mensuelles, alertes 80 % / 100 %,
// et comparaison dépenses réelles / budget prévu
//
// Données (appData.budgets) :
//   global     : { amount, currency } ou null   -> limite globale par défaut
//   byCategory : { "Bouffe": { amount, currency }, ... }
//   months     : { "2026-12": { amount, currency } } -> limite globale
//                 différente pour un mois précis (ex. mois de voyage)
// Toutes les dépenses comptent : ponctuelles et récurrentes (loyer inclus).
// =========================================================

const WARNING_THRESHOLD = 0.8; // alerte orange à 80 %
const DANGER_THRESHOLD = 1;    // alerte rouge à 100 %

// ---------- Calculs ----------

// Limite globale d'un mois : celle du mois précis si elle existe, sinon celle par défaut.
function globalLimitFor(month) {
  return appData.budgets.months[month] || appData.budgets.global;
}

// Dépenses d'un mois, par devise : au total et par catégorie.
function monthExpenses(month) {
  const result = { total: { EUR: 0, MOP: 0 }, byCategory: {} };
  appData.transactions.forEach(function (tx) {
    if (tx.type !== 'expense') return;
    const count = occurrenceDates(tx, month + '-01', month + '-31').length;
    if (!count) return;
    const cat = tx.category || 'Autre';
    if (!result.byCategory[cat]) result.byCategory[cat] = { EUR: 0, MOP: 0 };
    result.total[tx.currency] += tx.amount * count;
    result.byCategory[cat][tx.currency] += tx.amount * count;
  });
  return result;
}

// Niveau d'alerte selon le pourcentage utilisé.
function budgetLevel(ratio) {
  if (ratio >= DANGER_THRESHOLD) return 'danger';
  if (ratio >= WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

// État de chaque limite pour un mois : [{ key, label, limit, spent, ratio, level }]
// "spent" est converti dans la devise de la limite (null s'il manque un taux).
function computeBudgetStatus(month) {
  const expenses = monthExpenses(month);
  const status = [];

  function add(key, label, limit, spentTotals) {
    const spent = sumIn(spentTotals || { EUR: 0, MOP: 0 }, limit.currency);
    const ratio = spent === null ? null : spent / limit.amount;
    status.push({
      key: key, label: label, limit: limit, spent: spent, ratio: ratio,
      level: ratio === null ? 'ok' : budgetLevel(ratio)
    });
  }

  const global = globalLimitFor(month);
  if (global) add('global', 'Budget global', global, expenses.total);

  appData.settings.categories.forEach(function (cat) {
    const limit = appData.budgets.byCategory[cat];
    if (limit) add(cat, cat, limit, expenses.byCategory[cat]);
  });
  return status;
}

// Estimation des dépenses du mois en cours à la fin du mois, au rythme actuel :
// récurrentes du mois + ponctuelles déjà prévues + ponctuelles passées extrapolées.
function paceEstimate(currency) {
  const today = todayISO();
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(lastDayOfMonth(month).slice(8, 10));
  const fixed = { EUR: 0, MOP: 0 };
  const soFar = { EUR: 0, MOP: 0 };

  appData.transactions.forEach(function (tx) {
    if (tx.type !== 'expense') return;
    if (tx.recurring) {
      fixed[tx.currency] += tx.amount * occurrenceDates(tx, month + '-01', month + '-31').length;
    } else if (tx.date.slice(0, 7) === month) {
      if (tx.date > today) fixed[tx.currency] += tx.amount;  // déjà prévue : comptée telle quelle
      else soFar[tx.currency] += tx.amount;                  // passée : on extrapole le rythme
    }
  });

  const fixedSum = sumIn(fixed, currency);
  const soFarSum = sumIn(soFar, currency);
  if (fixedSum === null || soFarSum === null) return null;
  return roundCents(fixedSum + soFarSum / day * daysInMonth);
}

// ---------- Affichage : onglet Budget ----------

function progressHtml(item) {
  const cur = item.limit.currency;
  if (item.spent === null) {
    return '<div class="progress-item"><div class="progress-head"><span>' + escapeHtml(item.label) + '</span>' +
      '<span class="hint">taux de change manquant</span></div></div>';
  }
  const percent = Math.round(item.ratio * 100);
  const remaining = item.limit.amount - item.spent;
  return '<div class="progress-item level-' + item.level + '">' +
    '<div class="progress-head">' +
      '<span class="progress-label">' + escapeHtml(item.label) + '</span>' +
      '<span class="progress-values">' + formatMoney(item.spent, cur) + ' / ' + formatMoney(item.limit.amount, cur) + '</span>' +
    '</div>' +
    '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(percent, 100) + '"' +
      ' aria-label="' + escapeHtml(item.label) + ' : ' + percent + ' %">' +
      '<span style="width:' + Math.min(percent, 100) + '%"></span>' +
    '</div>' +
    '<p class="progress-foot">' + percent + ' % · ' +
      (remaining >= 0 ? 'reste ' + formatMoney(remaining, cur) : 'dépassé de ' + formatMoney(-remaining, cur)) +
    '</p>' +
  '</div>';
}

function renderBudget() {
  const month = todayISO().slice(0, 7);
  const status = computeBudgetStatus(month);
  const container = document.getElementById('budget-progress');
  document.getElementById('budget-month-title').textContent = 'Ce mois-ci (' + monthLabel(month, true) + ')';

  if (status.length === 0) {
    container.innerHTML = '<p class="placeholder">Aucune limite pour l\'instant : fixe-les ci-dessous.</p>';
  } else {
    let html = status.map(progressHtml).join('');
    // "À ce rythme..." pour le budget global
    const global = status.find(function (s) { return s.key === 'global'; });
    if (global && global.spent !== null) {
      const pace = paceEstimate(global.limit.currency);
      if (pace !== null && todayISO().slice(8, 10) !== lastDayOfMonth(month).slice(8, 10)) {
        const over = pace > global.limit.amount;
        html += '<p class="' + (over ? 'alert alert-warning' : 'hint') + '">' +
          (over ? '⚠️ ' : '') + 'À ce rythme, tu auras dépensé environ ' + formatMoney(pace, global.limit.currency) +
          ' à la fin du mois' + (over ? ', soit plus que ton budget.' : '.') + '</p>';
      }
    }
    container.innerHTML = html;
  }

  renderBudgetForm();
  renderMonthOverrides();
  renderBudgetHistory();
}

let budgetFormDirty = false; // true pendant que tu modifies les limites (sans avoir enregistré)

// Formulaire des limites par défaut : une ligne "Global" + une ligne par catégorie.
function renderBudgetForm() {
  // On ne redessine pas le formulaire pendant que tu tapes (sinon ta saisie serait effacée).
  if (budgetFormDirty) return;
  const rows = [{ key: '__global', label: 'Budget global (toutes dépenses)', limit: appData.budgets.global }]
    .concat(appData.settings.categories.map(function (cat) {
      return { key: cat, label: cat, limit: appData.budgets.byCategory[cat] };
    }));
  const defaultCurrency = appData.settings.mainCurrency;

  document.getElementById('budget-limits').innerHTML = rows.map(function (row, i) {
    const cur = row.limit ? row.limit.currency : defaultCurrency;
    const id = 'limit-' + i;
    return '<div class="limit-row' + (i === 0 ? ' limit-row-global' : '') + '" data-key="' + escapeHtml(row.key) + '">' +
      '<label for="' + id + '">' + escapeHtml(row.label) + '</label>' +
      '<input id="' + id + '" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="aucune" value="' +
        (row.limit ? row.limit.amount : '') + '">' +
      '<select aria-label="Devise">' +
        CURRENCIES.map(function (c) {
          return '<option value="' + c + '"' + (c === cur ? ' selected' : '') + '>' + c + '</option>';
        }).join('') +
      '</select>' +
    '</div>';
  }).join('');
}

// Liste des budgets de mois précis + choix des mois dans le formulaire.
function renderMonthOverrides() {
  const months = Object.keys(appData.budgets.months).sort();
  document.getElementById('override-empty').hidden = months.length > 0;
  document.getElementById('override-list').innerHTML = months.map(function (m) {
    const limit = appData.budgets.months[m];
    return '<li class="tx-item" data-month="' + m + '">' +
      '<div class="tx-main"><p class="tx-title">' + escapeHtml(monthLabel(m, true)) + '</p></div>' +
      '<p class="tx-amount">' + formatMoney(limit.amount, limit.currency) + '</p>' +
      '<div class="tx-actions"><button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer">🗑️</button></div>' +
    '</li>';
  }).join('');

  const select = document.getElementById('override-month');
  const selected = select.value;
  const thisMonth = todayISO().slice(0, 7);
  let options = '';
  for (let k = 0; k < 12; k++) {
    const m = shiftMonth(thisMonth, k);
    options += '<option value="' + m + '">' + escapeHtml(monthLabel(m, true)) + '</option>';
  }
  select.innerHTML = options;
  if (selected) select.value = selected;
  document.getElementById('override-currency').value =
    appData.budgets.global ? appData.budgets.global.currency : appData.settings.mainCurrency;
}

// Réel vs prévu : budget global et dépenses réelles des 6 derniers mois (mois en cours inclus).
function renderBudgetHistory() {
  const thisMonth = todayISO().slice(0, 7);
  const startMonth = appData.startingBalance.date.slice(0, 7);
  const rows = [];
  for (let k = 5; k >= 0; k--) {
    const m = shiftMonth(thisMonth, -k);
    if (m < startMonth) continue;
    const limit = globalLimitFor(m);
    const cur = limit ? limit.currency : appData.settings.mainCurrency;
    const spent = sumIn(monthExpenses(m).total, cur);
    rows.push({ month: m, limit: limit, cur: cur, spent: spent });
  }

  document.querySelector('#budget-history tbody').innerHTML = rows.map(function (row) {
    const current = row.month === thisMonth;
    let diffCell = '<td>—</td>';
    if (row.limit && row.spent !== null) {
      const diff = row.limit.amount - row.spent;
      diffCell = '<td class="' + (diff >= 0 ? 'is-income' : 'is-expense') + '"><strong>' +
        (diff >= 0 ? '+' : '−') + formatMoneyRounded(Math.abs(diff), row.cur) + '</strong></td>';
    }
    return '<tr' + (current ? ' class="is-current" title="Mois en cours"' : '') + '>' +
      '<th scope="row">' + escapeHtml(shortMonthLabel(row.month)) + '</th>' +
      '<td>' + (row.limit ? formatMoneyRounded(row.limit.amount, row.cur) : '—') + '</td>' +
      '<td>' + (row.spent === null ? '?' : formatMoneyRounded(row.spent, row.cur)) + '</td>' +
      diffCell +
    '</tr>';
  }).join('');
}

// ---------- Affichage : alertes sur l'accueil ----------

function renderBudgetAlerts() {
  const status = computeBudgetStatus(todayISO().slice(0, 7));
  const container = document.getElementById('home-alerts');
  const alerts = status.filter(function (s) { return s.level !== 'ok'; })
    .sort(function (a, b) { return b.ratio - a.ratio; });

  // Pastille sur l'onglet Budget quand il y a une alerte
  const dot = document.getElementById('budget-dot');
  dot.hidden = alerts.length === 0;
  dot.className = 'tab-dot' + (alerts.some(function (a) { return a.level === 'danger'; }) ? ' is-danger' : '');

  if (status.length === 0) {
    container.innerHTML = '<p class="placeholder">Aucune limite définie.</p>' +
      '<button type="button" class="btn btn-ghost btn-block" data-goto="budget">Fixer mes limites</button>';
    return;
  }

  if (alerts.length === 0) {
    const global = status.find(function (s) { return s.key === 'global'; });
    container.innerHTML = '<p class="alert alert-ok">✅ Tout va bien' +
      (global && global.ratio !== null ? ' : ' + Math.round(global.ratio * 100) + ' % du budget global utilisé.' : '.') + '</p>';
    return;
  }

  container.innerHTML = alerts.map(function (a) {
    const percent = Math.round(a.ratio * 100);
    const text = a.level === 'danger'
      ? '🚨 <strong>' + escapeHtml(a.label) + '</strong> : budget dépassé (' + percent + ' %, ' +
        formatMoney(a.spent, a.limit.currency) + ' / ' + formatMoney(a.limit.amount, a.limit.currency) + ')'
      : '⚠️ <strong>' + escapeHtml(a.label) + '</strong> : ' + percent + ' % du budget utilisé (reste ' +
        formatMoney(a.limit.amount - a.spent, a.limit.currency) + ')';
    return '<p class="alert alert-' + a.level + '">' + text + '</p>';
  }).join('');
}

// ---------- Saisie ----------

function initBudget() {
  document.getElementById('budget-form').addEventListener('input', function () {
    budgetFormDirty = true;
  });

  // Enregistrer les limites par défaut
  document.getElementById('budget-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const byCategory = {};
    let global = null;
    document.querySelectorAll('#budget-limits .limit-row').forEach(function (row) {
      const value = row.querySelector('input').value;
      if (value === '') return;
      const limit = { amount: roundCents(Number(value)), currency: row.querySelector('select').value };
      if (row.dataset.key === '__global') global = limit;
      else byCategory[row.dataset.key] = limit;
    });
    appData.budgets.global = global;
    appData.budgets.byCategory = byCategory;
    budgetFormDirty = false;
    saveData();
    showToast('Limites enregistrées');
    renderAll();
  });

  // Ajouter / remplacer le budget d'un mois précis
  document.getElementById('override-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) return;
    appData.budgets.months[form.elements.month.value] = {
      amount: roundCents(Number(form.elements.amount.value)),
      currency: form.elements.currency.value
    };
    saveData();
    form.elements.amount.value = '';
    showToast('Budget du mois enregistré');
    renderAll();
  });

  document.getElementById('override-list').addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action="delete"]');
    if (!button) return;
    const month = button.closest('[data-month]').dataset.month;
    delete appData.budgets.months[month];
    saveData();
    showToast('Budget du mois supprimé');
    renderAll();
  });
}
