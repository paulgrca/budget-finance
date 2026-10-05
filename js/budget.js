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

// Rythme de dépense du mois en cours pour une limite (category = null pour le budget global).
//
// On sépare deux sortes de dépenses :
//  - les "fixes" : récurrentes du mois (loyer...) + ponctuelles déjà prévues plus tard ce mois-ci.
//    Elles sont réservées d'office dans le budget, même si elles ne sont pas encore passées ;
//  - les "courantes" : dépenses ponctuelles déjà faites (courses, sorties...). C'est sur elles
//    qu'on calcule le rythme par jour (sinon le loyer, payé en un jour, fausserait la moyenne).
//
// Renvoie tout dans la devise de la limite (null s'il manque un taux de change) :
//  dailyAverage    : dépensé en moyenne par jour (dépenses courantes)
//  dailyAllowance  : ce que le budget permet par jour pour les dépenses courantes
//  overPerDay      : dailyAverage - dailyAllowance (positif = tu dépasses chaque jour)
//  remaining       : ce que tu peux encore dépenser ce mois-ci
//  perDayToStay    : à ne pas dépasser par jour d'ici la fin du mois pour tenir le budget
//  exceedInDays    : dans combien de jours le budget sera dépassé à ce rythme
//                    (0 = déjà dépassé, null = tu tiens jusqu'à la fin du mois)
//  projectedTotal  : dépenses prévues à la fin du mois à ce rythme
function computePace(limit, category) {
  const today = todayISO();
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(lastDayOfMonth(month).slice(8, 10));
  // Premier jour compté : le 1er du mois, ou la date du solde de départ si elle est plus récente.
  const start = appData.startingBalance.date;
  const firstDay = start.slice(0, 7) === month ? Number(start.slice(8, 10)) : 1;
  const daysElapsed = Math.max(1, day - firstDay + 1);      // aujourd'hui inclus
  const daysInPeriod = Math.max(1, daysInMonth - firstDay + 1);
  const daysLeft = daysInMonth - day;                        // jours restants après aujourd'hui

  const fixed = { EUR: 0, MOP: 0 };
  const soFar = { EUR: 0, MOP: 0 };
  appData.transactions.forEach(function (tx) {
    if (tx.type !== 'expense') return;
    if (category && (tx.category || 'Autre') !== category) return;
    if (tx.recurring) {
      fixed[tx.currency] += tx.amount * occurrenceDates(tx, month + '-01', month + '-31').length;
    } else if (tx.date.slice(0, 7) === month) {
      if (tx.date > today) fixed[tx.currency] += tx.amount;  // déjà prévue : réservée telle quelle
      else soFar[tx.currency] += tx.amount;                  // déjà faite : sert à calculer le rythme
    }
  });

  const fixedSum = sumIn(fixed, limit.currency);
  const soFarSum = sumIn(soFar, limit.currency);
  if (fixedSum === null || soFarSum === null) return null;

  const dailyAverage = soFarSum / daysElapsed;
  const dailyAllowance = (limit.amount - fixedSum) / daysInPeriod;
  const remaining = limit.amount - fixedSum - soFarSum;

  // Dans combien de jours on dépasse : on "dépense" dailyAverage chaque jour sur ce qui reste.
  // Ex. : reste 100 €, 30 €/jour -> 90 € en 3 jours, dépassement le 4e jour.
  let exceedInDays = null;
  if (remaining < 0) exceedInDays = 0;
  else if (dailyAverage > 0) {
    const days = Math.floor(remaining / dailyAverage) + 1;
    if (days <= daysLeft) exceedInDays = days;
  }

  return {
    dailyAverage: roundCents(dailyAverage),
    dailyAllowance: roundCents(dailyAllowance),
    overPerDay: roundCents(dailyAverage - dailyAllowance),
    remaining: roundCents(remaining),
    perDayToStay: daysLeft > 0 ? roundCents(remaining / daysLeft) : null,
    exceedInDays: exceedInDays,
    projectedTotal: roundCents(fixedSum + soFarSum + dailyAverage * daysLeft),
    fixed: roundCents(fixedSum),
    daysLeft: daysLeft
  };
}

// "dans 4 jours (vers le 9 oct.)"
function exceedText(days) {
  const parts = todayISO().split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return 'dans ' + days + ' jour' + (days > 1 ? 's' : '') +
    ' (vers le ' + date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ')';
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

  // Pour une catégorie : "dépassée dans 4 jours" si le rythme actuel mène au dépassement.
  let paceNote = '';
  if (item.key !== 'global' && remaining >= 0) {
    const pace = computePace(item.limit, item.key);
    if (pace && pace.exceedInDays) paceNote = ' · dépassée ' + exceedText(pace.exceedInDays) + ' à ce rythme';
  }

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
      paceNote +
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
    container.innerHTML = status.map(progressHtml).join('');
  }

  renderPace();
  renderBudgetForm();
  renderMonthOverrides();
  renderBudgetHistory();
}

