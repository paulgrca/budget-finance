// =========================================================
// Budget Macao — démarrage de l'application et navigation
// =========================================================

// ---------- Navigation entre onglets ----------

// Affiche l'onglet demandé ("home", "transactions"...) et cache les autres.
function showView(name) {
  document.querySelectorAll('.view').forEach(function (view) {
    const active = view.dataset.view === name;
    view.hidden = !active;
    view.classList.toggle('is-active', active);
  });

  document.querySelectorAll('.tab').forEach(function (tab) {
    const active = tab.dataset.target === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // On garde l'onglet dans l'adresse (#projection...) : un rechargement
  // de la page ou le bouton "retour" restent sur le bon onglet.
  if (location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
  window.scrollTo(0, 0);
}

// Lit l'onglet dans l'adresse, ou revient à l'accueil s'il n'existe pas.
function viewFromHash() {
  const name = location.hash.replace('#', '');
  return document.querySelector('.view[data-view="' + name + '"]') ? name : 'home';
}

// ---------- Accueil ----------

// Une ligne "libellé ....... montant" pour chaque devise utilisée.
function moneyLines(label, totals, cssClass, sign) {
  const lines = CURRENCIES.filter(function (cur) { return totals[cur] !== 0; })
    .map(function (cur) {
      return '<span class="' + cssClass + '">' + sign + formatMoney(totals[cur], cur) + '</span>';
    });
  return '<div class="summary-row"><span>' + label + '</span>' +
    '<span class="summary-values">' + (lines.length ? lines.join('') : '<span>—</span>') + '</span></div>';
}

function renderHome() {
  // Solde actuel : pour l'instant un montant par devise (conversion à l'étape 3).
  const balance = computeBalance();
  const main = appData.settings.mainCurrency;
  const other = main === 'EUR' ? 'MOP' : 'EUR';
  const mainEl = document.getElementById('balance-main');
  mainEl.textContent = formatMoney(balance[main], main);
  mainEl.classList.toggle('is-negative', balance[main] < 0);
  document.getElementById('balance-secondary').textContent =
    balance[other] !== 0 ? 'et ' + formatMoney(balance[other], other) : '';
  document.getElementById('balance-hint').hidden = balance[other] === 0;

  // Résumé du mois en cours.
  const month = todayISO().slice(0, 7);
  const totals = computeMonthTotals(month);
  const parts = month.split('-').map(Number);
  const monthName = new Date(parts[0], parts[1] - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  document.getElementById('month-title').textContent = 'Ce mois-ci (' + monthName + ')';
  document.getElementById('month-summary').innerHTML =
    moneyLines('Revenus', totals.income, 'is-income', '+') +
    moneyLines('Dépenses', totals.expense, 'is-expense', '−');
}

// ---------- Réglages : solde de départ ----------

function fillStartForm() {
  const form = document.getElementById('start-form');
  const start = appData.startingBalance;
  form.elements.amount.value = start.amount;
  form.elements.currency.value = start.currency;
  form.elements.date.value = start.date;
}

function initStartForm() {
  const form = document.getElementById('start-form');
  fillStartForm();
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    appData.startingBalance = {
      amount: roundCents(Number(form.elements.amount.value)),
      currency: form.elements.currency.value,
      date: form.elements.date.value
    };
    saveData();
    showToast('Solde de départ enregistré');
    renderAll();
  });
}

// ---------- Rafraîchissement ----------

// Redessine tout ce qui dépend des données. Appelée après chaque modification.
function renderAll() {
  renderHome();
  renderTransactionList();
}

// ---------- Point d'entrée : exécuté une fois la page chargée ----------

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      showView(tab.dataset.target);
    });
  });

  // Boutons qui mènent à un autre onglet (ex. "+ Ajouter une opération").
  document.querySelectorAll('[data-goto]').forEach(function (button) {
    button.addEventListener('click', function () {
      showView(button.dataset.goto);
    });
  });

  window.addEventListener('hashchange', function () {
    showView(viewFromHash());
  });

  initTransactionForm();
  initStartForm();
  renderAll();
  showView(viewFromHash());
});
