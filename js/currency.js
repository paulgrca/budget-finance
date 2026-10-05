// =========================================================
// Devises EUR / MOP : taux de change, conversion, affichage
//
// La pataca (MOP) est indexée sur le dollar de Hong Kong :
// 1 HKD = 1,03 MOP. On récupère donc le taux EUR -> HKD sur
// Internet et on le multiplie par 1,03 pour avoir EUR -> MOP.
// =========================================================

const CURRENCIES = ['EUR', 'MOP'];
const HKD_TO_MOP = 1.03;

// Sources du taux EUR -> HKD, essayées dans l'ordre (gratuites, sans clé).
const RATE_SOURCES = [
  {
    name: 'BCE (frankfurter.dev)',
    url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=HKD',
    read: function (json) { return { hkd: json.rates.HKD, date: json.date }; }
  },
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/EUR',
    read: function (json) {
      const d = new Date(json.time_last_update_unix * 1000);
      return { hkd: json.rates.HKD, date: d.toISOString().slice(0, 10) };
    }
  }
];

// 1234.5, "EUR" -> "1 234,50 €"   |   1234.5, "MOP" -> "1 234,50 MOP"
function formatMoney(amount, currency) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency }).format(amount);
}

// Version arrondie à l'unité, pour les tableaux serrés : "1 235 €"
function formatMoneyRounded(amount, currency) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount);
}

function otherCurrency(currency) {
  return currency === 'EUR' ? 'MOP' : 'EUR';
}

// Le taux utilisé en ce moment : { value: 9.09, source: 'auto' | 'manual', date }
// ou null si on n'a aucun taux (jamais connecté et pas de taux manuel).
function getRate() {
  const s = appData.settings;
  if (s.useManualRate && s.manualRate) {
    return { value: s.manualRate, source: 'manual', date: null };
  }
  if (s.lastRate) {
    return { value: s.lastRate.value, source: 'auto', date: s.lastRate.date };
  }
  if (s.manualRate) {
    return { value: s.manualRate, source: 'manual', date: null };
  }
  return null;
}

// Convertit un montant d'une devise à l'autre. Renvoie null sans taux.
function convert(amount, from, to) {
  if (from === to) return amount;
  const rate = getRate();
  if (!rate) return null;
  return from === 'EUR' ? amount * rate.value : amount / rate.value;
}

// Additionne des montants par devise ({ EUR: 10, MOP: 50 }) dans une seule devise.
// Renvoie null si une conversion est nécessaire mais impossible.
function sumIn(totals, currency) {
  let sum = 0;
  for (const cur of CURRENCIES) {
    if (!totals[cur]) continue;
    const converted = convert(totals[cur], cur, currency);
    if (converted === null) return null;
    sum += converted;
  }
  return roundCents(sum);
}

// "≈ 1 034,00 MOP" : le montant dans l'autre devise, ou '' sans taux.
function approxInOther(amount, currency) {
  const other = otherCurrency(currency);
  const converted = convert(amount, currency, other);
  return converted === null ? '' : '≈ ' + formatMoney(converted, other);
}

// ---------- Récupération du taux automatique ----------

let rateStatus = ''; // message affiché dans les réglages ("Taux mis à jour", "Hors ligne"...)

// Va chercher le taux sur Internet. Par défaut une seule fois par jour ;
// force = true pour le bouton "Actualiser".
async function refreshRate(force) {
  const last = appData.settings.lastRate;
  if (!force && last && last.fetchedOn === todayISO()) return;

  for (const source of RATE_SOURCES) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = source.read(await response.json());
      if (!(data.hkd > 0)) throw new Error('taux HKD absent');

      appData.settings.lastRate = {
        value: Math.round(data.hkd * HKD_TO_MOP * 10000) / 10000,
        hkd: data.hkd,
        date: data.date,          // date de publication du taux
        source: source.name,
        fetchedOn: todayISO()     // jour où on l'a récupéré
      };
      saveData();
      rateStatus = 'Taux mis à jour.';
      renderAll();
      return;
    } catch (e) {
      console.warn('Taux indisponible depuis', source.name, e);
    }
  }

  rateStatus = last
    ? 'Pas de connexion au service de taux : on garde le dernier taux connu.'
    : 'Pas de connexion au service de taux : saisis un taux manuel ci-dessous.';
  renderAll();
}

