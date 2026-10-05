// =========================================================
// Synchronisation entre appareils (Firebase)
//
// Principe :
// - chaque appareil garde ses données dans localStorage (comme avant) ;
// - une fois connecté avec Google, une copie est envoyée dans le cloud
//   (Firestore), dans un document "users/<ton identifiant>" ;
// - chaque version envoyée porte un numéro (rev). Avant d'envoyer, on vérifie
//   que le cloud est toujours à la version qu'on connaît : on n'écrase
//   jamais une modification faite sur un autre appareil ;
// - les autres appareils connectés reçoivent les changements en direct.
// =========================================================

const SYNC_META_KEY = 'budgetMacao.sync';          // où cet appareil retient l'état de la synchro
const SYNC_BACKUP_KEY = 'budgetMacao.avant-synchro'; // copie de secours en cas de conflit
// Réglages propres à chaque appareil : on ne les synchronise pas.
const LOCAL_ONLY_SETTINGS = ['lastRate', 'lastCurrency', 'lastExport'];

let syncState = 'off';     // off | signed-out | syncing | synced | offline | error
let syncError = '';
let syncUser = null;       // utilisateur Google connecté
let syncDb = null;         // base Firestore
let syncDocRef = null;     // document "users/<uid>"
let syncMeta = {};         // { uid, syncedRev, syncedPayload } : dernière version commune avec le cloud
let syncReady = false;     // true après la première comparaison avec le cloud
let syncUnsubscribe = null;
let syncPushTimer = null;
let applyingRemote = false;
let syncQueue = Promise.resolve(); // les opérations de synchro passent une par une

// ---------- Petits outils ----------

function loadSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; } catch (e) { return {}; }
}

function saveSyncMeta() {
  try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta)); } catch (e) { /* rien */ }
}

// Les données à envoyer : tout, sauf les réglages propres à l'appareil.
function syncPayload(data) {
  const copy = JSON.parse(JSON.stringify(data));
  LOCAL_ONLY_SETTINGS.forEach(function (key) { delete copy.settings[key]; });
  return JSON.stringify(copy);
}

function isDataEmpty(data) {
  return data.transactions.length === 0 && data.startingBalance.amount === 0 &&
    !data.budgets.global && Object.keys(data.budgets.byCategory).length === 0;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'un appareil';
}

// Met une opération de synchro dans la file d'attente (jamais deux en même temps).
function enqueueSync(task) {
  syncQueue = syncQueue.then(task).catch(handleSyncError);
  return syncQueue;
}

function setSyncState(state, error) {
  syncState = state;
  syncError = error || '';
  renderSync();
}

function handleSyncError(e) {
  console.warn('Synchronisation :', e);
  if (!navigator.onLine || (e && e.code === 'unavailable')) {
    setSyncState('offline');
  } else if (e && e.code === 'permission-denied') {
    setSyncState('error', 'Accès refusé par Firebase (vérifie les règles de sécurité Firestore).');
  } else {
    setSyncState('error', (e && e.message) || String(e));
  }
}

// ---------- Décision : que faire en comparant cet appareil et le cloud ? ----------

// meta : dernière version commune connue ; localPayload : données de cet appareil ;
// remote : { rev, payload } ou null si le cloud est vide.
// Renvoie : 'push' (envoyer), 'pull' (récupérer), 'mark' (déjà identiques),
//           'none' (rien à faire) ou 'ask' (les deux ont changé : demander).
function decideSync(meta, localPayload, remote, localIsEmpty) {
  const known = meta.syncedRev !== undefined && meta.syncedRev !== null;
  const changedHere = !known || localPayload !== meta.syncedPayload;

  if (!remote) return 'push';                         // cloud vide : on y met nos données
  if (remote.payload === localPayload) return 'mark'; // déjà pareils
  if (!known) return localIsEmpty ? 'pull' : 'ask';   // premier passage sur cet appareil
  if (remote.rev === meta.syncedRev) return changedHere ? 'push' : 'none';
  return changedHere ? 'ask' : 'pull';                // le cloud a changé depuis la dernière fois
}

// ---------- Actions ----------

// Remplace les données de cet appareil par celles du cloud.
function applyRemote(remote) {
  const keep = {};
  LOCAL_ONLY_SETTINGS.forEach(function (key) { keep[key] = appData.settings[key]; });

  appData = withDefaults(JSON.parse(remote.payload));
  Object.assign(appData.settings, keep);

  applyingRemote = true; // cette sauvegarde vient du cloud : pas besoin de la renvoyer
  saveData();
  applyingRemote = false;

  syncMeta.syncedRev = remote.rev;
  syncMeta.syncedPayload = remote.payload;
  saveSyncMeta();
  refreshFromRemote();
}

