# Les données de STARWAY

Ce document liste précisément les données utilisées par STARWAY, ce qu'on en fait et pourquoi. Il date du 3 novembre 2026, sauf les passages sur le ciel à 44 astres et sur les péages, mis à jour le 6 novembre 2026. Le **référentiel exhaustif** (une fiche par code de source : licence et obligations, fichiers et empreintes, où la source est utilisée, statut, sources prévues et non retenues) est [sources.md](sources.md), généré à partir du manifeste : ce texte-ci explique, le référentiel recense. La traçabilité fichier par fichier (adresse, date d'extraction, empreinte) est dans [data/sources_manifest.csv](../data/sources_manifest.csv) ; la méthode détaillée dans [methodologie.md](methodologie.md) ; les limites dans [limites.md](limites.md).

Règle de l'équipe : **aucun chiffre ni paramètre inventé**. Chaque valeur affichée vient d'une de ces sources, ou d'un calcul fait sur elles.

## En une phrase
On croise **où sont les emplois** (INSEE), **où vivent les gens** (INSEE), **les horaires des transports** (IDFM) et **les rues** (OpenStreetMap) pour calculer, commune par commune, combien de postes on peut atteindre **à l'aller et au retour** dans un temps donné.

## Les données au cœur du calcul

### EMP01 - Les emplois : INSEE Flores 2023
- **Ce que c'est** : le nombre de postes salariés par commune, présents la dernière semaine de décembre 2023.
- **Producteur et lien** : INSEE, https://www.insee.fr/fr/statistiques/8266010
- **Licence** : Licence Ouverte Etalab 2.0.
- **Pourquoi** : c'est la seule source officielle qui localise les emplois au lieu de travail, commune par commune.
- **Ce qu'on en fait** : on regroupe les communes en **44 astres d'emploi** : un astre par bassin d'emploi de France Travail 2026 (source GEO04), Paris étant découpé en ses 20 arrondissements (choix de l'équipe). Les 44 astres réunissent les 6 418 845 postes salariés recensés par l'INSEE en Île-de-France, soit 100 % (le plus petit en compte 17 853). La taille de chaque astre du ciel est proportionnelle à ces postes.
- **Limite à dire** : ce sont des **postes salariés recensés par l'INSEE**, pas des offres d'emploi ni des postes à pourvoir. Les non-salariés ne sont pas comptés.

### TRA01 - Les horaires des transports : IDFM GTFS
- **Ce que c'est** : tous les horaires prévus des bus, métros, RER, trains et trams d'Île-de-France.
- **Producteur et lien** : Île-de-France Mobilités, jeu « offre horaires TC GTFS IDFM » (PRIM), extrait le 02/11/2026.
- **Licence** : Licence Mobilités IDFM.
- **Pourquoi** : c'est l'offre officielle, et le format GTFS est lu directement par notre moteur de calcul.
- **Ce qu'on en fait** : les trajets sont calculés pour un **mardi ordinaire, le 17/11/2026** (139 563 courses ce jour-là).
- **Limite à dire** : ce sont des horaires **théoriques**, sans retards ni perturbations. Les travaux prévus ce jour-là sont inclus (par exemple des bus de remplacement du RER A le soir).

### CYC01 - Les rues : OpenStreetMap
- **Ce que c'est** : le réseau des rues, chemins et pistes d'Île-de-France.
- **Producteur et lien** : © les contributeurs d'OpenStreetMap, extrait Geofabrik du 01/11/2026.
- **Licence** : ODbL 1.0, attribution « © les contributeurs d'OpenStreetMap ».
- **Pourquoi** : c'est le seul réseau ouvert qui couvre à la fois la marche, le vélo et la voiture.
- **Ce qu'on en fait** : la marche jusqu'à l'arrêt, les correspondances à pied, les trajets à vélo et en voiture.
- **Limite à dire** : la voiture est calculée **sans trafic** (mode « Voiture (route vide) ») : ses temps sont optimistes aux heures de pointe. Le mode « Voiture (trafic moyen DiRIF) » en donne une estimation avec le trafic moyen de chaque tranche horaire (voir `limites.md`).

### GEO01 - Les communes : API Géo
- **Ce que c'est** : la liste officielle des communes, leurs contours et leur population.
- **Producteur et lien** : https://geo.api.gouv.fr, géographie 2026 (jeu Etalab « Contours administratifs », dérivé d'IGN ADMIN EXPRESS).
- **Licence** : ODbL 1.0.
- **Pourquoi** : c'est la référence officielle des codes communes, qui permet de relier toutes les sources entre elles.
- **Ce qu'on en fait** : **1 285 points de départ** (1 265 communes et les 20 arrondissements de Paris), les contours de la carte miroir.

