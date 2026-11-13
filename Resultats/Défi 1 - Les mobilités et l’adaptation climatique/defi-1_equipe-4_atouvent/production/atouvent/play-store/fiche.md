# AtouVent sur le Google Play Store

Tout ce qu'il faut pour remplir la Play Console (https://play.google.com/console), dans l'ordre des écrans.
Fichier à envoyer : `frontend/android/app/build/outputs/bundle/release/app-release.aab` (`npm run android:release`).

## Fiche principale du Store

| Champ | Contenu |
|---|---|
| Nom de l'application (30 car. max) | AtouVent : trajets et chaleur |
| Description courte (80 car. max) | Itinéraires en Île-de-France qui tiennent compte de la chaleur, pour tous. |
| Icône (512 × 512) | `icone-512.png` |
| Image de présentation (1024 × 500) | `banniere-1024x500.png` |
| Captures téléphone (1080 × 1920) | `captures/1-accueil.png` à `captures/4-accessibilite.png` |
| Catégorie | Cartes et navigation |
| Site web | https://atouvent.com |
| Politique de confidentialité | https://atouvent.com/confidentialite.html |

### Description complète (4 000 car. max)

Quand il fait chaud, le trajet le plus court n'est pas toujours le meilleur. AtouVent vous aide à vous déplacer en
Île-de-France en tenant compte de la chaleur, de la pollution et de votre situation.

ITINÉRAIRES CLIMAT
• Métro, RER, train, tram, bus, vélo, Vélib' et marche comparés selon la chaleur : rames climatisées, passages en
  souterrain, ombre, abris, et empreinte carbone de chaque trajet.
• Trajet préparé à l'avance avec la météo prévue à l'heure du départ.
• Qualité de l'air sur les quais de 665 gares souterraines.

SUIVI DU TRAJET EN DIRECT
• Prochain passage en temps réel, perturbations des lignes, ascenseurs en panne, signalements des autres voyageurs.
• Le suivi démarre quand vous vous mettez en route et détecte votre arrivée.
• Fonctionne aussi sans réseau dans le métro, grâce aux horaires enregistrés sur le téléphone.

AUTOUR DE VOUS
• Lieux frais, fontaines, parcs et jardins, arrêts proches avec leur accessibilité, Vélib' disponibles.
• Alertes chaleur, orages, crues et pollution.

ACCESSIBLE À TOUS
• Profil fauteuil roulant : trajets sans marches, gares dont l'ascenseur est en panne évitées.
• Profil malvoyant : guidage vocal, fort contraste, grands caractères. Profil malentendant : alertes par vibration.
• Conçu selon le référentiel d'accessibilité RGAA (niveau AA), utilisable au clavier et avec un lecteur d'écran.
• Disponible en français, anglais, espagnol, italien et chinois.

Sans publicité. Données publiques d'Île-de-France Mobilités, Météo-France, Airparif, Institut Paris Region et
Ville de Paris. Créé pour le Hackathon Mobilités 2026.

## Contenu de l'application (questionnaires)

| Rubrique | Réponse |
|---|---|
| Politique de confidentialité | https://atouvent.com/confidentialite.html |
| Annonces | Non, l'application ne contient pas de publicité |
| Accès à l'application | Tout fonctionne sans compte. L'espace « Données » est réservé aux administrateurs : sans objet pour l'examen |
| Classification du contenu | Catégorie « Référence, actualités ou enseignement » ou « Utilitaire » ; aucune violence, jeu d'argent, contenu sexuel ; les usagers peuvent publier des signalements de trajet (texte prédéfini, sans message libre) |
| Public cible | 16 ans et plus |
| Application d'actualités | Non |
| Applications liées à la santé | Non (le profil de déplacement n'est pas un service médical) |
| Applications gouvernementales | Non |
| Position en arrière-plan | Non demandée (position utilisée seulement application ouverte) |

## Sécurité des données

Chiffrement en transit : **oui** (HTTPS). Suppression : **oui**, dans l'application (« Mon compte » › « Supprimer mon
compte ») ou sur https://atouvent.com/compte. Aucune donnée partagée avec des tiers, aucune publicité, aucun suivi.

| Type de donnée | Collectée | Partagée | Obligatoire | Usage |
|---|---|---|---|---|
| Position précise et approximative | Oui | Non | Non (facultative) | Itinéraires depuis « Ma position », arrêts et lieux proches, suivi du trajet, signalements |
| Adresse e-mail | Oui | Non | Non (compte facultatif) | Gestion du compte, e-mail de mot de passe oublié |
| Informations de santé (profil de déplacement : fauteuil, malvoyant…) | Oui | Non | Non, avec consentement | Adapter les itinéraires ; chiffré sur le serveur |
| Contenu généré (signalements de trajet) | Oui | Non | Non | Informer les autres voyageurs ; visibles quelques heures, puis gardés sans auteur pour les statistiques |
| Paramètres et lieux enregistrés | Oui | Non | Non | Préférences d'accessibilité et trajets favoris |