// Redessine l'appli sans effacer un formulaire en cours de saisie.
function refreshFromRemote() {
  const select = document.getElementById('tx-category');
  const chosen = select.value;
  fillCategoryOptions();
  if (appData.settings.categories.indexOf(chosen) !== -1) select.value = chosen;
  if (!document.getElementById('start-form').contains(document.activeElement)) fillStartForm();
  if (!document.getElementById('rate-form').contains(document.activeElement)) fillRateForm();
  renderAll();
}

// Envoie les données de cet appareil, seulement si le cloud est encore à la version "expectedRev".
async function pushLocal(expectedRev) {
  const payload = syncPayload(appData);
  setSyncState('syncing');
  let conflict = false;

  const newRev = await syncDb.runTransaction(async function (t) {
    const snap = await t.get(syncDocRef);
    const remoteRev = snap.exists ? snap.data().rev : 0;
    if (remoteRev !== expectedRev) {
      conflict = true; // quelqu'un a écrit entre-temps
      return null;
    }
    t.set(syncDocRef, {
      payload: payload,
      rev: remoteRev + 1,
      device: deviceLabel(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return remoteRev + 1;
  });

  if (conflict) {
    await reconcile(); // on relit le cloud et on décide à nouveau
    return;
  }
  syncMeta.syncedRev = newRev;
  syncMeta.syncedPayload = payload;
  saveSyncMeta();
  setSyncState('synced');
}

// Les deux côtés ont changé : on demande quelle version garder, et on met l'autre de côté.
async function askWhichVersion(remote) {
  const cloud = JSON.parse(remote.payload);
  const when = remote.updatedAt ? ' le ' + remote.updatedAt.toDate().toLocaleString('fr-FR') : '';
  const useCloud = confirm(
    'Tes données sont différentes ici et dans le cloud.\n\n' +
    '• Cloud : ' + cloud.transactions.length + ' opérations (modifié' + when + ' depuis ' + (remote.device || 'un autre appareil') + ')\n' +
    '• Cet appareil : ' + appData.transactions.length + ' opérations\n\n' +
    'OK = garder la version du CLOUD\n' +
    'Annuler = garder la version de CET APPAREIL\n\n' +
    "(L'autre version est gardée en copie de secours sur cet appareil.)"
  );
  try {
    localStorage.setItem(SYNC_BACKUP_KEY, useCloud ? JSON.stringify(appData) : remote.payload);
  } catch (e) { /* rien */ }

  if (useCloud) {
    applyRemote(remote);
    setSyncState('synced');
  } else {
    await pushLocal(remote.rev);
  }
}

// Compare avec le cloud et fait ce qu'il faut. remote = données déjà reçues (sinon on les lit).
async function reconcile(remoteData) {
  if (!syncDocRef) return;
  setSyncState('syncing');

  let remote = remoteData;
  if (remote === undefined) {
    const snap = await syncDocRef.get({ source: 'server' });
    remote = snap.exists ? snap.data() : null;
  }

  const localPayload = syncPayload(appData);
  const action = decideSync(syncMeta, localPayload, remote, isDataEmpty(appData));

  if (action === 'push') {
    // On attend le cloud à la version qu'on vient de lire (0 s'il est vide).
    await pushLocal(remote ? remote.rev : 0);
  } else if (action === 'pull') {
    applyRemote(remote);
    setSyncState('synced');
  } else if (action === 'mark') {
    syncMeta.syncedRev = remote.rev;
    syncMeta.syncedPayload = remote.payload;
    saveSyncMeta();
    setSyncState('synced');
  } else if (action === 'ask') {
    await askWhichVersion(remote);
  } else {
    setSyncState('synced');
  }

  if (!syncReady) {
    syncReady = true;
    listenToCloud();
  }
}

// Écoute le cloud : les modifications faites sur un autre appareil arrivent en direct.
function listenToCloud() {
  if (syncUnsubscribe) syncUnsubscribe();
  syncUnsubscribe = syncDocRef.onSnapshot(function (snap) {
    if (!snap.exists) return;
    const remote = snap.data();
    if (remote.rev === syncMeta.syncedRev) return; // c'est notre propre version
    enqueueSync(function () { return reconcile(remote); });
  }, handleSyncError);
}

// Appelée après chaque sauvegarde locale (voir saveData dans storage.js).
function onLocalDataSaved() {
  if (applyingRemote || !syncUser) return;
  if (!syncReady) return; // la première comparaison avec le cloud s'en chargera
  clearTimeout(syncPushTimer);
  // On attend un peu : plusieurs modifications rapprochées partent en un seul envoi.
  syncPushTimer = setTimeout(flushPush, 1500);
}

function flushPush() {
  clearTimeout(syncPushTimer);
  syncPushTimer = null;
  enqueueSync(function () {
    if (syncPayload(appData) === syncMeta.syncedPayload) return setSyncState('synced');
    return pushLocal(syncMeta.syncedRev || 0);
  });
}

// ---------- Connexion ----------

async function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await firebase.auth().signInWithRedirect(provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      alert('Connexion impossible : ' + e.message);
    }
  }
}

function signOut() {
  if (!confirm('Te déconnecter ? Tes données restent sur cet appareil, mais ne seront plus synchronisées.')) return;
  firebase.auth().signOut();
}

function startSync(user) {
  syncUser = user;
  syncMeta = loadSyncMeta();
  if (syncMeta.uid !== user.uid) syncMeta = { uid: user.uid }; // autre compte : on repart de zéro
  saveSyncMeta();
  syncDocRef = syncDb.collection('users').doc(user.uid);
  syncReady = false;
  setSyncState('syncing');
  enqueueSync(function () { return reconcile(); });
}

function stopSync() {
  if (syncUnsubscribe) syncUnsubscribe();
  syncUnsubscribe = null;
  syncUser = null;
  syncDocRef = null;
  syncReady = false;
  setSyncState('signed-out');
}

// ---------- Affichage ----------

function renderSync() {
  const pill = document.getElementById('sync-pill');
  const card = document.getElementById('sync-card-body');
  if (!pill || !card) return;

  const labels = {
    syncing: ['⏳', 'Synchronisation…'],
    synced: ['☁️', 'Synchronisé'],
    offline: ['📴', 'Hors ligne : tes modifications seront envoyées au retour de la connexion'],
    error: ['⚠️', 'Erreur de synchronisation']
  };

  const label = labels[syncState] || labels.syncing;

  // Petite pastille dans l'en-tête, seulement quand on est connecté
  pill.hidden = !syncUser;
  if (syncUser) {
    pill.textContent = label[0];
    pill.title = label[1];
    pill.setAttribute('aria-label', label[1]);
  }

  if (syncState === 'off') {
    card.innerHTML = '<p class="hint">' + (FIREBASE_CONFIG
      ? "Impossible de charger Firebase (pas d'Internet, ou réseau qui bloque Google comme en Chine continentale). L'appli marche quand même sur cet appareil."
      : "La synchronisation n'est pas encore configurée.") + '</p>';
    return;
  }

  if (!syncUser) {
    card.innerHTML = '<p class="hint">Connecte-toi avec ton compte Google pour retrouver les mêmes données sur ton téléphone, ton ordi… Seul ton compte peut les lire.</p>' +
      '<button type="button" class="btn btn-primary btn-block" id="sync-signin">Se connecter avec Google</button>';
    return;
  }

  card.innerHTML =
    '<p>Connecté : <strong>' + escapeHtml(syncUser.email || syncUser.displayName || 'compte Google') + '</strong></p>' +
    '<p class="sync-status sync-' + syncState + '">' + label[0] + ' ' + escapeHtml(label[1]) +
      (syncError ? '<br><small>' + escapeHtml(syncError) + '</small>' : '') + '</p>' +
    '<div class="form-actions">' +
      '<button type="button" class="btn btn-ghost" id="sync-now">Synchroniser maintenant</button>' +
      '<button type="button" class="btn btn-ghost" id="sync-signout">Se déconnecter</button>' +
    '</div>';
}

// ---------- Démarrage ----------

function initSync() {
  // Boutons de la carte (redessinée souvent : un seul écouteur sur la carte)
  document.getElementById('sync-card-body').addEventListener('click', function (event) {
    if (event.target.id === 'sync-signin') signIn();
    if (event.target.id === 'sync-signout') signOut();
    if (event.target.id === 'sync-now') {
      clearTimeout(syncPushTimer);
      enqueueSync(function () { return reconcile(); });
    }
  });
  document.getElementById('sync-pill').addEventListener('click', function () { showView('settings'); });

  if (!FIREBASE_CONFIG || typeof firebase === 'undefined') {
    setSyncState('off');
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  syncDb = firebase.firestore();
  setSyncState('signed-out');

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) startSync(user);
    else stopSync();
  });
  firebase.auth().getRedirectResult().catch(function (e) {
    alert('Connexion impossible : ' + e.message);
  });

  // Retour de la connexion : on renvoie ce qui attendait.
  window.addEventListener('online', function () {
    if (syncUser) enqueueSync(function () { return reconcile(); });
  });
  window.addEventListener('offline', function () {
    if (syncUser) setSyncState('offline');
  });
  // Téléphone mis en veille ou appli fermée : on envoie tout de suite ce qui attendait.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && syncPushTimer) flushPush();
  });
}
