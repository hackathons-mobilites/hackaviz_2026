# Contribuer à AtouVent

AtouVent est développé dans le cadre du Hackathon Mobilités 2026 « Spécial Dataviz' » (Île-de-France Mobilités).
Le code est sous licence MIT (`licence.MIT`), les jeux de données produits sous les licences indiquées dans `SOURCES.md`.
Les participant·e·s suivent le [code de conduite de la communauté GitHub](https://docs.github.com/fr/site-policy/github-terms/github-community-code-of-conduct).

## Contributeurs

Chaque contributeur est identifié par son nom réel, comme le demande le règlement du hackathon.

| Nom | Compte GitHub | Rôle |
|---|---|---|
| Brice Bokatola | [@BriceBOKATOLA](https://github.com/BriceBOKATOLA) | conception, développement, données |
| William Laine | [@Laine-William](https://github.com/Laine-William) | conception, développement, données |

Toute nouvelle personne s'ajoute à ce tableau dans sa première contribution.

## Certificat d'authenticité de la contribution

En proposant une contribution, vous certifiez (Developer Certificate of Origin 1.1, <https://developercertificate.org>) :

1. qu'elle a été créée en tout ou partie par vous et que vous avez le droit de la publier sous la licence du projet ; ou
2. qu'elle s'appuie sur un travail antérieur sous licence libre compatible, que vous avez le droit de reprendre, et dont vous citez
   la source, la version et la licence dans `SOURCES.md` ;
3. que vous comprenez que la contribution et ces informations sont publiques et conservées avec le projet.

Chaque commit est signé de cette façon : `git commit -s` ajoute la ligne `Signed-off-by: Prénom Nom <adresse>`.

## Règles de contribution

- **Données** : uniquement des données ouvertes, citées dans `SOURCES.md` (producteur, lien, licence, date ou version).
  Les données exclusives au hackathon (répertoire de données réservé aux participant·e·s) ne sont **jamais** versionnées,
  copiées ni publiées (règlement, article 6.5).
- **Secrets** : aucune clé d'API ni mot de passe dans le code ; ils vont dans `backend/.env`, qui n'est jamais versionné
  (modèle : `backend/.env.example`).
- **Accessibilité** (RGAA 4.1, niveau AA) : avant toute demande de fusion, lancer dans `frontend/` :
  `npm run a11y:contrast`, `npm run a11y:audit` et `npm run a11y:keyboard` (l'application et l'API doivent tourner).
  Aucune information par la couleur seule, un texte avec chaque pictogramme, un titre et une alternative en tableau pour chaque graphique.
- **Tests** : `pytest` dans `backend/`, `npm test` dans `frontend/`. Un correctif ou une fonction nouvelle vient avec son test.
- **Style** : composants React dans `frontend/src/components/` (réutilisables) ou `frontend/src/pages/` (un écran) ;
  styles SCSS dans `frontend/src/assets/scss/` (un fichier par famille de composants, couleurs uniquement par les jetons de
  `base/_tokens.scss`) ; textes dans les 5 langues de `frontend/src/i18n/locales/`.
- **Commentaires** : en français, ils expliquent le pourquoi (règle métier, source, limite), pas le comment.
