// =========================================================
// Budget Macao — démarrage de l'application et navigation
// =========================================================

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

// Point d'entrée : exécuté une fois la page chargée.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      showView(tab.dataset.target);
    });
  });

  window.addEventListener('hashchange', function () {
    showView(viewFromHash());
  });

  showView(viewFromHash());
});
