# Budget Macao

Petit site perso pour gérer mon budget en euros (EUR) et en patacas (MOP) pendant mon échange à Macao.

- Fonctionne entièrement dans le navigateur : pas de serveur, pas de compte.
- Les données sont enregistrées dans le navigateur (`localStorage`), sur l'appareil utilisé.

## Ouvrir le site

Double-clique sur `index.html`. Il s'ouvre dans ton navigateur par défaut.

Une connexion Internet n'est nécessaire que pour le taux de change automatique et le graphique de projection.

## Ce que fait le site

| Onglet | Contenu |
|---|---|
| **Accueil** | Solde actuel (EUR et MOP), résumé du mois, alertes de budget, rappel de sauvegarde |
| **Opérations** | Ajouter un revenu ou une dépense (EUR ou MOP), ponctuel ou tous les mois ; historique |
| **Projection** | Solde prévu dans 1 à 24 mois, courbe réel + projection, tableau mois par mois |
| **Budget** | Limites mensuelles (globale, par catégorie, mois précis), alertes 80 % / 100 %, réel vs prévu |
| **Réglages** | Solde de départ, taux de change, catégories, sauvegarde (export/import), tout effacer |

Le taux EUR → MOP vaut le taux EUR → HKD × 1,03, car la pataca est indexée sur le dollar de Hong Kong. Le site le récupère une fois par jour. Un taux manuel sert de secours.

## Sauvegardes

Les données restent dans **ce navigateur, sur cet appareil**. Si tu vides les données du navigateur, elles disparaissent.

- **Exporter** (onglet Réglages) télécharge un fichier `budget-macao-AAAA-MM-JJ.json`. Garde-le en lieu sûr (Drive, mail…).
- **Importer** remplace les données actuelles par celles d'un fichier de sauvegarde. Ça sert aussi à passer d'un appareil à un autre.
- L'accueil affiche un rappel si la dernière sauvegarde date de plus de 14 jours.

Les fichiers `budget-macao-*.json` sont exclus de Git (`.gitignore`), pour ne pas publier tes données par erreur.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page et des onglets |
| `css/style.css` | Design (couleurs, mobile, mode sombre) |
| `js/utils.js` | Petites fonctions partagées (dates, arrondis, message temporaire) |
| `js/storage.js` | Lecture et écriture des données dans le navigateur (localStorage) |
| `js/currency.js` | Devises EUR / MOP : taux de change (auto + manuel), conversion, bouton de devise |
| `js/transactions.js` | Revenus et dépenses : calcul du solde, récurrents, formulaire, historique |
| `js/projection.js` | Projection sur X mois, dépenses courantes estimées, graphique (Chart.js) |
| `js/budget.js` | Limites mensuelles, alertes 80 % / 100 %, réel vs prévu |
| `js/settings.js` | Catégories, export / import JSON, remise à zéro |
| `js/app.js` | Démarrage, navigation entre onglets, page d'accueil, solde de départ |

## Avancement

- [x] Étape 1 : squelette et design
- [x] Étape 2 : stockage et opérations ponctuelles
- [x] Étape 3 : conversion EUR/MOP
- [x] Étape 4 : revenus et dépenses récurrents
- [x] Étape 5 : projection et graphique
- [x] Étape 6 : limites de budget et alertes
- [x] Étape 7 : export/import, catégories, finitions
