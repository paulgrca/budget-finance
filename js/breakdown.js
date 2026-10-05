// =========================================================
// Répartition des dépenses par catégorie (camembert)
// Section repliable de l'onglet Budget : on choisit la période
// et on coche les catégories à afficher (Bouffe, Voyages, Sorties...).
// Toutes les dépenses comptent, ponctuelles comme récurrentes :
// seule la catégorie choisie à la saisie décide de la part du camembert.
// =========================================================

let breakdownChart = null;
const BREAKDOWN_UI_KEY = 'budgetMacao.ui.repartition'; // préférences d'affichage, propres à l'appareil

// Couleurs sobres et bien distinctes. Chaque catégorie garde toujours la même
// (selon sa place dans la liste des catégories) ; "Autre" est toujours en gris.
const CATEGORY_COLORS = ['#0f766e', '#4f6d9a', '#c08a2e', '#b5577a', '#6f8a3a', '#7c6aa8', '#3b8fb5', '#b9653b'];
const OTHER_COLOR = '#a1a1aa';

function categoryColor(cat) {
  if (cat === 'Autre') return OTHER_COLOR;
  const index = appData.settings.categories.filter(function (c) { return c !== 'Autre'; }).indexOf(cat);
  return CATEGORY_COLORS[(index === -1 ? 0 : index) % CATEGORY_COLORS.length];
}

// Préférences (période, catégories décochées, section ouverte) gardées dans ce navigateur.
// On retient les catégories DÉcochées : une nouvelle catégorie est donc cochée d'office.
function loadBreakdownUi() {
  const defaults = { period: 'month', excluded: [], open: false };
  try {
    const saved = JSON.parse(localStorage.getItem(BREAKDOWN_UI_KEY)) || {};
    const ui = Object.assign(defaults, saved);
    if (!Array.isArray(ui.excluded)) ui.excluded = [];
    return ui;
  } catch (e) {
    return defaults;
  }
}

function saveBreakdownUi(ui) {
  try { localStorage.setItem(BREAKDOWN_UI_KEY, JSON.stringify(ui)); } catch (e) { /* rien */ }
}

// Dates de début et de fin de la période choisie (jusqu'à aujourd'hui, jamais dans le futur).
function breakdownRange(period) {
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  if (period === 'lastMonth') {
    const m = shiftMonth(thisMonth, -1);
    return { from: m + '-01', to: lastDayOfMonth(m) };
  }
  if (period === '3months') return { from: shiftMonth(thisMonth, -2) + '-01', to: today };
  if (period === 'all') return { from: appData.startingBalance.date, to: today };
  return { from: thisMonth + '-01', to: today };
}

// Total dépensé par catégorie sur la période (catégories décochées exclues),
// dans la devise principale, du plus gros au plus petit. null s'il manque un taux de change.
function computeBreakdown(period, excluded) {
  const range = breakdownRange(period);
  const main = appData.settings.mainCurrency;
  const totals = {};

  appData.transactions.forEach(function (tx) {
    if (tx.type !== 'expense') return;
    const cat = tx.category || 'Autre';
    if (excluded.indexOf(cat) !== -1) return;
    const count = occurrenceDates(tx, range.from, range.to).length; // un loyer mensuel compte une fois par mois
    if (!count) return;
    if (!totals[cat]) totals[cat] = { EUR: 0, MOP: 0 };
    totals[cat][tx.currency] += tx.amount * count;
  });

  const rows = [];
  for (const cat in totals) {
    const amount = sumIn(totals[cat], main);
    if (amount === null) return null;
    if (amount > 0) rows.push({ category: cat, amount: roundCents(amount) });
  }
  rows.sort(function (a, b) { return b.amount - a.amount; });
  const total = rows.reduce(function (sum, r) { return sum + r.amount; }, 0);
  rows.forEach(function (r) { r.share = total ? r.amount / total : 0; });
  return { rows: rows, total: roundCents(total), currency: main };
}

// Une case à cocher par catégorie, avec sa couleur.
function renderCategoryChecks(ui) {
  document.getElementById('breakdown-cats').innerHTML = appData.settings.categories.map(function (cat) {
    const checked = ui.excluded.indexOf(cat) === -1;
    return '<label class="chip">' +
      '<input type="checkbox" value="' + escapeHtml(cat) + '"' + (checked ? ' checked' : '') + '>' +
      '<span><i class="chip-dot" style="background:' + categoryColor(cat) + '"></i>' + escapeHtml(cat) + '</span>' +
    '</label>';
  }).join('');
}

