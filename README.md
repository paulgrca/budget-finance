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
| `js/app.js` | Démarrage et navigation entre onglets |

## Sauvegardes

Les données restent dans **ce navigateur, sur cet appareil**. Si tu vides les données du navigateur, elles disparaissent. Pense à utiliser régulièrement le bouton « Exporter » (onglet Réglages) pour garder une copie au format JSON.

## Avancement

- [x] Étape 1 : squelette et design
- [ ] Étape 2 : stockage et opérations ponctuelles
- [ ] Étape 3 : conversion EUR/MOP
- [ ] Étape 4 : revenus et dépenses récurrents
- [ ] Étape 5 : projection et graphique
- [ ] Étape 6 : limites de budget et alertes
- [ ] Étape 7 : export/import, catégories, finitions
