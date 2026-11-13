# Analyse des points d'origine des communes

Généré le 02/11/2026 à 23:20 par `pipeline/scripts/02b_origin_points_analysis.py` (analyse seule ; le calcul r5py en cours utilise toujours le centre API Géo). Données par commune : `data/processed/origin_points_2026.csv`.

## Sources

- **Centre actuel** : champ `centre` de l'API Géo (GEO01, extrait le 02/11/2026), point d'origine du calcul en cours.
- **Mairie** : champ `mairie` de l'API Géo (extrait le 02/11/2026). Jeu Etalab « Contours administratifs » (data.gouv.fr, ODbL) : « la position des mairies est issue du produit d'AdminExpress de l'IGN ». Les 1er à 4e arrondissements partagent la mairie de Paris Centre.
- **Centre de gravité de la population** : INSEE, « Données au carreau de 200m (y compris données imputées) », Filosofi 2021, paru le 12/02/2026 (https://www.insee.fr/fr/statistiques/8735162), fichier csv national (87 Mo compressé), Licence Ouverte (conditions de réutilisation INSEE). Variables utilisées : `idcar_200m` (identifiant Inspire, coin sud-ouest en EPSG:3035), `ind` (nombre d'individus), `i_est_200` (carreau imputé), `lcog_geo` (filtre de lecture IDF seulement).

## Méthode

1. Lecture par morceaux des carreaux de France métropolitaine dont `lcog_geo` contient un code d'IDF (72762 carreaux habités retenus après rattachement, dont 30229 imputés, `i_est_200 = 1`).
2. Chaque carreau est rattaché à l'origine (commune 2026 ou arrondissement) qui contient son **centre** (contours GEO01 2026 ; `lcog_geo`, en COG 2021, n'est pas utilisé pour le rattachement).
3. Centre de gravité = moyenne des centres des carreaux pondérée par `ind`, en EPSG:3035.
4. Distances à vol d'oiseau en Lambert-93. « Carreau sans population » = carreau de 200 m absent du fichier Filosofi (aucun ménage fiscal), ou présent avec `ind = 0`.
5. Contrôle : population des carreaux / population légale (API Géo) : médiane 0.981, 10e centile 0.895, 90e centile 1.054 (Filosofi compte les personnes des ménages fiscaux, hors communautés ; millésime 2021).

## Résultats

Origines : 1285 ; sans centre de gravité (aucun carreau habité rattaché) : 0.

| Distance | Médiane | 90e centile | Maximum |
|---|---|---|---|
| centre API Géo - centre de gravité | 0,55 km | 1,17 km | 4,15 km |
| mairie - centre de gravité | 0,31 km | 0,77 km | 2,46 km |
| centre API Géo - mairie | 0,67 km | 1,42 km | 3,90 km |

- Centres API Géo actuels dans un carreau **sans population** : **637** sur 1285.
- Mairies dans un carreau sans population : 13.
- Centres de gravité dans un carreau sans population : 215 (commune à plusieurs noyaux : le barycentre peut tomber entre deux bourgs, ou dans un carreau rattaché à une commune voisine si la commune est concave).
- **Point retenu** : centre de gravité, ou à défaut centre du carreau habité de la même origine le plus proche ; déplacement des 215 points concernés : médiane 0,22 km, maximum 1,05 km ; distance au centre API Géo actuel : médiane 0,56 km, 90e centile 1,23 km, maximum 4,15 km.

### Origines dont le centre actuel est à plus de 1 km du centre de gravité (214)

