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

  if (name === 'projection') renderProjection();
}

// Lit l'onglet dans l'adresse, ou revient à l'accueil s'il n'existe pas.
function viewFromHash() {
  const name = location.hash.replace('#', '');
  return document.querySelector('.view[data-view="' + name + '"]') ? name : 'home';
}

// ---------- Accueil ----------

// Une ligne "libellé ....... montant" : le total converti dans la devise principale
// (+ l'autre devise en petit), ou un montant par devise s'il n'y a aucun taux.
function moneyLines(label, totals, cssClass, sign) {
  const main = appData.settings.mainCurrency;
  const other = otherCurrency(main);
  const total = sumIn(totals, main);
  let values;

  if (total === null) {
    values = CURRENCIES.filter(function (cur) { return totals[cur] !== 0; })
      .map(function (cur) {
        return '<span class="' + cssClass + '">' + sign + formatMoney(totals[cur], cur) + '</span>';
      }).join('');
  } else if (total === 0) {
    values = '<span>—</span>';
  } else {
    const otherTotal = sumIn(totals, other);
    values = '<span class="' + cssClass + '">' + sign + formatMoney(total, main) + '</span>' +
      (otherTotal === null ? '' : '<span class="approx">≈ ' + formatMoney(otherTotal, other) + '</span>');
  }
  return '<div class="summary-row"><span>' + label + '</span>' +
    '<span class="summary-values">' + values + '</span></div>';
}

function renderHome() {
  // Solde actuel : total converti dans la devise principale, et l'autre devise en dessous.
  const balance = computeBalance();
  const main = appData.settings.mainCurrency;
  const other = otherCurrency(main);
  const totalMain = sumIn(balance, main);
  const mainEl = document.getElementById('balance-main');
  const secondaryEl = document.getElementById('balance-secondary');
  const hintEl = document.getElementById('balance-hint');

  if (totalMain !== null) {
    mainEl.textContent = formatMoney(totalMain, main);
    mainEl.classList.toggle('is-negative', totalMain < 0);
    const totalOther = sumIn(balance, other);
    secondaryEl.textContent = totalOther === null ? '' : '≈ ' + formatMoney(totalOther, other);
    const rate = getRate();
    hintEl.textContent = rate ? 'Taux utilisé : 1 € = ' + formatRate(rate.value) + ' MOP' : '';
    hintEl.hidden = !rate;
  } else {
    // Pas de taux : on ne peut pas tout additionner, on affiche chaque devise à part.
    mainEl.textContent = formatMoney(balance[main], main);
    mainEl.classList.toggle('is-negative', balance[main] < 0);
    secondaryEl.textContent = balance[other] !== 0 ? 'et ' + formatMoney(balance[other], other) : '';
    hintEl.textContent = 'Aucun taux de change : connecte-toi ou saisis un taux dans Réglages.';
    hintEl.hidden = false;
  }

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
  renderCurrencyToggle();
  renderHome();
  renderTransactionList();
  renderRateSettings();
  renderBudgetAlerts();
  renderBudget();
  renderSettings();
  updateConvertHint();
  // Le graphique ne se dessine bien que s'il est visible : on ne le calcule que sur l'onglet Projection.
  if (!document.getElementById('view-projection').hidden) renderProjection();
}

// ---------- Point d'entrée : exécuté une fois la page chargée ----------

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      showView(tab.dataset.target);
    });
  });

  // Boutons qui mènent à un autre onglet (ex. "+ Ajouter une opération").
  // Un seul écouteur sur toute la page : il marche aussi pour les boutons créés plus tard.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-goto]');
    if (button) showView(button.dataset.goto);
  });

  window.addEventListener('hashchange', function () {
    showView(viewFromHash());
  });

  initTransactionForm();
  initStartForm();
  initRateSettings();
  initCurrencyToggle();
  initProjection();
  initBudget();
  initSettings();
  initSync();
  renderAll();
  showView(viewFromHash());

  // Taux de change : on affiche d'abord le dernier connu, puis on le met à jour en arrière-plan.
  refreshRate(false);
});
