// =========================================================
// Projection : combien j'aurai dans X mois + graphique
//
// Pour chaque mois à venir, on additionne :
//   - les opérations récurrentes (loyer, bourse...) ;
//   - les opérations ponctuelles déjà prévues (datées dans le futur) ;
//   - une estimation des "dépenses courantes" (courses, sorties...),
//     calculée sur tes dépenses ponctuelles passées, ou saisie à la main.
// Tout est converti dans la devise principale avec le taux actuel.
// =========================================================

let projectionChart = null; // le graphique Chart.js (on le recrée à chaque rafraîchissement)

// ---------- Petits outils sur les mois ("AAAA-MM") ----------

function shiftMonth(month, k) {
  return addMonths(month + '-01', k).slice(0, 7);
}

function lastDayOfMonth(month) {
  const parts = month.split('-').map(Number);
  return month + '-' + String(new Date(parts[0], parts[1], 0).getDate()).padStart(2, '0');
}

// "2026-10" -> "oct. 2026" (long = false) ou "octobre 2026" (long = true)
function monthLabel(month, long) {
  const parts = month.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, 1)
    .toLocaleDateString('fr-FR', { month: long ? 'long' : 'short', year: 'numeric' });
}

// "2026-10" -> "oct. 26" (pour le graphique et le tableau)
function shortMonthLabel(month) {
  const parts = month.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

// ---------- Calculs ----------

// Solde (par devise) à une date : solde de départ + toutes les occurrences jusqu'à cette date.
function totalsUntil(date) {
  const start = appData.startingBalance;
  const totals = { EUR: 0, MOP: 0 };
  totals[start.currency] += start.amount;
  appData.transactions.forEach(function (tx) {
    totals[tx.currency] += signedAmount(tx) * occurrenceDates(tx, start.date, date).length;
  });
  return totals;
}

// Total des dépenses ponctuelles (non récurrentes) entre deux dates, par devise.
function oneOffExpensesBetween(from, to) {
  const totals = { EUR: 0, MOP: 0 };
  appData.transactions.forEach(function (tx) {
    if (tx.type === 'expense' && !tx.recurring && tx.date >= from && tx.date <= to) {
      totals[tx.currency] += tx.amount;
    }
  });
  return totals;
}

// Estimation des dépenses courantes par mois, dans la devise principale.
// Renvoie { amount, text } (text explique d'où vient le chiffre), ou null sans taux.
function estimateMonthlySpending() {
  const main = appData.settings.mainCurrency;
  const manual = appData.settings.spendingEstimate;

  if (manual) {
    const amount = convert(manual.amount, manual.currency, main);
    if (amount === null) return null;
    return { amount: roundCents(amount), text: 'Montant saisi à la main.', manual: true };
  }

  // Automatique : moyenne des 3 derniers mois complets (après le solde de départ).
  const start = appData.startingBalance.date;
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const months = [];
  for (let k = 1; k <= 3; k++) {
    const m = shiftMonth(thisMonth, -k);
    if (m + '-01' >= start) months.push(m);
  }

  if (months.length > 0) {
    const from = months[months.length - 1] + '-01';
    const to = lastDayOfMonth(months[0]);
    const total = sumIn(oneOffExpensesBetween(from, to), main);
    if (total === null) return null;
    return {
      amount: roundCents(total / months.length),
      text: 'Moyenne de tes dépenses ponctuelles sur ' +
        (months.length === 1 ? 'le dernier mois complet' : 'les ' + months.length + ' derniers mois complets') + '.'
    };
  }

  // Pas encore de mois complet : on extrapole le mois en cours (au moins 7 jours de recul).
  const from = start > thisMonth + '-01' ? start : thisMonth + '-01';
  const days = Math.round((new Date(today) - new Date(from)) / 86400000) + 1;
  if (days >= 7) {
    const total = sumIn(oneOffExpensesBetween(from, today), main);
    if (total === null) return null;
    return {
      amount: roundCents(total / days * 30),
      text: 'Estimé sur tes ' + days + ' premiers jours (pas encore de mois complet).'
    };
  }
  return { amount: 0, text: "Pas encore assez d'historique : saisis une estimation à la main." };
}

// Calcule la projection mois par mois. Renvoie null s'il manque un taux de change.
function computeProjection(monthsAhead) {
  const main = appData.settings.mainCurrency;
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const estimate = estimateMonthlySpending();
  if (!estimate) return null;

  // Historique réel : solde à la fin de chaque mois passé (12 mois max).
  const history = [];
  for (let k = 12; k >= 1; k--) {
    const m = shiftMonth(thisMonth, -k);
    if (lastDayOfMonth(m) < appData.startingBalance.date) continue;
    const balance = sumIn(totalsUntil(lastDayOfMonth(m)), main);
    if (balance === null) return null;
    history.push({ month: m, balance: balance });
  }

  const todayBalance = sumIn(totalsUntil(today), main);
  if (todayBalance === null) return null;

  // Projection : de la fin du mois en cours jusqu'à "monthsAhead" mois plus tard.
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(lastDayOfMonth(thisMonth).slice(8, 10));
  const rows = [];
  let estimatedSoFar = 0;

  for (let i = 0; i <= monthsAhead; i++) {
    const m = shiftMonth(thisMonth, i);
    const totals = computeMonthTotals(m);
    const income = sumIn(totals.income, main);
    const expense = sumIn(totals.expense, main);
    if (income === null || expense === null) return null;

    // Mois en cours : seulement les jours restants ; mois suivants : le mois entier.
    const estimated = i === 0 ? estimate.amount * (daysInMonth - day) / daysInMonth : estimate.amount;
    estimatedSoFar += estimated;

    const balance = sumIn(totalsUntil(lastDayOfMonth(m)), main) - estimatedSoFar;
    rows.push({
      month: m,
      income: roundCents(income),
      expense: roundCents(expense + estimated),
      estimated: roundCents(estimated),
      balance: roundCents(balance)
    });
  }

  return { history: history, today: todayBalance, rows: rows, estimate: estimate, currency: main };
}

// ---------- Affichage ----------

function renderProjection() {
  const monthsAhead = appData.settings.projectionMonths;
  document.getElementById('proj-months').value = monthsAhead;
  document.getElementById('proj-months-value').textContent = monthsAhead + ' mois';

  const data = computeProjection(monthsAhead);
  const headline = document.getElementById('proj-headline');
  const tableBody = document.querySelector('#proj-table tbody');

  if (!data) {
    headline.innerHTML = '<p class="hint">Il faut un taux de change pour additionner euros et patacas : ' +
      'connecte-toi ou saisis un taux manuel dans Réglages.</p>';
    tableBody.innerHTML = '';
    document.getElementById('proj-est-info').textContent = '';
    destroyChart();
    return;
  }

  const cur = data.currency;
  const other = otherCurrency(cur);
  const last = data.rows[data.rows.length - 1];
  const firstNegative = data.rows.find(function (row) { return row.balance < 0; });
  const otherAmount = convert(last.balance, cur, other);

  // Phrase principale
  let html = '<p class="card-label">Fin ' + escapeHtml(monthLabel(last.month, true)) + ', tu devrais avoir</p>' +
    '<p class="balance-main' + (last.balance < 0 ? ' is-negative' : '') + '">' + formatMoney(last.balance, cur) + '</p>' +
    '<p class="balance-secondary">≈ ' + formatMoney(otherAmount, other) + '</p>';
  if (firstNegative) {
    html += '<p class="alert alert-danger">À ce rythme, ton solde passe sous zéro en ' +
      escapeHtml(monthLabel(firstNegative.month, true)) + '.</p>';
  } else {
    const diff = last.balance - data.today;
    html += '<p class="hint">' + (diff >= 0 ? 'Soit ' + formatMoney(diff, cur) + " de plus qu'aujourd'hui."
      : 'Soit ' + formatMoney(-diff, cur) + " de moins qu'aujourd'hui.") + '</p>';
  }
  headline.innerHTML = html;

  // Estimation des dépenses courantes
  document.getElementById('proj-est-info').innerHTML =
    '<strong>' + formatMoney(data.estimate.amount, cur) + ' / mois</strong> · ' + escapeHtml(data.estimate.text);
  document.getElementById('proj-est-reset').hidden = !data.estimate.manual;
  document.getElementById('proj-est-currency').textContent = cur;

  // Tableau mois par mois
  // (montants arrondis à l'unité pour tenir sur un écran de téléphone)
  tableBody.innerHTML = data.rows.map(function (row, i) {
    return '<tr' + (i === 0 ? ' class="is-current" title="Mois en cours"' : '') + '>' +
      '<th scope="row">' + escapeHtml(shortMonthLabel(row.month)) + '</th>' +
      '<td class="is-income">+' + formatMoneyRounded(row.income, cur) + '</td>' +
      '<td class="is-expense" title="dont ' + formatMoney(row.estimated, cur) + ' de dépenses courantes estimées">−' +
        formatMoneyRounded(row.expense, cur) + '</td>' +
      '<td class="' + (row.balance < 0 ? 'is-expense' : '') + '"><strong>' + formatMoneyRounded(row.balance, cur) + '</strong></td>' +
    '</tr>';
  }).join('');

  renderProjectionChart(data);
}

function destroyChart() {
  if (projectionChart) {
    projectionChart.destroy();
    projectionChart = null;
  }
}

// Courbe : solde réel (trait plein) jusqu'à aujourd'hui, puis projection (pointillés).
function renderProjectionChart(data) {
  const message = document.getElementById('proj-chart-msg');
  destroyChart();

  if (typeof Chart === 'undefined') {
    message.textContent = "Le graphique n'a pas pu se charger (pas de connexion Internet ?). Le tableau ci-dessous reste à jour.";
    message.hidden = false;
    return;
  }
  message.hidden = true;

  const labels = [];
  const real = [];
  const projected = [];

  data.history.forEach(function (h) {
    labels.push(shortMonthLabel(h.month));
    real.push(h.balance);
    projected.push(null);
  });
  labels.push('auj.');
  real.push(data.today);
  projected.push(data.today); // les deux courbes se rejoignent aujourd'hui
  data.rows.forEach(function (row) {
    labels.push(shortMonthLabel(row.month));
    real.push(null);
    projected.push(row.balance);
  });

  // Couleurs lues dans le CSS : un seul endroit à modifier pour changer le thème.
  const css = getComputedStyle(document.documentElement);
  const color = function (name) { return css.getPropertyValue(name).trim(); };
  const cur = data.currency;

  const datasets = [
    {
      label: 'Solde réel',
      data: real,
      borderColor: color('--primary'),
      backgroundColor: color('--primary'),
      borderWidth: 3,
      pointRadius: 3,
      tension: 0.25
    },
    {
      label: 'Projection',
      data: projected,
      borderColor: color('--primary'),
      backgroundColor: color('--primary'),
      borderDash: [6, 5],
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.25
    }
  ];

  // Ligne rouge à zéro, seulement si le solde passe en négatif.
  const all = real.concat(projected).filter(function (v) { return v !== null; });
  if (Math.min.apply(null, all) < 0) {
    datasets.push({
      label: 'Zéro',
      data: labels.map(function () { return 0; }),
      borderColor: color('--expense'),
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 0
    });
  }

  projectionChart = new Chart(document.getElementById('proj-chart'), {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: color('--text-muted'),
            usePointStyle: true,
            pointStyle: 'line',   // un simple trait dans la légende, plus discret qu'un carré plein
            boxWidth: 24,
            filter: function (item) { return item.text !== 'Zéro'; }
          }
        },
        tooltip: {
          filter: function (item) { return item.raw !== null && item.dataset.label !== 'Zéro'; },
          callbacks: {
            title: function (items) {
              const label = items[0].label;
              return label === 'auj.' ? "Aujourd'hui" : 'Fin ' + label;
            },
            label: function (ctx) { return ctx.dataset.label + ' : ' + formatMoney(ctx.raw, cur); }
          }
        }
      },
      scales: {
        x: { ticks: { color: color('--text-muted'), maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: {
          ticks: {
            color: color('--text-muted'),
            callback: function (value) {
              return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value) +
                (cur === 'EUR' ? ' €' : ' MOP');
            }
          },
          grid: { color: color('--border') }
        }
      }
    }
  });
}

// ---------- Réglages de la projection ----------

function initProjection() {
  const slider = document.getElementById('proj-months');
  slider.addEventListener('input', function () {
    appData.settings.projectionMonths = Number(slider.value);
    saveData();
    renderProjection();
  });

  const form = document.getElementById('proj-est-form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = form.elements.estimate.value;
    appData.settings.spendingEstimate = value === ''
      ? null
      : { amount: roundCents(Number(value)), currency: appData.settings.mainCurrency };
    saveData();
    form.reset();
    showToast('Estimation enregistrée');
    renderAll();
  });

  document.getElementById('proj-est-reset').addEventListener('click', function () {
    appData.settings.spendingEstimate = null;
    saveData();
    showToast('Estimation automatique');
    renderAll();
  });
}