| Commune | Centre - gravité | Mairie - gravité | Centre habité ? | Population |
|---|---|---|---|---|
| Saint-Germain-en-Laye (78551) | 4,15 km | 0,98 km | non | 45 931 |
| Achères (78005) | 3,81 km | 0,09 km | non | 22 241 |
| La Chapelle-Gauthier (77086) | 3,54 km | 0,36 km | non | 1 400 |
| Laval-en-Brie (77245) | 3,54 km | 0,32 km | non | 412 |
| Magny-les-Hameaux (78356) | 3,38 km | 0,43 km | non | 9 386 |
| Fontenailles (77191) | 3,10 km | 0,53 km | non | 1 109 |
| Tremblay-en-France (93073) | 3,08 km | 0,28 km | non | 38 348 |
| Jouarre (77238) | 2,51 km | 0,35 km | non | 4 221 |
| Gironville-sur-Essonne (91273) | 2,39 km | 0,33 km | non | 760 |
| Faremoutiers (77176) | 2,23 km | 0,33 km | non | 3 057 |
| Fontainebleau (77186) | 2,19 km | 0,46 km | non | 15 583 |
| Gonesse (95277) | 2,18 km | 1,46 km | non | 27 707 |
| Moret-Loing-et-Orvanne (77316) | 2,09 km | 0,71 km | oui | 12 810 |
| Mousseaux-lès-Bray (77321) | 2,09 km | 0,19 km | non | 682 |
| Bonnières-sur-Seine (78089) | 2,01 km | 0,40 km | oui | 5 064 |
| La Boissière-École (78077) | 2,01 km | 0,55 km | non | 747 |
| Buthiers (77060) | 1,96 km | 0,48 km | non | 792 |
| L'Île-Saint-Denis (93039) | 1,93 km | 0,55 km | non | 8 696 |
| Paris 12e Arrondissement (75112) | 1,89 km | 0,47 km | oui | 138 024 |
| Rosny-sur-Seine (78531) | 1,88 km | 0,29 km | non | 7 328 |
| Marcoussis (91363) | 1,86 km | 0,18 km | non | 8 618 |
| Ablis (78003) | 1,83 km | 0,46 km | non | 3 913 |
| Auvers-Saint-Georges (91038) | 1,81 km | 0,30 km | non | 1 223 |
| Janville-sur-Juine (91318) | 1,77 km | 0,10 km | non | 2 041 |
| Auffargis (78030) | 1,74 km | 0,45 km | non | 1 963 |
| Buno-Bonnevaux (91121) | 1,73 km | 0,27 km | non | 527 |
| Luzarches (95352) | 1,73 km | 0,20 km | non | 5 008 |
| Gurcy-le-Châtel (77223) | 1,69 km | 0,30 km | non | 559 |
| Saint-Méry (77426) | 1,69 km | 0,07 km | non | 334 |
| Étiolles (91225) | 1,65 km | 0,10 km | non | 3 105 |
| Parmain (95480) | 1,63 km | 0,41 km | non | 5 655 |
| Mortcerf (77318) | 1,63 km | 0,16 km | non | 1 400 |
| Saint-Prix (95574) | 1,62 km | 0,06 km | non | 7 612 |
| Saint-Léger-en-Yvelines (78562) | 1,62 km | 0,28 km | non | 1 468 |
| Gretz-Armainvilliers (77215) | 1,62 km | 0,49 km | non | 8 825 |
| Ussy-sur-Marne (77478) | 1,61 km | 0,41 km | non | 1 058 |
| Chamigny (77078) | 1,60 km | 0,11 km | non | 1 480 |
| Poligny (77370) | 1,59 km | 0,15 km | non | 825 |
| Dammartin-sur-Tigeaux (77154) | 1,57 km | 0,33 km | non | 1 280 |
| Dourdan (91200) | 1,56 km | 0,20 km | non | 11 415 |
| Sognolles-en-Montois (77454) | 1,56 km | 0,05 km | non | 371 |
| Asnières-sur-Oise (95026) | 1,56 km | 1,00 km | non | 3 127 |
| Étrépilly (77173) | 1,55 km | 0,13 km | non | 805 |
| Auvers-sur-Oise (95039) | 1,55 km | 0,89 km | non | 6 863 |
| Soisy-sur-Seine (91600) | 1,55 km | 0,29 km | non | 7 418 |
| Paray-Vieille-Poste (91479) | 1,54 km | 0,31 km | non | 8 202 |
| Prunay-sur-Essonne (91507) | 1,53 km | 0,14 km | non | 324 |
| Mormant (77317) | 1,53 km | 0,11 km | non | 5 282 |
| La Queue-en-Brie (94060) | 1,52 km | 0,22 km | non | 12 241 |
| Guigneville-sur-Essonne (91293) | 1,51 km | 0,31 km | non | 904 |
| Mitry-Mory (77294) | 1,51 km | 2,11 km | oui | 20 456 |
| Baulne (91047) | 1,49 km | 0,30 km | non | 1 448 |
| Épône (78217) | 1,49 km | 0,47 km | oui | 7 031 |
| Voinsles (77527) | 1,49 km | 0,35 km | non | 580 |
| Versailles (78646) | 1,49 km | 0,73 km | non | 84 095 |
| Bullion (78120) | 1,48 km | 0,39 km | non | 1 916 |
| Vert-le-Grand (91648) | 1,47 km | 0,11 km | non | 2 444 |
| Machault (77266) | 1,47 km | 0,06 km | non | 815 |
| Chailly-en-Brie (77070) | 1,47 km | 1,12 km | non | 1 576 |
| Noisy-sur-École (77339) | 1,45 km | 0,94 km | non | 1 797 |
| Follainville-Dennemont (78239) | 1,45 km | 1,03 km | non | 2 184 |
| Vernou-la-Celle-sur-Seine (77494) | 1,45 km | 0,46 km | non | 2 630 |
| Saint-Clair-sur-Epte (95541) | 1,45 km | 0,43 km | non | 964 |
| Courdimanche-sur-Essonne (91184) | 1,45 km | 0,04 km | non | 276 |
| Samoreau (77442) | 1,45 km | 0,27 km | non | 2 384 |
| Arrancourt (91022) | 1,44 km | 0,45 km | non | 115 |
| Voulangis (77529) | 1,43 km | 0,13 km | non | 1 541 |
| Andelu (78013) | 1,42 km | 0,18 km | non | 550 |
| Treuzy-Levelay (77473) | 1,42 km | 0,16 km | oui | 458 |
| Abbéville-la-Rivière (91001) | 1,42 km | 1,09 km | non | 322 |
| Morigny-Champigny (91433) | 1,42 km | 0,52 km | non | 4 412 |
| Cerneux (77066) | 1,41 km | 0,60 km | non | 272 |
| Maule (78380) | 1,40 km | 0,74 km | oui | 6 083 |
| Ollainville (91461) | 1,40 km | 0,78 km | non | 5 455 |
| Mézières-sur-Seine (78402) | 1,40 km | 0,63 km | non | 3 923 |
| Nemours (77333) | 1,39 km | 0,62 km | non | 12 889 |
| Étampes (91223) | 1,39 km | 0,53 km | non | 26 857 |
| Cerny (91129) | 1,39 km | 0,62 km | non | 3 531 |
| Jaignes (77235) | 1,38 km | 0,95 km | non | 322 |
| Notre-Dame-de-la-Mer (78320) | 1,37 km | 0,58 km | non | 742 |
| Soisy-sur-École (91599) | 1,37 km | 0,61 km | non | 1 174 |
| Bruyères-le-Châtel (91115) | 1,37 km | 0,37 km | non | 3 788 |
| Boissy-Saint-Léger (94004) | 1,35 km | 0,54 km | non | 17 325 |
| Othis (77349) | 1,35 km | 0,60 km | non | 6 717 |
| Millemont (78404) | 1,34 km | 0,15 km | non | 272 |
| Nandy (77326) | 1,34 km | 0,43 km | non | 6 350 |
| Magny-en-Vexin (95355) | 1,34 km | 0,44 km | oui | 5 779 |
| Lévis-Saint-Nom (78334) | 1,33 km | 2,46 km | non | 1 603 |
| Saint-Jean-les-Deux-Jumeaux (77415) | 1,33 km | 0,32 km | non | 1 298 |
| Chambourcy (78133) | 1,32 km | 0,23 km | non | 5 847 |
| Everly (77174) | 1,32 km | 0,14 km | non | 566 |
| Coupvray (77132) | 1,30 km | 0,60 km | non | 3 066 |
| Villeconin (91662) | 1,30 km | 0,54 km | non | 766 |
| Vulaines-sur-Seine (77533) | 1,30 km | 0,60 km | non | 2 730 |
| Collégien (77121) | 1,29 km | 0,07 km | non | 3 354 |
| Les Écrennes (77165) | 1,29 km | 0,24 km | non | 628 |
| Champagne-sur-Seine (77079) | 1,29 km | 0,43 km | non | 6 497 |
| Poissy (78498) | 1,28 km | 0,07 km | oui | 40 983 |
| Le Plessis-Pâté (91494) | 1,28 km | 0,07 km | non | 4 154 |
| Coutevroult (77141) | 1,28 km | 0,21 km | non | 1 187 |
| Gesvres-le-Chapitre (77205) | 1,28 km | 0,06 km | non | 145 |
| Freneuse (78255) | 1,27 km | 0,68 km | oui | 4 505 |
| Villiers-sur-Morin (77521) | 1,27 km | 0,38 km | non | 2 083 |
| Villenoy (77513) | 1,27 km | 0,46 km | non | 5 127 |
| Oncy-sur-École (91463) | 1,27 km | 0,48 km | oui | 1 042 |
| Puiseux-en-France (95509) | 1,27 km | 0,44 km | non | 3 765 |
| La Rochette (77389) | 1,26 km | 0,41 km | oui | 3 932 |
| Égreville (77168) | 1,26 km | 0,40 km | non | 2 186 |
| Salins (77439) | 1,25 km | 0,31 km | non | 1 165 |
| Lisses (91340) | 1,25 km | 0,73 km | oui | 7 373 |
| Jossigny (77237) | 1,25 km | 0,21 km | non | 650 |
| Pézarches (77360) | 1,24 km | 0,41 km | non | 410 |
| Saint-Witz (95580) | 1,24 km | 0,38 km | non | 2 724 |
| Saint-Brice (77403) | 1,24 km | 0,07 km | non | 819 |
| Sainte-Mesme (78569) | 1,23 km | 0,21 km | non | 904 |
| Arville (77009) | 1,22 km | 0,22 km | non | 145 |
| Genainville (95270) | 1,22 km | 0,02 km | non | 522 |
| Héricy (77226) | 1,21 km | 0,56 km | non | 2 507 |
| Villeneuve-sur-Bellot (77512) | 1,21 km | 0,62 km | non | 1 151 |
| Saint-Hilliers (77414) | 1,20 km | 0,27 km | non | 474 |
| Bagneaux-sur-Loing (77016) | 1,20 km | 0,06 km | non | 1 570 |
| Le Vaudoué (77485) | 1,20 km | 0,23 km | non | 731 |
| Louan-Villegruis-Fontaine (77262) | 1,19 km | 1,35 km | non | 491 |
| Moisson (78410) | 1,19 km | 0,36 km | non | 902 |
| Bussy-Saint-Georges (77058) | 1,19 km | 1,43 km | non | 27 498 |
| Croissy-Beaubourg (77146) | 1,18 km | 0,54 km | non | 2 018 |
| Signy-Signets (77451) | 1,18 km | 0,46 km | non | 638 |
| Grandchamp (78283) | 1,17 km | 0,30 km | non | 300 |
| Trilport (77475) | 1,17 km | 0,26 km | non | 5 146 |
| Provins (77379) | 1,17 km | 0,44 km | oui | 11 632 |
| La Grande-Paroisse (77210) | 1,16 km | 0,19 km | non | 2 893 |
| Fouju (77195) | 1,16 km | 0,05 km | non | 655 |
| Savigny-le-Temple (77445) | 1,16 km | 0,60 km | oui | 31 148 |
| Gravon (77212) | 1,16 km | 0,13 km | non | 156 |
| Perdreauville (78484) | 1,16 km | 0,37 km | oui | 701 |
| Aubepierre-Ozouer-le-Repos (77010) | 1,16 km | 1,44 km | non | 984 |
| Moigny-sur-École (91408) | 1,16 km | 0,12 km | non | 1 294 |
| Brou-sur-Chantereine (77055) | 1,15 km | 0,22 km | non | 5 196 |
| Fontaine-la-Rivière (91240) | 1,15 km | 0,24 km | non | 192 |
| Compans (77123) | 1,15 km | 0,37 km | non | 754 |
| Sainte-Aulde (77401) | 1,15 km | 1,06 km | oui | 706 |
| Maurecourt (78382) | 1,14 km | 0,12 km | non | 4 454 |
| Rebais (77385) | 1,14 km | 0,11 km | non | 2 294 |
| Saint-Siméon (77436) | 1,14 km | 0,26 km | non | 883 |
| Amenucourt (95012) | 1,14 km | 0,70 km | oui | 212 |
| Saint-Hilaire (91556) | 1,14 km | 0,47 km | non | 401 |
| Le Val-Saint-Germain (91630) | 1,13 km | 0,63 km | non | 1 576 |
| Condé-sur-Vesgre (78171) | 1,13 km | 0,20 km | non | 1 279 |
| Saint-Ouen-en-Brie (77428) | 1,12 km | 0,23 km | non | 837 |
| Les Ulis (91692) | 1,11 km | 0,23 km | oui | 25 886 |
| Bombon (77044) | 1,10 km | 0,15 km | non | 935 |
| Changis-sur-Marne (77084) | 1,10 km | 0,39 km | non | 1 335 |
| Touquin (77469) | 1,10 km | 0,35 km | non | 1 253 |
| Villeneuve-les-Bordes (77509) | 1,10 km | 0,64 km | non | 610 |
| Sarcelles (95585) | 1,10 km | 1,48 km | oui | 59 173 |
| Dammarie-les-Lys (77152) | 1,10 km | 0,29 km | oui | 23 559 |
| Saint-Brice-sous-Forêt (95539) | 1,10 km | 0,19 km | non | 15 063 |
| Vaux-le-Pénil (77487) | 1,09 km | 0,09 km | oui | 11 474 |
| Épinay-sous-Sénart (91215) | 1,09 km | 0,67 km | oui | 11 611 |
| Montenils (77304) | 1,09 km | 0,06 km | non | 34 |
| Chalautre-la-Grande (77072) | 1,09 km | 0,30 km | non | 644 |
| Blennes (77035) | 1,08 km | 1,07 km | non | 546 |
| Soignolles-en-Brie (77455) | 1,07 km | 0,17 km | non | 2 021 |
| Gironville (77207) | 1,07 km | 1,16 km | non | 166 |
| Le Mesnil-le-Roi (78396) | 1,07 km | 0,74 km | oui | 6 332 |
| Marly-le-Roi (78372) | 1,07 km | 0,77 km | oui | 16 756 |
| Arbonne-la-Forêt (77006) | 1,07 km | 0,05 km | non | 1 021 |
| Rubelles (77394) | 1,06 km | 0,83 km | non | 3 537 |
| Blandy (77034) | 1,06 km | 0,13 km | non | 763 |
| Maurepas (78383) | 1,06 km | 0,75 km | non | 20 629 |
| Chevry-Cossigny (77114) | 1,06 km | 0,52 km | non | 4 075 |
| Ormoy-la-Rivière (91469) | 1,06 km | 0,20 km | oui | 943 |
| Coubert (77127) | 1,06 km | 0,06 km | non | 2 005 |
| Saint-Pierre-lès-Nemours (77431) | 1,06 km | 0,57 km | non | 5 401 |
| Villuis (77523) | 1,05 km | 0,20 km | non | 272 |
| Mauregard (77282) | 1,05 km | 0,16 km | non | 341 |
| Sigy (77452) | 1,05 km | 0,20 km | non | 66 |
| Diant (77158) | 1,05 km | 0,37 km | non | 194 |
| Vieux-Champagne (77496) | 1,05 km | 0,21 km | non | 192 |
| Lissy (77253) | 1,05 km | 0,10 km | non | 352 |
| Villepinte (93078) | 1,04 km | 1,20 km | oui | 41 470 |
| Noisy-le-Grand (93051) | 1,04 km | 1,02 km | oui | 72 978 |
| Meilleray (77287) | 1,04 km | 0,11 km | non | 504 |
| Guillerval (91294) | 1,04 km | 0,44 km | non | 808 |
| Chaussy (95150) | 1,04 km | 0,20 km | non | 631 |
| Itteville (91315) | 1,04 km | 0,66 km | oui | 6 746 |
| Brouy (91112) | 1,04 km | 0,49 km | non | 134 |
| Saint-Germain-Laval (77409) | 1,04 km | 1,04 km | non | 2 888 |
| L'Isle-Adam (95313) | 1,03 km | 0,51 km | oui | 12 493 |
| Guérard (77219) | 1,03 km | 0,48 km | oui | 2 688 |
| Puiseux-Pontoise (95510) | 1,03 km | 0,16 km | non | 603 |
| Guiry-en-Vexin (95295) | 1,03 km | 0,14 km | non | 161 |
| Champagne-sur-Oise (95134) | 1,03 km | 0,70 km | non | 5 036 |
| Maudétour-en-Vexin (95379) | 1,03 km | 0,11 km | non | 208 |
| Montgeron (91421) | 1,02 km | 0,34 km | oui | 24 022 |
| Fleury-Mérogis (91235) | 1,02 km | 1,02 km | non | 13 721 |
| Lesches (77248) | 1,02 km | 0,60 km | non | 763 |
| Mareuil-lès-Meaux (77276) | 1,02 km | 0,34 km | non | 3 345 |
| Villemareuil (77505) | 1,02 km | 0,22 km | non | 386 |
| Saint-Germain-Laxis (77410) | 1,02 km | 0,31 km | non | 742 |
| Montigny-sur-Loing (77312) | 1,02 km | 0,25 km | non | 2 669 |
| Jouars-Pontchartrain (78321) | 1,02 km | 0,88 km | oui | 6 039 |
| Villeneuve-le-Roi (94077) | 1,02 km | 0,94 km | oui | 21 000 |
| Villepreux (78674) | 1,02 km | 0,47 km | non | 11 931 |
| Bougligny (77045) | 1,02 km | 1,29 km | non | 738 |
| Puiselet-le-Marais (91508) | 1,02 km | 0,30 km | non | 261 |
| Viarmes (95652) | 1,01 km | 0,21 km | oui | 5 558 |
| Rochefort-en-Yvelines (78522) | 1,01 km | 0,04 km | non | 910 |
| Remauville (77387) | 1,01 km | 0,86 km | non | 449 |
| Mérobert (91393) | 1,01 km | 0,23 km | non | 635 |
| Saint-Maurice-Montcouronne (91568) | 1,01 km | 0,48 km | non | 1 543 |
| La Roche-Guyon (95523) | 1,01 km | 0,06 km | non | 399 |
| Meigneux (77286) | 1,01 km | 0,10 km | non | 236 |
| Esmans (77172) | 1,01 km | 0,38 km | non | 934 |

## Limites

- Filosofi 2021 décrit la population des ménages fiscaux en 2021 ; la géographie communale est 2026.
- Un carreau à cheval sur deux communes est rattaché en entier à celle qui contient son centre.
- Le centre de gravité est un point moyen : il ne correspond pas forcément à une adresse habitée (voir la ligne « centres de gravité dans un carreau sans population »).
- Aucun de ces points n'est un lieu de domicile individuel : ils résument la répartition de la population.
