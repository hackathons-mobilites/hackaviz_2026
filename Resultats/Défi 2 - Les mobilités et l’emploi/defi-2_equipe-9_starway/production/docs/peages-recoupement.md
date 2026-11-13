# Recoupement des péages (05/11/2026)

Recoupement du 05/11/2026 des péages du coût voiture (voiture avec le trafic moyen et coût par véhicule). **Constat de départ** : aucune API ouverte ni donnée officielle ne donne le prix d'un trajet. **Règle : aucun service fermé n'est utilisé** : ni calculateur d'itinéraire commercial, ni scraping d'un site dont les mentions interdisent la réutilisation. Le recoupement se fait avec des sources ouvertes ou officielles (A5) et avec des **relevés faits à la main, datés et sourcés** (A14, Duplex A86).

Commande : `python scripts/04k_toll_crosscheck.py` (depuis `pipeline/`, après 04j et 06). Code : `pipeline/starway/toll_crosscheck.py`, tests `pipeline/tests/test_toll_crosscheck.py`. Sorties versionnées : `data/processed/toll_crosscheck.json` (résumé) et `data/processed/toll_crosscheck_a5.csv` (un couple et une classe par ligne). Le script sort en erreur (code 1) s'il trouve un écart de montant ou une ligne de relevé refusée ; 07 relit le résumé (contrôles « péages : recoupement 04k »). Ces tableaux de montants (`toll_tariffs.csv`, `toll_crosscheck.json`, `toll_crosscheck_a5.csv`, `data/peages_releves_manuels.csv`) ne sont pas redistribués dans la copie publique (accord sur les péages : pas de réexport des données brutes) : les grilles se retéléchargent aux adresses de `data/sources_manifest.csv`, puis 04j et 04k les recalculent.

## 1. A5 (APRR) : site, CSV ouvert, PDF officiel