### GEO02 - Où vivent les gens : INSEE Filosofi 2021, carreaux de 200 m
- **Ce que c'est** : le nombre d'habitants dans chaque carré de 200 m sur 200 m.
- **Producteur et lien** : INSEE, https://www.insee.fr/fr/statistiques/8735162
- **Licence** : Licence Ouverte Etalab 2.0.
- **Pourquoi** : le centre « géographique » d'une commune tombe souvent loin des habitants. Pour 637 communes sur 1 285, il tombait dans un carreau sans aucun habitant.
- **Ce qu'on en fait** : chaque trajet part du **centre de gravité de la population** de la commune (choix de l'équipe : ce point est résidentiel, alors que le centre de l'API Géo est un point géométrique).

## Les données de contexte (ce qu'on montre autour du ciel)

| Code | Donnée | Producteur, licence | Ce qu'on en fait |
|---|---|---|---|
| EMP02 | Flux domicile-travail 2023 (recensement) | INSEE, Licence Ouverte | « Combien d'habitants de ma commune travaillent déjà dans ce pôle », dans le panneau de preuve. Sous 200 actifs, le chiffre est affiché comme un ordre de grandeur, selon la règle de l'INSEE. |
| GEN04 | Population par sexe et âge 2023 (recensement) | INSEE, Licence Ouverte | Le halo « Derrière notre étoile » : âge des habitants. **La répartition par sexe n'est plus affichée** (choix du 03/11) : la part des femmes vaut 50,8 % en médiane et reste entre 47,5 % et 53,0 % pour 90 % des 1 285 communes (calcul sur `context/*.json`, champ `population_sex`), donc elle ne distingue presque aucune commune. Les données restent publiées. Le genre est montré là où il fait une différence : les modes domicile-travail par sexe (GEN01). |
| GEN01 | Modes domicile-travail par sexe 2023 (recensement) | INSEE, Licence Ouverte | Le halo : comment les actifs de la commune vont au travail, femmes et hommes. Marge d'erreur affichée selon la fiche de précision de l'INSEE. |
| SOC01 | Revenus et pauvreté 2023 (Filosofi) | INSEE, Licence Ouverte | Le halo : niveau de vie médian et taux de pauvreté. Le secret statistique est respecté (valeur absente, jamais zéro). |
| SOC02 | Taux de chômage localisés, 2e trimestre 2026 (provisoire), paru le 18/09/2026 : 15 zones d'emploi d'Île-de-France (série depuis 2003), 8 départements, région | INSEE ; licence **non vérifiée** (la provenance n'en cite pas) : règle par défaut, « Source : Insee » et date de parution, sans altération | **Affiché** (lot T3, `territoire.json`) : onglet « Chômage » de « Derrière notre étoile », zone d'emploi, département, région, évolution de la zone. Taux au lieu de résidence, descriptif ; aucun taux sur un astre. |
| GEO05 | Zones d'emploi, composition communale au 01/01/2026 | INSEE via la Région Île-de-France, Licence Ouverte v2.0 (écrite dans la provenance) | Donne la zone d'emploi de chaque commune de départ (les 20 arrondissements par Paris). Publié dans `territoire.json`, **affiché** avec l'onglet « Chômage » (lot T3). |
| GEO06 | Polarités du SDRIF-E | Région Île-de-France et Institut Paris Region, Licence Ouverte v2.0 (écrite dans la provenance) | La polarité de la commune, repérée par son nom (7 noms corrigés à la main). **Affiché** (lot T4) : sous le nom de la commune de « Derrière notre étoile » et dans le pli « Communes du pôle », rien quand la commune n'en a pas ni dans le ciel. Pas un classement d'accessibilité. |
| EMP05 | Organisation du temps de travail, enquête Emploi 2024, paru le 26/06/2025 | INSEE ; licence **non vérifiée** (la provenance n'en cite pas) : règle par défaut, « Source : Insee » et date de parution, sans altération | La part des salariés qui travaillent le soir (20h-00h) et la nuit (00h-5h) : **valeurs nationales**, jamais par territoire. **Affiché** (bulle « i » de la journée-type et pli « Méthode et sources », lot T2). Rien sur le 6h-14h. |
| COST01 | Tarif du forfait Navigo Mois | IDFM, page publique | 90,80 € par mois, le même pour tous les pôles : c'est un constat d'uniformité, pas un coût par trajet. |

Ces indicateurs **décrivent** une commune. On n'affirme jamais de lien de cause avec l'accès à l'emploi.

## Le mode Vélib'

### VEL01 - Les stations Vélib' : flux GBFS `station_information.json`
- **Ce que c'est** : la position et le nombre de bornettes des 1 520 stations Vélib' Métropole (instantané du 03/11/2026).
- **Producteur et lien** : Vélib' Métropole (Smovengo), jeu « Vélib' - Localisation et caractéristique des stations » diffusé par la Ville de Paris sur data.gouv.fr, https://www.data.gouv.fr/datasets/velib-localisation-et-caracteristique-des-stations
- **Licence** : **ODbL 1.0** (champ `license` = `odc-odbl` de l'API data.gouv.fr, vérifié le 03/11/2026 ; même licence pour la rediffusion de la Région Île-de-France). Attribution et partage à l'identique des bases dérivées, comme pour OpenStreetMap.
- **Ce qu'on en fait** : pour les **88 communes et arrondissements qui ont au moins une station**, un temps porte à porte « marche jusqu'à une station, Vélib' jusqu'à une autre, marche jusqu'à l'arrivée », avec le meilleur couple de stations (méthode : [methodologie.md § 5 nonies](methodologie.md)).
- **Limite à dire** : **vélo pas forcément disponible**. Le temps suppose qu'un vélo attend à la station de départ et qu'une place est libre à l'arrivée ; personne ne peut le garantir à l'avance (le flux ouvert ne donne la disponibilité qu'en temps réel). Le temps pour prendre et rendre le vélo n'est pas compté. Hors zone : « Pas de station Vélib' dans cette commune ».

## Les péages (04j, relevés les 03/11 et 05/11/2026, affichés dans le panneau de preuve en mode voiture)
Tarifs officiels 2026, classe 1 (voiture) et classe 5 (moto), pour les péages qu'un trajet entre deux communes d'Île-de-France peut traverser. Détail et règle d'application : [methodologie.md](methodologie.md) § 5 quaterdecies.

| ID | Donnée | Producteur et lien | Licence | Ce qu'on en fait |
|---|---|---|---|---|
| TOLL01 | Portiques de péage en flux libre (version du 03/11/2026) | data.gouv.fr, https://www.data.gouv.fr/datasets/68f7f6e2cb331a47613d7778 | Licence Ouverte 2.0 | confirmer les portiques A14, A13 et Vaucresson |
| TOLL02 | Grille de péage APRR au 1er février 2026, classes 1 à 5 (PDF), et sa copie CSV | APRR, https://voyage.aprr.fr/tarifs-de-peage ; copie : https://www.data.gouv.fr/datasets/tarifs-autoroutes-aprr | PDF : document public cité ; CSV : Licence Ouverte 2.0 | prix des couples A5, A6, A77 (Seine-et-Marne) |
| TOLL03 | Arrêté du 28 janvier 2026 (SANEF et SAPN), annexe A14 ; grilles Sanef et SAPN du 01/02/2026 et modulation de l'A1 (PDF déposés à la main le 05/11/2026) | Journal officiel du 30/01/2026, NOR TRAT2600882A, flux ouvert de la DILA ; Sanef, https://www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage (403 aux outils automatiques) | arrêté : Licence Ouverte ; grilles Sanef : pas de licence écrite, réutilisation dans la dataviz autorisée par l'organisateur du hackathon le 09/11/2026 (lecture de l'équipe : le message nomme VINCI), crédit « tarif © Sanef 2026 » affiché | prix de Montesson (tarif de base et tarif réduit selon l'heure) et de Chambourcy ; A4 : Coutevroult avec Saint-Jean et Montreuil ; A1 et A13 : grilles lues, aucun prix |
| TOLL04 | Tarifs 2026 du Duplex A86 et de Cofiroute (fichiers texte et guides), communiqué Duplex, page Ulys A86 | VINCI Autoroutes, https://www.vinci-autoroutes.com/fr/tarifs-peage-reseaux-vinci-autoroutes | documents publics cités, pas de licence affichée ; réutilisation dans la dataviz autorisée par l'organisateur du hackathon le 09/11/2026, crédit « tarif © VINCI Autoroutes 2026 » affiché à côté de chaque montant | prix du Duplex à la demi-heure ; A10 et A11 |
| TOLL05 | Gares de péage du réseau routier national concédé (2025) | Ministère de la Transition écologique, data.gouv.fr | ODC-BY (attribution) | type et côté de chaque gare |
| TOLL06 | Grille APRR du 1er février 2026 retéléchargée le 05/11/2026 : CSV ouvert, PDF officiel, fiche du jeu | https://www.data.gouv.fr/datasets/tarifs-autoroutes-aprr ; https://voyage.aprr.fr/sites/default/files/2026-02/TARIFS_APRR.pdf | CSV : Licence Ouverte 2.0 ; PDF : document public cité | recoupement de l'A5 (04k), rien d'affiché n'en vient |

- **Cases vides** : A4, A1 et A13 (Sanef, SAPN) : grilles non téléchargeables (site protégé) ; un trajet qui y passe a un péage inconnu.
- **Non appliqué** : remises liées aux travaux (Montesson, fermeture du tunnel de Saint-Cloud), abonnements ; aucune réduction liée à la motorisation trouvée.
- **Contexte seulement (non téléchargé, aucun chiffre repris)** : article « Yvelines : l'A14 annoncée gratuite, Sanef affiche encore 50 % de remise », economiematin.fr, 29/10/2026 (https://www.economiematin.fr/yvelines-a14-gratuite-annonce-sanef-remise-2026-10-28).

## Ce que le calcul produit
- Pour chaque commune, chaque pôle, chaque journée-type (6h-14h, 9h-17h, 14h-22h) et chaque mode : la **durée de l'aller** (dernier départ qui arrive à l'heure, attente comprise) et la **durée du retour** (départ à la fin du poste).
- Un pôle est **accessible** si l'aller ET le retour tiennent chacun dans le budget choisi (de 5 à 120 min).
- Les « découvertes » (éclipses horaires, écarts entre communes voisines, retours hors budget, gains du vélo) sont calculées automatiquement à partir de ces durées.
- Le moteur de calcul est **r5py** (moteur R5, open source). Ses réglages par défaut sont signalés comme tels : marche 3,6 km/h, vélo 12 km/h, au plus 8 trajets en transport par déplacement, et au plus 1 km à pied pour une correspondance. **La marche jusqu'au premier arrêt et depuis le dernier arrêt est un réglage choisi par l'équipe**, pas une donnée : « normal », jusqu'à 3 km à pied (réglage par défaut), ou « confort », pas plus de 1 km. Un trajet tout à pied est limité de la même façon ; la marche seule reste un mode à part.

## Ce qu'on n'utilise pas, et pourquoi
| Donnée | Pourquoi on ne l'utilise pas (ou pas encore) |
|---|---|
| Offres d'emploi | Elles décrivent des postes à pourvoir, pas les emplois existants : Flores répond à notre question (où se trouvent les postes). |
| Barème fiscal kilométrique (coût voiture) | Ce n'est pas un coût de trajet : on l'a retiré plutôt que d'inventer un coût. |
| Horaires réels des salariés | Aucune source ouverte : on propose 3 journées-types, présentées comme des scénarios. |
| Validations IDFM, quartiers de gare | Cités par le brief, optionnels : pas intégrés avant le dépôt. |
| Navitia (PRIM, TRA02) | Utilisé **pour vérifier** nos temps de trajet en transports en commun : aucune durée de trajet affichée ne vient de Navitia. Seule exception depuis le 04/11 : la durée de correspondance au même arrêt (API « connections », code TRA02B), citée dans le panneau de preuve comme minimum du calculateur d'IDFM quand une correspondance publiée est plus courte. Le 03/11/2026, 320 trajets (ceux de la visite, ceux des découvertes et un tirage au hasard) ont été recalculés avec le calculateur d'IDFM : écart médian de 1,7 min, 77 % à 5 min près (méthode et écarts expliqués : [méthodologie](methodologie.md), § 5, « Recoupement avec Navitia »). API « IDFM Navitia » de PRIM : conditions générales d'utilisation de PRIM et **Licence Mobilités** pour les données (page de l'API vérifiée le 03/11/2026) ; quota par défaut de 5 requêtes par seconde et 1 000 par jour. |

## Où trouver les fichiers
- Données brutes : `data/raw/<code>/` (non versionnées quand elles sont volumineuses, la procédure de téléchargement est dans `data/raw/README.md`).
- Tables préparées : `data/processed/`.
- Fichiers lus par le site : `frontend/public/data/` (`meta.json`, `poles.json`, `communes.json`, `sources.json`, `insights.json`, `access/`, `context/`, `geo/`).
- La page « Sources & limites » du site reprend les sources et leurs licences.
