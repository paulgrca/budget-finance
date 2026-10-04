// =========================================================
// Devises EUR / MOP
// (pour l'instant : uniquement l'affichage des montants ;
//  le taux de change et la conversion arrivent à l'étape 3)
// =========================================================

const CURRENCIES = ['EUR', 'MOP'];

// 1234.5, "EUR" -> "1 234,50 €"   |   1234.5, "MOP" -> "1 234,50 MOP"
function formatMoney(amount, currency) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency }).format(amount);
}
