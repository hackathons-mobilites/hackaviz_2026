# Étude : l'enquête BMO 2026 (projets de recrutement) pour STARWAY

Étude du 04/11/2026. Questions : ce que mesurent les projets de recrutement de l'enquête BMO 2026, ce qu'ils couvrent face aux offres et aux embauches, et s'ils répondent au défi. **Mise en œuvre : [méthodologie § 5 octodecies](methodologie.md), contrat `bmo-1`.** Fichier source : `data/raw/EMP03/Base-open-data-BMO-2026.xlsx` (sha256 `735d0443…92e0`).

**Choix retenus (04/11, confirmés le 05/11)** : BMO est affiché, avec la précision que le chiffre donne une **tendance** des bassins de recrutement, et avec un filtre par famille de métiers ; les choix par défaut du § 5 s'appliquent. Règles d'affichage : une case `*` s'écrit « non diffusé par France Travail (vraisemblablement moins de 5 projets) », présenté comme une déduction (aucune valeur publiée sous 5 sur 53 786 lignes) ; les totaux s'écrivent « au moins n » ; « non diffusé », jamais 0 ; intérim : la source ne le dit pas, le site ne l'affirme pas.

## 1. Ce que mesure BMO
- **Un projet de recrutement est une intention.** L'enquête « mesure les intentions de recrutement des employeurs pour l'année à venir, qu'il s'agisse de créations de postes ou de remplacements » et couvre « tous les types de recrutement, y compris les postes à temps partiel et le personnel saisonnier » ([méthode 2026](https://statistiques.francetravail.org/bmo/static/methode_2026)). Ce n'est ni une offre publiée, ni une embauche réalisée.
- **Champ** : secteur privé, établissements de 0 salarié ayant déclaré une embauche dans les 12 derniers mois, agriculture, collectivités territoriales, établissements publics administratifs (hôpitaux, écoles), officiers publics ou ministériels.
- **Exclusions** : « ni les administrations de l'État (ministères, police, justice…) ni certaines entreprises publiques (Banque de France…) » ([Éclairages et synthèses n° 87](https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?FZD=RBuQGKn0ttDp%2bfieIDhK4Q%3d%3d&SITEKEY=620c8132-d522-44fa-8efa-27a62c26702c), avril 2026, p. 20).
- **Particuliers employeurs et intérim** : non trouvé dans la documentation. Le métier « Personnels de ménage chez des particuliers » existe pourtant (8 318 projets en IDF).
- **Collecte et redressement** : octobre à décembre 2025. 2 222 045 établissements dans le champ, 1 777 253 interrogés, 416 588 questionnaires exploitables, « soit un taux de retour total de 23,4 % ». En IDF : **18,6 %**, le plus bas des régions après Mayotte. Redressement par calage sur 4 marges : taille, secteur, bassin, public ou privé ([rapport France BMO 2026](https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?FZD=zsW2JY14nmpQaCvICk3%2bdw%3d%3d&SITEKEY=620c8132-d522-44fa-8efa-27a62c26702c), p. 72 et 79).
- **Projets difficiles et saisonniers** : France, 43,8 % jugés difficiles et 67,8 % non saisonniers ; IDF, **35,6 % difficiles** (ES 87 p. 18) et **11,3 % saisonniers** ([site BMO](https://statistiques.francetravail.org/bmo/bmo?fa=11&lb=0&pp=2026&ss=1)).
- **Le sens de `*` n'est pas confirmé** dans un texte officiel pour l'open data. La seule règle écrite concerne l'interface web : « Les résultats sont arrondis à la dizaine. Quand il y a moins de 4 projets de recrutement, les résultats sont arrondis à 0 ». Indices d'un masquage des petites valeurs, sans preuve : aucune valeur publiée sous 5 (`met`, `xmet`, `smet`) ; en IDF, total officiel moins somme publiée = 1 971 projets pour 645 cases `*`, soit environ 3 par case. À faire confirmer par France Travail.
- **Pour le pipeline** : une ligne du fichier = métier x bassin x département x **CLPE** (comité local pour l'emploi). 6 bassins d'IDF ont 2 CLPE : il faut aussi sommer sur le CLPE.

## 2. Chiffres de l'Île-de-France en 2026
- **Total officiel : 388 806 projets** (-11,8 % sur un an), 17,1 % des 2 274 951 projets de France (ES 87, tableau 5, p. 18). Somme des cases publiées : 386 835.
- Fichier : 4 536 lignes, 25 bassins, 216 métiers. Cases `*` : 645 (`met`), 1 774 (`xmet`), 3 633 (`smet`).
- Bassins (somme des cases publiées, donc « au moins ») : le plus petit, Brie-Créçois, 1 679 (22 cases `*`) ; le plus grand, T1 Paris, 118 850 (6 cases `*`) ; puis T4 Paris Ouest La Défense 32 926, Versailles Saclay 24 498, Grand Roissy - Le Bourget 22 457.

| Famille de métiers | Projets | Part |
|---|---|---|
| V Vente, tourisme, services | 142 113 | 36,7 % |
| C Encadrement | 86 339 | 22,3 % |
| S Sociales et médico-sociales | 42 689 | 11,0 % |
| A Administratives | 37 549 | 9,7 % |
| Z Autres métiers | 29 316 | 7,6 % |
| O Ouvriers construction | 20 551 | 5,3 % |
| I Ouvriers industrie | 17 768 | 4,6 % |
| T Autres techniciens et employés | 10 510 | 2,7 % |

- **Premier métier d'IDF** : « Artistes (musique, danse, spectacles) », 19 259 projets, en tête dans 7 bassins (dont T1 Paris, T6 Plaine Commune, T8 Est Ensemble). Il compte des contrats très courts : piège pour le récit.
- **Projets pour 1 000 postes salariés (INSEE)** (BMO 2026 / Flores 2023) : IDF 60,3 ; de 48,8 (T11 Grand Paris Sud Est Avenir) à 98,1 (Est 77, 33 % de saisonniers). Ce n'est pas un taux : Flores inclut l'État, BMO non.
- **Le classement des bassins par projets est presque le même que par postes** (corrélation de rang 0,98). Ce que BMO ajoute, c'est **quels métiers** : encadrement 48 % des projets à T3 Grand Paris Seine Ouest contre 6 % à Grand Roissy, où l'administratif fait 20 %.

## 3. Exhaustivité face aux offres et aux embauches
Simples rapports entre deux chiffres publiés ; années, champs et unités diffèrent.

| Comparaison (IDF) | Chiffre publié | BMO / ce chiffre |
|---|---|---|
| Offres diffusées sur francetravail.fr, 12 derniers mois (T2 2026, lu le 04/11/2026, [Data Emploi](https://dataemploi.francetravail.fr/emploi/offre-et-demande/offres/REG/11)) | 1 447 530 | 0,27 |
| Embauches 2025, contrats de plus d'un mois (DPAE, URSSAF, privé hors intérim, [open.urssaf.fr](https://open.urssaf.fr/explore/dataset/dpae-par-region-x-na38/), ODbL, mise à jour 30/10/2026 : CDI 1 374 783 + CDD 820 838) | 2 195 621 | 0,18 |
| Même source, tous contrats (dont 6 318 472 CDD de moins d'un mois) | 8 514 093 | 0,046 |

- 71,0 % des offres diffusées sont transmises par des sites partenaires (France, T4 2025, [publication](https://statistiques.francetravail.org/offres/offrespub/228329), p. 1). Une DPAE compte un contrat, pas une personne.
- Aucune étude rapprochant BMO et DPAE n'a été trouvée. Le plus proche : « 76,9 % des employeurs ayant l'intention d'embaucher ont réussi à recruter en 2025 la totalité des postes à pourvoir », 12,5 % une partie, 4,5 % aucun (rapport France, p. 60 ; 8 587 établissements). Offres déposées à France Travail : 85,8 % pourvues en 2025 ([ES n° 88](https://statistiques.francetravail.org/offres/offrespub/228438), p. 2).
- « Marché caché » : non vérifié (le site de la Dares renvoie un captcha, non contourné).
- **En clair** : BMO donne un ordre de grandeur des besoins annuels déclarés. Ce n'est pas un stock d'offres.

## 4. Est-ce que ça répond au défi ?
- Le brief demande « d'atteindre les lieux où l'emploi se crée et se concentre » (p. 20) et cite « Offres d'emplois (France Travail) » (p. 21). Flores dit où l'emploi **se concentre** ; BMO dit où il **se crée** et dans quels métiers : complément légitime.
- Limites : bassin et non commune ; un seul bassin pour les 20 arrondissements de Paris ; intentions annuelles ; cases non publiées.

Autres sources plus proches des « offres » :
- [API Offres d'emploi](https://www.data.gouv.fr/dataservices/api-offres-demploi) : « actuellement plus exposée » à cause d'« usages automatisés massifs » ; accès sur demande (fiche mise à jour le 20/10/2026).
- [Choisir le service public](https://www.data.gouv.fr/datasets/les-offres-diffusees-sur-choisir-le-service-public) : Licence Ouverte 2.0, CSV hebdomadaire, une ligne par offre. Fichier du 11/10/2026 : environ 71 000 références uniques en IDF, dont 27 650 de la fonction publique d'État (absente de BMO), code postal pour 75 % des lignes IDF. **Seule source ouverte d'offres localisables à la commune.** Recoupe BMO pour les collectivités et les hôpitaux.
- [Offres de la Région IDF](https://data.iledefrance.fr/explore/dataset/offres-emploi-region-iledefrance/) : Licence Ouverte 2.0, mais seulement les postes de la Région elle-même (siège et lycées). **Ce n'est pas la même source que Choisir le service public.**
- [La bonne alternance](https://api.apprentissage.beta.gouv.fr/fr/explorer) : gratuite avec un compte, licence non indiquée, alternance seulement, mêle des offres et des entreprises sans offre publiée.
- [Séries nationales d'offres](https://www.data.gouv.fr/datasets/offres-demploi-diffusees-a-france-travail) : France entière seulement. [Portail Seine-Saint-Denis](https://data.seinesaintdenis.fr/explore/dataset/france-travail-offres-d-emploi/) : 150 offres de toute la France, inutilisable. Data Emploi : licence non vérifiée, pas d'API documentée.

## 5. Ce qui est affiché (choix par défaut retenus le 04/11)
- **Dans le panneau seulement, jamais dans la taille des astres** (ciel stable). Bloc « Bassin d'emploi T4 Paris Ouest La Défense (France Travail) », filtre sur les 8 familles, valeurs « au moins N » avec le nombre de cases non publiées ; pour l'IDF entière, le total officiel (388 806). Paris : un bloc commun aux 20 arrondissements, qui l'annonce.
- **Le filtre par métier agit sur les projets de recrutement**, pas sur les postes salariés (Flores n'a pas de métier) : le compteur de postes et le ciel ne bougent pas. Pas de filtre par secteur.
- **La formule à reprendre** : le chiffre donne une **tendance** des bassins de recrutement.
- **Astre par astre, sans total** « bassins atteignables » tant qu'une règle écrite n'est pas décidée (proposition : un bassin compte une fois si l'un de ses astres est atteint).
- Phrases proposées : « Les employeurs de ce bassin d'emploi ont déclaré au moins 32 926 projets de recrutement pour 2026. Ce sont des intentions recueillies fin 2025 : ni des offres publiées, ni des embauches. Ce chiffre donne une tendance. » et « Le bassin d'emploi est un découpage de France Travail. Les projets ne sont pas localisés plus finement et ne sont pas répartis entre les astres. »
- Sources et limites : « Enquête Besoins en main-d'oeuvre 2026, France Travail, Licence Ouverte 1.0. Champ : employeurs privés, collectivités, établissements publics administratifs ; hors administrations de l'État. Contrats courts et saisonniers inclus. Cases marquées « * » : non diffusé par France Travail (vraisemblablement moins de 5 projets : déduction de l'équipe), non comptées. À titre de repère en Île-de-France : 388 806 projets déclarés pour 2026, 1 447 530 offres diffusées sur francetravail.fr en un an, 2 195 621 embauches de plus d'un mois déclarées à l'URSSAF en 2025. »
- **Choisir le service public** : intégré le 05/11, bloc séparé « Offres diffusées sur Choisir le service public » avec la case « Service public », jamais additionné à BMO ni aux postes salariés recensés par l'INSEE.
- Contrat de données : `bmo-1` (`contrats-donnees.md`).

## 6. À vérifier par un humain
1. Le sens de `*`, auprès de France Travail. 2. Si BMO compte les particuliers employeurs et l'intérim. 3. Le « marché caché » de la Dares (enquête Ofer). 4. Le contenu exact de la page Data Emploi, affichée par JavaScript.