// ---------- Réglages : affichage et saisie du taux ----------

function renderRateSettings() {
  const rate = getRate();
  const s = appData.settings;
  const info = document.getElementById('rate-info');

  if (!rate) {
    info.innerHTML = '<strong>Aucun taux disponible.</strong> Les montants ne peuvent pas être convertis.';
  } else {
    let text = '<strong>1 € = ' + formatRate(rate.value) + ' MOP</strong><br>';
    if (rate.source === 'manual') {
      text += 'Taux manuel';
      if (s.useManualRate) text += ' (forcé)';
      else text += ' (aucun taux automatique pour l\'instant)';
    } else {
      text += '1 € = ' + formatRate(s.lastRate.hkd) + ' HKD × 1,03 · ' +
        escapeHtml(s.lastRate.source) + ', taux du ' + formatDate(s.lastRate.date);
      if (s.lastRate.fetchedOn !== todayISO()) text += ' (dernier taux connu)';
    }
    info.innerHTML = text;
  }

  document.getElementById('rate-status').textContent = rateStatus;
  document.getElementById('rate-status').hidden = !rateStatus;
}

// 9.0948 -> "9,0948"
function formatRate(value) {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
}

// Remplit le formulaire du taux manuel avec les valeurs enregistrées.
function fillRateForm() {
  const form = document.getElementById('rate-form');
  form.elements.manualRate.value = appData.settings.manualRate || '';
  form.elements.useManualRate.checked = appData.settings.useManualRate;
}

function initRateSettings() {
  const form = document.getElementById('rate-form');
  fillRateForm();

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = form.elements.manualRate.value ? Number(form.elements.manualRate.value) : null;

    // Garde-fou : on attend environ 9 MOP pour 1 €. Un nombre comme 0,11
    // veut sûrement dire qu'on a saisi le taux à l'envers (MOP -> EUR).
    if (value !== null && (value < 5 || value > 15) &&
        !confirm('1 € = ' + formatRate(value) + ' MOP ? Le taux habituel tourne autour de 9. Enregistrer quand même ?')) {
      return;
    }
    if (form.elements.useManualRate.checked && value === null) {
      alert('Saisis un taux manuel pour pouvoir le forcer.');
      return;
    }

    appData.settings.manualRate = value;
    appData.settings.useManualRate = form.elements.useManualRate.checked;
    saveData();
    showToast('Taux enregistré');
    renderAll();
  });

  document.getElementById('rate-refresh').addEventListener('click', function () {
    rateStatus = 'Mise à jour…';
    renderRateSettings();
    refreshRate(true);
  });
}

// ---------- Bouton EUR ⇄ MOP de l'en-tête ----------

function renderCurrencyToggle() {
  const main = appData.settings.mainCurrency;
  const button = document.getElementById('currency-toggle');
  button.innerHTML = '<span class="' + (main === 'EUR' ? 'is-current' : '') + '">€</span>' +
    '<span aria-hidden="true">⇄</span>' +
    '<span class="' + (main === 'MOP' ? 'is-current' : '') + '">MOP</span>';
  button.setAttribute('aria-label', 'Devise principale : ' + main + '. Changer pour ' + otherCurrency(main));
}

function initCurrencyToggle() {
  const button = document.getElementById('currency-toggle');
  button.disabled = false;
  button.addEventListener('click', function () {
    appData.settings.mainCurrency = otherCurrency(appData.settings.mainCurrency);
    saveData();
    renderAll();
  });
}