| Quoi | D'où | Traces |
|---|---|---|
| Montants du site | `data/processed/toll_tariffs.csv` (04j) et la grille publiée `frontend/public/data/tolls.json` (06), jour de service | classes 1 et 5, tarif standard |
| CSV ouvert | [data.gouv.fr « Tarifs autoroutes APRR »](https://www.data.gouv.fr/datasets/tarifs-autoroutes-aprr), ressource « APRR - tarifs au 2026-02 », [fichier](https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv), **Licence Ouverte 2.0** (champ `license` = `lov2`) | `data/raw/TOLL06/`, retéléchargé le 05/11/2026 à 09h26 UTC, sha256 `29557dd8…` (identique à celui de TOLL02 du 03/11) ; le sha1 recalculé `f709ee05…` est celui que publie data.gouv.fr |
| PDF officiel | [APRR, « Tarifs de péage, classes 1 à 5, en vigueur au 1er février 2026 »](https://voyage.aprr.fr/sites/default/files/2026-02/TARIFS_APRR.pdf) | `data/raw/TOLL06/TARIFS_APRR-2026-02.pdf`, sha256 `f05dfa58…` (identique à TOLL02), 300 pages |

**Résultat** (54 couples d'entrée et de sortie dont une gare est de l'A5, 2 classes : 108 comparaisons) :
- **aucun écart** : les quatre valeurs (toll_tariffs.csv, tolls.json, CSV ouvert, PDF officiel) sont égales pour les 104 comparaisons où les quatre sources publient le couple ;
- **4 comparaisons sans équivalent dans le CSV** (2 couples, 2 classes) : Les Éprunes vers Saint-Germain-Laxis (1,80 € et 1,00 €) et Les Éprunes vers Ury (12,80 € et 7,90 €), page 164 du PDF. Le site, tolls.json et le PDF concordent ; le CSV omet ces couples (c'est une des 9 omissions déjà signalées par 04j). Ce n'est pas un écart de montant ;
- PDF contre CSV sur **toutes** les classes et la distance tarifaire : 68 couples communs (408 valeurs), 0 écart ; 9 couples seulement dans le PDF ;
- **relecture indépendante** (05/11, hors pipeline, bibliothèque PyMuPDF, différente de l'outil `pdftotext` du pipeline) : les 108 valeurs du PDF retrouvées à la même page, 0 écart ;
- pages du PDF utilisées (rang dans le PDF, pas le numéro imprimé) : 75, 76, 112 à 115, 120, 121, 164, 173 à 175, 189, 190, 247 à 249, 266, 267. Exemples relus : page 75, « CHATILLON-LABORDE FLEURY-EN-BIERE 166,09 13,50 € 21,90 € 34,90 € 48,00 € 8,30 € » (classe 1 : 13,50 €, classe 5 : 8,30 €) ; page 75, « CHATILLON-LABORDE FORGES 17,27 1,70 € 2,50 € 4,40 € 5,80 € 1,00 € » ; page 76, « CHATILLON-LABORDE ST-GERMAIN-LAXIS 7,26 0,70 € 1,00 € 1,50 € 2,50 € 0,40 € ». Tous dans `toll_crosscheck.json` (`extraits_pdf`) et `toll_crosscheck_a5.csv` (`page_pdf`).

**Limite** : le CSV est un extrait des PDF d'APRR fait par le producteur du jeu, pas une source indépendante des PDF ; il confirme la lecture du PDF (pas de faute de lecture de notre part) mais pas le prix réel payé. Tarif de base, hors abonnements et remises.

## 2. A14 et Duplex A86 : relevés lus sur le rendu des documents officiels (05/11/2026)

**Relevés du 05/11/2026 (règle : chaque montant est lu sur le rendu d'un document officiel, aucun relevé n'est demandé à une personne)** : le fichier `data/peages_releves_manuels.csv` contient 18 relevés, faits **sur le rendu image des PDF** (PyMuPDF, hors dépôt, pages rendues puis regardées une à une ; le texte extrait perd les cellules fusionnées) : 
- **Duplex A86** : guide `Tarifs-Duplex-2026.pdf` (TOLL04, tarifs TTC au 01/01/2026), page 2, bloc « Depuis la gare de Rueil », « Rueil vers Vélizy », ligne « Lundi au jeudi » (mardi 17/11/2026 : ni férié, ni août, ni veille de férié). Lu sur le rendu : 4h30-6h 3,1 € ; 6h-6h30 8,3 € ; 6h30-7h 8,9 € ; 7h-8h 11,4 € (cellule fusionnée 7h-7h30 et 7h30-8h) ; 8h-9h 11,7 € ; 9h-10h 11,4 € ; 10h-16h 9,9 € (cellule fusionnée de six colonnes) ; 16h-17h 12,9 € ; 17h-20h 13,7 € ; 20h-20h30 11,4 € ; 20h30-21h 10,1 € ; 21h-22h 9,9 € ; 22h-0h 3,1 € ; 0h-4h30 2 €. Les 9 heures relevées (05:30, 06:00, 07:45, 08:15, 08:45, 09:00, 12:45, 13:15, 13:45) couvrent les fenêtres d'entrée des trois journées-types (6h-14h, 9h-17h, 14h-22h) pour l'aller Achères vers Orly ; **le retour n'a pas de péage** (chemin R5 hors tunnel), donc rien à relever dans l'autre sens. Résultat : **9 relevés concordants** avec la grille du site. Le simulateur VINCI n'est pas utilisé (calcul hors modulation).
- **A14** : grille SAPN `2026_02-Grille-SAPN.pdf` (TOLL03), pages 2 (classe 1) et 6 (classe 5), bloc « AUTOROUTE A14 » : Montesson tarif de base 10,80 € et réduit 6,60 € (lundi au vendredi hors jours fériés de 10h à 16h et de 21h à 6h), Chambourcy 2,60 € ; classe 5 : 5,50 €, 3,40 € et 1,30 €. Le site lit l'arrêté du 28/01/2026 (JORF) : la grille SAPN est un second document de l'exploitant. **9 relevés concordants.**

Le mode d'emploi ci-dessous (colonnes) reste valable pour ajouter d'autres relevés.

Fichier d'entrée versionné : **`data/peages_releves_manuels.csv`**, créé vide (en-tête seul, aucune ligne inventée). Sans relevé, le contrôle affiche « **non vérifié** » pour l'A14 et pour le Duplex A86, jamais une valeur.

Colonnes (en-tête exact, séparateur virgule, UTF-8) :

| Colonne | Contenu |
|---|---|
| `autoroute` | `A14` ou `A86` |
| `point_ou_troncon` | A14 : `Montesson` ou `Chambourcy` ; Duplex : `entrée > sortie` parmi `Rueil`, `Vaucresson`, `Vélizy` (ex. `Rueil > Vélizy`) |
| `classe` | `1` (voiture) ou `5` (deux-roues ; interdite au Duplex) |
| `tarif` | `standard` (espèces, cartes) ou `telepeage` (badge, Duplex seulement) ; vide = `standard` |
| `jour` | `lundi` à `dimanche`, et pour l'A14 `ferie` ; pour le Duplex `dimanche_ferie`, `veille_ferie`, `aout_ouvrable` (vocabulaire de la grille publiée) |
| `heure` | `HH:MM`, heure de passage à la gare d'entrée (c'est l'heure qui fixe le prix) |
| `montant_eur` | montant lu, en euros TTC (virgule ou point) |
| `source` | document ou page web consulté (URL ou titre) |
| `page` | page, onglet ou écran où le montant est lu |
| `date_releve` | `AAAA-MM-JJ`, jour où le montant a été lu |

Un relevé **sans source, sans page ou sans date** est refusé (le script le dit et sort en erreur), tout comme un champ hors vocabulaire. Le montant du relevé est comparé à la tranche du site qui contient ce jour et cette heure : `concordant`, `ecart`, ou `non_comparable` (le site ne publie pas cette case).

Forme d'une ligne (chaque `<...>` est à remplacer par la valeur lue ; **aucun montant n'est donné ici**) :

```text
A86,Rueil > Vélizy,1,standard,mardi,08:15,<montant lu>,<document ou URL consulté>,<page ou écran>,<AAAA-MM-JJ>
A14,Montesson,1,standard,mardi,11:00,<montant lu>,<document ou URL consulté>,<page ou écran>,<AAAA-MM-JJ>
```

**Limite de réutilisation** : voir `limites.md` (mentions légales de VINCI Autoroutes). Un relevé à la main sert à contrôler notre grille ; ne recopie dans le fichier que le montant, la source, la page et la date, pas le contenu du site.

## 3. Trajet Achères vers Orly : Montesson ? Quelles heures relever sur le Duplex ?

Trajet du site : commune Achères (78551) vers le pôle Orly (`P_ORLY`), tel qu'il est publié (`frontend/public/data/access/78551.json`, `car_trip.toll`, `tolls.json` ; péages relevés sur le chemin voiture de R5 avec la troncature de R5, 04g v2, 04i) :

- **Aller** : un seul passage, le **Duplex A86, entrée Rueil, sortie Vélizy (Pont-Colbert)** (distance 38 958 m). **Pas de Montesson** : aucun des deux portiques de Montesson (nœuds OSM 12120628914 et 12120628915) n'est traversé. Relevé brut 04g (lecture du dossier principal, sans modification) : un seul nœud de péage, 137501371 (« Rueil-Malmaison Bpv »).
- **Retour** (Orly vers Achères, 38 879 m) : **aucun péage** relevé sur le chemin trouvé par R5 (sûr, pas inconnu), donc **ni Duplex ni Montesson**. Le chemin retour de R5 évite le tunnel ; seul l'aller est à recouper sur le Duplex.
- **Conclusion : le trajet « Achères vers Orly » du site ne passe pas par Montesson, ni à l'aller ni au retour.** (Le site publie en revanche Montesson pour Achères vers La Défense, Paris, Plaine Saint-Denis, Roissy et Marne-la-Vallée.)

**Heures à relever sur le Duplex A86** (liste établie avant les relevés du § 2, qui la couvrent sur le rendu du guide PDF) d'après notre grille par tranche. Le prix dépend de **l'heure d'entrée** et du **jour** ; nous publions le **mardi 17/11/2026** (jour de service) ; pour lundi, mercredi, jeudi et vendredi, notre grille a les mêmes prix que le mardi sur toute la plage utile (05h14 à 14h00), un seul jour de semaine suffit donc, mais un relevé le mardi est le plus parlant.

La règle du site (méthodologie § 5 quaterdecies) cherche l'heure d'entrée dans la fenêtre « arrivée au plus tard au début du poste, moins la durée du trajet ». Durée affichée de ce sens : 46 min en route vide (matrice voiture), 81 min avec le trafic moyen de la DiRIF à 9h (indice 1,75 : 46 x 1,75 = 80,5, arrondi à 81) et 64 min à 14h (indice 1,39 : 63,9, arrondi à 64).

| Journée-type (début du poste) | Fenêtre d'entrée, route vide | Fenêtre d'entrée, trafic DiRIF | Tranches du site à relever (mardi, classe 1) |
|---|---|---|---|
| 6h-14h (06:00) | 05:14 à 06:00 | sans mesure DiRIF à cette heure : route vide | **04:30 à 06:00 : 3,10 €** ; à 06:00 la tranche change (06:00 à 06:30 : 8,30 €) |
| 9h-17h (09:00) | 08:14 à 09:00 | 07:39 à 09:00 | **07:00 à 08:00 : 11,40 €** ; **08:00 à 09:00 : 11,70 €** (tranches de 30 min : 07:30 à 08:00 11,40 ; 08:00 à 08:30 11,70 ; 08:30 à 09:00 11,70) ; à 09:00 : 11,40 € |
| 14h-22h (14:00) | 13:14 à 14:00 | 12:56 à 14:00 | **10:00 à 16:00 : 9,90 €** (tranches de 30 min toutes à 9,90) |

Relevés **proposés** (heure d'entrée à saisir dans `heure`, un seul jour, par exemple le mardi ; **les montants ci-dessus sont ceux de notre grille, à ne pas recopier : un relevé se fait sans les regarder**) :

1. mardi **05:30** (dans 04:30 à 06:00) et mardi **06:00** (premier instant de la tranche suivante, pour voir la marche) ;
2. mardi **07:45** (07:30 à 08:00), **08:15** (08:00 à 08:30), **08:45** (08:30 à 09:00) et **09:00** (tranche suivante) ;
3. mardi **12:45** (12:30 à 13:00, fenêtre avec trafic), **13:15** (13:00 à 13:30) et **13:45** (13:30 à 14:00) ;
4. en option, avec badge : mêmes heures, `tarif` = `telepeage` (notre grille donne les mêmes montants que le tarif standard dans ces tranches).

Autres cas à ne pas relever pour ce trajet : classe 5 (deux-roues interdits au Duplex), retour (aucun péage), samedi, dimanche, veilles et jours fériés (le site ne tarifie que le mardi 17/11/2026, la veille et le lendemain).

## 4. Sanef et SAPN : grilles déposées le 05/11/2026

Les grilles Sanef et SAPN ont été déposées à la main par l'équipe dans `data/raw/TOLL03/` le 05/11/2026 (09h47 et 09h53, heure de Paris) : `2026_02-Grille-Sanef.pdf`, `2026_02-Grille-SAPN.pdf`, `grille-modulee-01022026.pdf`, enregistrées au manifeste avec leur sha256. **04j relancé** sur ces grilles. Lecture :

- **A4 (Sanef)** : le triangle « AUTOROUTES A4 - A26 SUD » donne, avec la barrière de Coutevroult (première colonne, « PARIS / NOISY-LE-GRAND (péage de Coutevroult) »), **Saint-Jean-les-Deux-Jumeaux N°18 : 3,90 € (classe 1), 2,60 € (classe 5)** et **Montreuil-aux-Lions N°19 : 4,50 € et 2,70 €** (pages 2 et 6 du PDF, une case par couple lue pour les deux sens). Ces prix sont publiés pour les trajets qui traversent la barrière **et** une de ces deux bretelles (1 020 et 269 sens). **Un trajet qui ne traverse que la barrière** (1 854 sens) **reste inconnu** : la sortie (Meaux / Crécy, etc.) n'a pas de nœud de péage dans l'OSM, donc pas de prix. La barrière n'est donc plus un « prix fixe » (type corrigé en système fermé).
- **A1 (Sanef)** : « SURVILLIERS / SAINT-WITZ N°7 » n'a qu'**une case isolée** (1,0 € en classe 1, 0,5 € en classe 5). **Rendu image et positions des mots du PDF (05/11/2026)** : la case est dans la même colonne (x = 438 pt) que la case « Chamant vers Senlis » (2,2 €), c'est donc le couple **Saint-Witz / Senlis**, mais Senlis et Chamant n'ont **pas de nœud de péage au registre** (le registre n'a que les bretelles de Saint-Witz) : **aucun couple du registre, non retenu, péage inconnu** (`null` avec la raison). **Modulation horaire de l'A1** (`grille-modulee-01022026.pdf`, une page, classe 1, tarifs au 01/02/2026) : trois blocs « Normal », « vert », « rouge », colonnes d'Arsy à Chamant (Arsy, Chevrières, Senlis, Chamant en lignes) ; **le document ne définit ni les heures ni les jours** des périodes (ni légende, ni note : texte extrait et rendu vérifiés) ; **aucune plage n'est devinée**, aucune modulation n'est appliquée (ni à l'A1, ni à l'A4, ni à l'A13, ni à Saint-Witz, ni aux autres classes). Les montants « normal » (par exemple Chamant vers Senlis 2,2 €) sont égaux à la grille standard ; vert et rouge ne sont pas utilisés. Saint-Witz n'y figure pas.
- **A13 (SAPN)** : la grille SAPN du 01/02/2026 **ne nomme ni Buchelay ni Rosny-sur-Seine** (recherche sur le texte avec variantes, accents, tirets, puis sur le rendu image de la page 2 : seuls « BONNIÈRES-SUR-SEINE (A13a) » et « POISSY / ORGEVAL N°7 à MANTES-SUD N°12 » existent) et ne parle pas de flux libre ; elle regroupe « POISSY / ORGEVAL N°7 à MANTES-SUD N°12 » en une station de système fermé : aucun prix de portique. Rien ne permet de rattacher ces stations aux portiques de Buchelay et de Rosny sans deviner. **Non retenu, `null` avec la raison.**
- **Limite des fichiers** : les PDF ont été retraités par un outil tiers (iLovePDF pour Sanef et SAPN, « Microsoft: Print To PDF » pour la modulation) ; leur contenu n'a pas été comparé aux originaux ; l'URL exacte de chaque PDF n'est pas connue (la page des grilles de Sanef répond 403) ; mentions légales de Sanef non lues (403 le 05/11/2026) : licence à confirmer.

## 5. Licence de réutilisation (VINCI Autoroutes)

Voir `limites.md`, section « Péages » : état de la réutilisation à la date du dépôt, passages des mentions légales cités tels quels (page consultée le 05/11/2026). Aucun montant n'est retiré sans décision. **Interrupteur préparé, désactivé par défaut** : `STARWAY_RETIRER_VINCI=1` pour 04j, 06 ou 06k et 07 ; il met à `null` (statut `retire_reutilisation`, raison « réutilisation non autorisée ») le Duplex A86 et Cofiroute (A10, A11) et ne publie plus leurs grilles ; testé (`tests/test_toll_tariffs.py`, `tests/test_toll_publish.py`).

## 6. Refaire le recoupement

```bash
cd pipeline
# 1. après un nouveau relevé dans data/peages_releves_manuels.csv, ou après 04j / 06
.venv/Scripts/python scripts/04k_toll_crosscheck.py
# 2. contrôle
.venv/Scripts/python scripts/07_quality_checks.py
```