function renderBreakdown() {
  const details = document.getElementById('breakdown');
  if (!details.open) return; // section fermée : rien à dessiner

  const ui = loadBreakdownUi();
  document.getElementById('breakdown-period').value = ui.period;
  renderCategoryChecks(ui);

  const data = computeBreakdown(ui.period, ui.excluded);
  const list = document.getElementById('breakdown-list');
  const summary = document.getElementById('breakdown-summary');
  const wrap = document.getElementById('breakdown-chart-wrap');
  if (breakdownChart) { breakdownChart.destroy(); breakdownChart = null; }
  summary.classList.remove('empty-state');

  if (!data || data.rows.length === 0) {
    summary.classList.add('empty-state');
    summary.innerHTML = !data
      ? 'Il faut un taux de change pour additionner euros et patacas (voir Réglages).'
      : '<strong>Aucune dépense dans les catégories cochées sur cette période.</strong><br>' +
        'Coche d\'autres catégories, choisis une autre période, ou ajoute tes dépenses dans l\'onglet Opérations.';
    list.innerHTML = '';
    wrap.hidden = true;
    return;
  }

  const cur = data.currency;
  const top = data.rows[0];
  summary.innerHTML = 'Tu dépenses le plus en <strong>' + escapeHtml(top.category) + '</strong> : ' +
    Math.round(top.share * 100) + ' % de tes ' + formatMoney(data.total, cur) + ' de dépenses.';

  // Liste détaillée (c'est elle qui donne les chiffres exacts)
  list.innerHTML = data.rows.map(function (r) {
    return '<li class="breakdown-row">' +
      '<span class="breakdown-dot" style="background:' + categoryColor(r.category) + '"></span>' +
      '<span class="breakdown-name">' + escapeHtml(r.category) + '</span>' +
      '<span class="breakdown-share">' + Math.round(r.share * 100) + ' %</span>' +
      '<span class="breakdown-amount">' + formatMoney(r.amount, cur) + '</span>' +
    '</li>';
  }).join('');

  // Camembert
  if (typeof Chart === 'undefined') {
    wrap.hidden = true; // pas de graphique sans Internet : la liste suffit
    return;
  }
  wrap.hidden = false;
  breakdownChart = new Chart(document.getElementById('breakdown-chart'), {
    type: 'doughnut',
    data: {
      labels: data.rows.map(function (r) { return r.category; }),
      datasets: [{
        data: data.rows.map(function (r) { return r.amount; }),
        backgroundColor: data.rows.map(function (r) { return categoryColor(r.category); }),
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: false }, // la liste en dessous sert de légende
        tooltip: {
          callbacks: {
            label: function (ctx) {
              return ctx.label + ' : ' + formatMoney(ctx.raw, cur) + ' (' + Math.round(ctx.raw / data.total * 100) + ' %)';
            }
          }
        }
      }
    }
  });
}

function initBreakdown() {
  const details = document.getElementById('breakdown');
  details.open = loadBreakdownUi().open;

  // Ouvrir / fermer la section : on s'en souvient, et on dessine le camembert à l'ouverture.
  details.addEventListener('toggle', function () {
    const ui = loadBreakdownUi();
    ui.open = details.open;
    saveBreakdownUi(ui);
    renderBreakdown();
  });

  document.getElementById('breakdown-period').addEventListener('change', function (event) {
    const ui = loadBreakdownUi();
    ui.period = event.target.value;
    saveBreakdownUi(ui);
    renderBreakdown();
  });

  // Cocher / décocher une catégorie (un seul écouteur pour toutes les cases)
  document.getElementById('breakdown-cats').addEventListener('change', function (event) {
    const box = event.target;
    if (box.type !== 'checkbox') return;
    const ui = loadBreakdownUi();
    ui.excluded = ui.excluded.filter(function (c) { return c !== box.value; });
    if (!box.checked) ui.excluded.push(box.value);
    saveBreakdownUi(ui);
    renderBreakdown();
  });
}
