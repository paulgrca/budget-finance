# Budget Macao

Petit site perso pour gérer mon budget en euros (EUR) et en patacas (MOP) pendant mon échange à Macao.

- Fonctionne entièrement dans le navigateur : pas de serveur, pas de compte.
- Les données sont enregistrées dans le navigateur (`localStorage`), sur l'appareil utilisé.

## Ouvrir le site

Double-clique sur `index.html`. Il s'ouvre dans ton navigateur par défaut.

Une connexion Internet n'est nécessaire que pour le taux de change automatique et le graphique de projection.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page et des onglets |
| `css/style.css` | Design (couleurs, mobile, mode sombre) |
| `js/utils.js` | Petites fonctions partagées (dates, arrondis, message temporaire) |
| `js/storage.js` | Lecture et écriture des données dans le navigateur (localStorage) |
| `js/currency.js` | Devises EUR / MOP : taux de change (auto + manuel), conversion, bouton de devise |
| `js/transactions.js` | Revenus et dépenses : calcul du solde, formulaire, historique |
| `js/app.js` | Démarrage, navigation entre onglets, page d'accueil, solde de départ |

## Sauvegardes

Les données restent dans **ce navigateur, sur cet appareil**. Si tu vides les données du navigateur, elles disparaissent. Pense à utiliser régulièrement le bouton « Exporter » (onglet Réglages) pour garder une copie au format JSON.

## Avancement

- [x] Étape 1 : squelette et design
- [x] Étape 2 : stockage et opérations ponctuelles
- [x] Étape 3 : conversion EUR/MOP
- [x] Étape 4 : revenus et dépenses récurrents
- [ ] Étape 5 : projection et graphique
- [ ] Étape 6 : limites de budget et alertes
- [ ] Étape 7 : export/import, catégories, finitions