// Bloc "Rythme du mois" (budget global) : par jour, dépassement, jours restants.
function renderPace() {
  const card = document.getElementById('budget-pace-card');
  const limit = globalLimitFor(todayISO().slice(0, 7));
  const pace = limit ? computePace(limit, null) : null;
  card.hidden = !pace;
  if (!pace) return;

  const cur = limit.currency;
  const row = function (label, value, cssClass) {
    return '<div class="summary-row"><span>' + label + '</span>' +
      '<span class="summary-values"><span class="' + (cssClass || '') + '">' + value + '</span></span></div>';
  };

  let html =
    row('Tu dépenses en moyenne', formatMoney(pace.dailyAverage, cur) + ' / jour') +
    row('Ton budget permet', formatMoney(Math.max(pace.dailyAllowance, 0), cur) + ' / jour');

  // Dépassement (ou marge) par jour
  if (pace.overPerDay > 0) {
    html += '<p class="alert alert-warning">Tu dépasses ton budget de <strong>' +
      formatMoney(pace.overPerDay, cur) + ' par jour</strong>.</p>';
  } else {
    html += '<p class="alert alert-ok">Tu es sous ton budget de <strong>' +
      formatMoney(-pace.overPerDay, cur) + ' par jour</strong>.</p>';
  }

  // Combien de temps avant de dépasser
  if (pace.exceedInDays === 0) {
    html += '<p class="alert alert-danger"><strong>Budget déjà dépassé</strong> de ' +
      formatMoney(-pace.remaining, cur) + ' ce mois-ci.</p>';
  } else if (pace.exceedInDays) {
    html += '<p class="alert alert-danger">À ce rythme, ton budget sera <strong>dépassé ' +
      exceedText(pace.exceedInDays) + '</strong>.</p>';
  } else if (pace.daysLeft > 0) {
    html += '<p class="alert alert-ok">À ce rythme, tu <strong>tiens jusqu\'à la fin du mois</strong>, ' +
      'avec environ ' + formatMoney(limit.amount - pace.projectedTotal, cur) + ' de marge.</p>';
  }

  // Conseil pour tenir
  if (pace.perDayToStay !== null && pace.remaining > 0) {
    html += '<p class="hint pace-tip">Pour rester dans ton budget : au maximum <strong>' +
      formatMoney(pace.perDayToStay, cur) + ' par jour</strong> pendant les ' + pace.daysLeft +
      ' jours restants. Fin de mois prévue à ce rythme : ' + formatMoney(pace.projectedTotal, cur) +
      ' sur ' + formatMoney(limit.amount, cur) + '.</p>';
  }
  if (pace.fixed > 0) {
    html += '<p class="hint">Les dépenses fixes du mois (' + formatMoney(pace.fixed, cur) +
      ', loyer compris) sont déjà réservées : la moyenne par jour ne compte que tes dépenses courantes.</p>';
  }

  document.getElementById('budget-pace').innerHTML = html;
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
      '<div class="tx-actions"><button type="button" class="icon-btn" data-action="delete" aria-label="Supprimer">' + icon('trash') + '</button></div>' +
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

  // Avertissement de rythme : le budget global sera dépassé avant la fin du mois.
  const global = status.find(function (s) { return s.key === 'global'; });
  const pace = global ? computePace(global.limit, null) : null;
  const paceAlert = pace && pace.exceedInDays
    ? '<p class="alert alert-warning">À ce rythme, <strong>budget global dépassé ' + exceedText(pace.exceedInDays) +
      '</strong> : tu dépenses ' + formatMoney(pace.overPerDay, global.limit.currency) + ' de trop par jour.' +
      '<button type="button" class="link-btn" data-goto="budget">Voir le détail</button></p>'
    : '';

  if (alerts.length === 0) {
    container.innerHTML = paceAlert || ('<p class="alert alert-ok">Tout va bien' +
      (global && global.ratio !== null ? ' : ' + Math.round(global.ratio * 100) + ' % du budget global utilisé.' : '.') + '</p>');
    return;
  }

  container.innerHTML = paceAlert + alerts.map(function (a) {
    const percent = Math.round(a.ratio * 100);
    const text = a.level === 'danger'
      ? '<strong>' + escapeHtml(a.label) + '</strong> : budget dépassé (' + percent + ' %, ' +
        formatMoney(a.spent, a.limit.currency) + ' / ' + formatMoney(a.limit.amount, a.limit.currency) + ')'
      : '<strong>' + escapeHtml(a.label) + '</strong> : ' + percent + ' % du budget utilisé (reste ' +
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
