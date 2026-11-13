"""Sources du chantier « abonnements » (SUB01 à SUB05), téléchargées par 01_download.py comme les autres.

Registre séparé de starway/sources.py pour limiter les conflits entre chantiers : 01_download.py parcourt
`SOURCES + SUBSCRIPTION_SOURCES`. Chaque page est gardée telle quelle dans data/raw/<SUBxx>/ (sha256 au manifeste) ;
les prix et les règles publiés par starway/subscriptions.py sont des phrases recopiées mot pour mot, retrouvées
dans ces fichiers par le contrôle 07 (« abonnements »).

Pages déjà au manifeste et réutilisées : COST01 (page Navigo Mois), COST02 (page « Les tarifs 2026 », tickets).
Pages refusées au robot le 04/11/2026 (HTTP 403, non contournées) : imagine R Scolaire, Solidarité Gratuité,
Parkings Vélos (toujours refusées le 05/11 ; leurs conditions ne sont pas lues, voir D-032). Le PDF des CGVU Navigo
Mois et Semaine, refusé au robot, a été déposé à la main par Nicolas le 05/11/2026 : même version (« Juin 2025 ») que la
page HTML gardée, voir la ligne SUB02 correspondante du manifeste.
"""

from __future__ import annotations

from starway.sources import Source

_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
_IDFM = "https://www.iledefrance-mobilites.fr"
_IDFM_LICENCE = "page publique IDFM, citée comme source d'un tarif ou d'une règle (aucune réutilisation de contenu)"
_IDFM_PAGE_COMMON = {
    "granularite": "titre de transport (tarif régional et règles d'usage)",
    "geographie": "Île-de-France",
    "licence": _IDFM_LICENCE,
    "controles": "chaque phrase reprise par le pipeline doit figurer dans le texte de l'instantané "
                 "(contrôle bloquant « abonnements »)",
}


def _idfm_page(slug: str, title: str, millesime: str, treatment: str, limits: str) -> Source:
    return Source(
        "SUB03", f"{_IDFM}/titres-et-tarifs/detail/{slug}", f"{slug}.html",
        {**_IDFM_PAGE_COMMON, "titre": f"IDFM - page du titre « {title} » (instantané HTML)",
         "millesime": millesime, "traitements": treatment, "limites": limits},
        user_agent=_BROWSER_UA,
    )


SUBSCRIPTION_SOURCES: tuple[Source, ...] = (
    # --- SUB01 : source principale, jeu ouvert IDFM ------------------------------------------------------------
    Source(
        "SUB01",
        "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs/exports/json",
        "titres-et-tarifs.json",
        {"titre": "IDFM - Description et tarif des titres de transport en Ile-de-France (jeu titres-et-tarifs, "
                  "export JSON complet)",
         "millesime": "jeu modifié le 03/11/2026 à 19:00 UTC (champ modified des métadonnées) ; tarifs au "
                      "1er janvier 2026 selon les pages liées",
         "licence": "Licence Ouverte v2.0 (Etalab), champ license des métadonnées du jeu",
         "granularite": "titre de transport (30 lignes : nom, prix en texte, période, mention, lien)",
         "geographie": "Île-de-France",
         "traitements": "prix des titres retenus lus dans le champ price (texte « 90,80€ ») par "
                        "le pipeline, sans rien deviner : un prix en pourcentage (« -50% ») ou « dès » "
                        "n'est pas un prix, la page du titre le donne ; ligne de test et titres retirés écartés",
         "controles": "le prix lu doit être identique à celui de la page du titre (SUB03, COST01) ; titres "
                      "retenus présents une seule fois",
         "limites": "prix en texte libre ; aucune règle d'usage (lignes, aéroports) : elles viennent des pages et "
                    "des CGVU"},
    ),
    Source(
        "SUB01",
        "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs",
        "titres-et-tarifs_dataset.json",
        {"titre": "IDFM - métadonnées du jeu titres-et-tarifs (licence, date de modification)",
         "millesime": "métadonnées à la date d'extraction",
         "licence": "Licence Ouverte v2.0 (Etalab)",
         "granularite": "métadonnées", "geographie": "Île-de-France",
         "traitements": "licence et date de modification recopiées dans subscriptions.json",
         "controles": "champ license = « Licence Ouverte v2.0 (Etalab) »",
         "limites": "documentation seulement"},
    ),
    # --- SUB02 : conditions générales (HTML) ---------------------------------------------------------------------
    Source(
        "SUB02", f"{_IDFM}/cgvu-forfaits-navigo-mois-navigo-semaine", "cgvu-forfaits-navigo-mois-navigo-semaine.html",
        {"titre": "IDFM - Conditions générales de vente et d'utilisation des forfaits Navigo Mois et Navigo Semaine "
                  "(version HTML)",
         "millesime": "version « Juin 2025 » (mention de la page, publiée le 30/12/2019 et mise à jour)",
         "licence": _IDFM_LICENCE, "granularite": "règles d'usage", "geographie": "Île-de-France",
         "traitements": "article 2.2 (lignes couvertes : RoissyBus, TER et Intercités en Île-de-France ; non "
                        "valable sur Orlyval) et 2.3 (zones) recopiés dans subscriptions.json",
         "controles": "phrases citées retrouvées dans le texte de l'instantané",
         "limites": "le PDF des CGVU (fichier cgvu-navigo-mois-semaine-v062025.pdf, ligne suivante) a été déposé à la main le "
                    "05/11/2026, même version que cette page ; la règle "
                    "d'application des forfaits deux zones à un trajet (arrêts de montée et de descente ou arrêts "
                    "traversés) n'y est pas écrite"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB02", f"{_IDFM}/medias/portail-idfm/aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf",
        "cgvu-navigo-mois-semaine-v062025.pdf",
        {"titre": "IDFM - Conditions générales de vente et d'utilisation des forfaits Navigo Mois et Navigo Semaine "
                  "(PDF, fichier d'origine aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf)",
         "millesime": "version « Juin 2025 » (mention du document, nom de fichier v062025) ; PDF de 12 pages, "
                      "métadonnées : créé le 23/07/2025 ; déposé le 05/11/2026",
         "licence": _IDFM_LICENCE, "granularite": "règles d'usage", "geographie": "Île-de-France",
         "traitements": "aucune citation nouvelle : mêmes règles que la version HTML (article 2 « Utilisation » : "
                        "lignes couvertes, TER et Intercités en Île-de-France, non valable sur Orlyval ; « Zonage »)",
         "controles": "déposé à la main par l'équipe le 05/11/2026 (le téléchargement automatique est refusé, 403) ; "
                      "l'adresse du lien PDF de la page HTML gardée est la même (…/medias/portail-idfm/"
                      "aIEBglGsbswqTLlC_CGVU_NMS_v062025.pdf, « PDF - 238.1 KB » = 243 765 octets, la taille du "
                      "fichier) ; comparaison mot à mot avec la page HTML : 97,7 % de mots identiques, écarts = "
                      "numérotation des articles, espaces de l'extraction, un paragraphe sur les données "
                      "personnelles présent dans le PDF seulement",
         "limites": "texte extrait avec pypdf (la numérotation des articles n'y figure pas) ; les règles de "
                    "Navigo Liberté + (articles 3.4 à 3.8) ne sont pas dans ce document : elles sont dans les CGVU "
                    "Navigo Liberté + (ligne SUB02 « cgvu-navigo-liberte.html »)"},
    ),
    Source(
        "SUB02", f"{_IDFM}/cgvu-navigo-liberte", "cgvu-navigo-liberte.html",
        {"titre": "IDFM - Conditions générales de vente et d'utilisation du contrat Navigo Liberté + sur passe "
                  "(version HTML)",
         "millesime": "« Date de validité : à partir de juin 2026 » (mention de la page)",
         "licence": _IDFM_LICENCE, "granularite": "règles de tarification", "geographie": "Île-de-France",
         "traitements": "règles des trajets et des correspondances (articles 2.3 à 3.8) lues : différentes de celles "
                        "des tickets, donc Liberté + n'est pas calculé par trajet (V0) ; prix publiés à titre "
                        "d'information",
         "controles": "phrases citées retrouvées dans le texte de l'instantané",
         "limites": "calcul par trajet non fait : il demande les arrêts et les heures de validation de chaque "
                    "trajet (règles 3.4 à 3.7) et les tarifs de proximité de Roissy"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB02", f"{_IDFM}/cgvu-du-forfait-navigo-annuel", "cgvu-du-forfait-navigo-annuel.html",
        {"titre": "IDFM - Conditions générales de vente et d'utilisation du forfait Navigo Annuel (et de la "
                  "Tarification Senior), version HTML",
         "millesime": "« Date d'entrée en vigueur : 24/06/2026 » (mention de la page)",
         "licence": _IDFM_LICENCE, "granularite": "règles d'usage", "geographie": "Île-de-France",
         "traitements": "article 2 (lignes couvertes, TER et Intercités, non valable sur Orlyval) et 2.2.1 (Senior "
                        "uniquement toutes zones) recopiés dans subscriptions.json",
         "controles": "phrases citées retrouvées dans le texte de l'instantané",
         "limites": "forfaits deux zones non calculés"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB02", f"{_IDFM}/cgvu-imagine-r-etudiant-2026-2027", "cgvu-imagine-r-etudiant-2026-2027.html",
        {"titre": "IDFM - Conditions générales de vente et d'utilisation du forfait imagine R Étudiant (saison "
                  "2026-2027), version HTML",
         "millesime": "saison 2026-2027 (publiée le 09/10/2026)",
         "licence": _IDFM_LICENCE, "granularite": "règles d'usage", "geographie": "Île-de-France",
         "traitements": "article 1.1 (lignes couvertes, TER et Intercités, non valable sur Orlyval) et 1.2 "
                        "(conditions) recopiés dans subscriptions.json",
         "controles": "phrases citées retrouvées dans le texte de l'instantané",
         "limites": "imagine R Scolaire : page refusée au robot le 04/11, non proposé"},
        user_agent=_BROWSER_UA,
    ),
    # --- SUB03 : pages des titres --------------------------------------------------------------------------------
    _idfm_page("forfait-navigo-semaine", "Forfait Navigo Semaine", "tarifs applicables au 1er janvier 2026 (mention)",
               "prix toutes zones et exclusions (« Ne sont pas inclus : Orlyval ... »)", "forfaits deux zones non calculés"),
    _idfm_page("forfait-navigo-annuel", "Forfait Navigo Annuel", "tarifs applicables au 1er janvier 2026 (mention)",
               "prix par mois, 12e mois offert, Parkings Vélos offert, exclusions", "forfaits deux zones non calculés"),
    _idfm_page("forfait-navigo-jour", "Forfait Navigo Jour", "aucune date affichée ; prix identique au jeu SUB01",
               "prix et exclusion des dessertes aéroportuaires", "titre d'une journée, pas un abonnement"),
    _idfm_page("liberte-plus", "Navigo Liberté +", "tarifs applicables au 1er janvier 2026 (mention)",
               "prix des trajets et plafond du Navigo Jour, publiés à titre d'information", "non calculé par trajet"),
    _idfm_page("forfait-imagine-r-etudiant", "Forfait imagine R Étudiant", "année 2026-2027 (mention)",
               "prix annuel frais de dossier inclus, exclusions", "conditions d'âge et de statut (étudiant)"),
    _idfm_page("forfait-imagine-r-junior", "Forfait imagine R Junior", "année 2026-2027 (mention)",
               "prix annuel frais de dossier inclus, exclusions", "moins de 11 ans"),
    _idfm_page("solidarite-75", "Solidarité 75%", "tarifs applicables au 1er janvier 2026 (mention)",
               "prix Navigo Mois et Semaine Solidarité 75 % toutes zones", "conditions de ressources ; la liste des "
               "modes de la page ne cite pas les aéroports (couverture des aéroports non affirmée)"),
    _idfm_page("forfait-navigo-annuel-tarification-senior", "Forfait Navigo Annuel Tarification Senior",
               "tarifs applicables au 1er janvier 2026 (mention)", "prix par mois, exclusions",
               "62 ans ou plus, sans activité ou moins d'un mi-temps ; Orlyval non cité (couverture non affirmée)"),
    _idfm_page("forfait-amethyste", "Forfait Améthyste", "aucune date affichée",
               "zones par département, exclusions", "prix fixé par chaque département (participation possible) : "
               "non publié"),
    _idfm_page("le-forfait-gratuite-jeunes-en-insertion", "Forfait Gratuité jeunes en insertion", "aucune date affichée",
               "gratuité et exclusions", "16 à 25 ans, stagiaires de dispositifs régionaux"),
    _idfm_page("ticket-bus-tram", "Ticket Bus-Tram", "aucune date affichée",
               "page du ticket gardée (règles déjà appliquées par le pipeline, lues le 03/11)",
               "documentation"),
    # --- SUB04 : Vélib' ------------------------------------------------------------------------------------------
    Source(
        "SUB04", "https://www.velib-metropole.fr/fr/offers", "velib-offers.html",
        {"titre": "Vélib' Métropole - page « Offres » (tarifs des abonnements et des courses, instantané HTML)",
         "millesime": "tarifs pour toute souscription à partir du 12 août 2025 (grille et CGAU)",
         "licence": "page publique de Vélib' Métropole (service public, Smovengo), citée comme source d'un tarif",
         "granularite": "offre (prix mensuel, minutes incluses, prix au-delà)", "geographie": "zone Vélib' Métropole",
         "traitements": "prix des offres et prix au-delà des minutes incluses (vélo mécanique) recopiés",
         "controles": "phrases et montants retrouvés dans le texte de l'instantané",
         "limites": "vélo électrique non calculé (nos durées sont celles du vélo de r5py) ; Minutes Bonus ignorées"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB04",
        "https://www.velib-metropole.fr/media/914/download/Grille%20tarifaire%20V%C3%A9lib%27%20refonte%20tarifaire.pdf?v=1",
        "velib-grille-tarifaire.pdf",
        {"titre": "Vélib' Métropole - Grille tarifaire « refonte tarifaire » (PDF)",
         "millesime": "« Tarifs valables pour toute souscription à partir du 12 août 2025 »",
         "licence": "document public de Vélib' Métropole, cité", "granularite": "grille tarifaire",
         "geographie": "zone Vélib' Métropole",
         "traitements": "prix mensuels V-Plus et V-Max (plein, Jeune, Senior, Solidaire) recoupés avec la page Offres",
         "controles": "citations liées à l'empreinte sha256 du fichier lu le 04/11",
         "limites": "mise en page en colonnes : texte extrait avec pdftotext pour la lecture, aucune extraction "
                    "automatique dans le pipeline"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB04", "https://www.velib-metropole.fr/media/1045/download/CGAU_LD_Octobre_2026.pdf?v=1&inline=1",
        "CGAU_LD_Octobre_2026.pdf",
        {"titre": "Vélib' Métropole - CGAU des utilisateurs longue durée (abonnements V-Libre, V-Plus, V-Max)",
         "millesime": "« Pour toute souscription à partir du 12 août 2025 », « DATE DE DERNIERE MISE A JOUR : "
                      "28 juillet 2025 »",
         "licence": "document public de Vélib' Métropole, cité", "granularite": "règles de tarification",
         "geographie": "zone Vélib' Métropole",
         "traitements": "règle des tranches (« inférieure ou égale à 29 min 59 sec ») et plafond de 18 euros par "
                        "course en vélo mécanique",
         "controles": "citations liées à l'empreinte sha256 du fichier lu le 04/11",
         "limites": "lu avec pdftotext (colonnes) ; aucune extraction automatique"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB04", "https://www.velib-metropole.fr/media/1046/download/CGAU_CD_Ocotbre_2026.pdf?v=1&inline=1",
        "CGAU_CD_Ocotbre_2026.pdf",
        {"titre": "Vélib' Métropole - CGAU des utilisateurs courte durée (Ticket-V, Pass)",
         "millesime": "« Pour toute souscription à partir du 12 août 2025 »",
         "licence": "document public de Vélib' Métropole, cité", "granularite": "règles de tarification",
         "geographie": "zone Vélib' Métropole",
         "traitements": "Ticket-V : « une seule et unique course », 45 premières minutes gratuites",
         "controles": "citations liées à l'empreinte sha256 du fichier lu le 04/11",
         "limites": "le prix au-delà de 45 min du Ticket-V est ambigu sur la page Offres (1 € ou 2 € par 30 min) : "
                    "non calculé"},
        user_agent=_BROWSER_UA,
    ),
    Source(
        "SUB04", "https://agemob.fr/velib-metropole/le-velo-partage/", "agemob-velib-le-velo-partage.html",
        {"titre": "AGEMOB (Syndicat Autolib' Vélib' Métropole) - page « Le vélo partagé accessible à tous : le "
                  "service public Velib' Métropole »",
         "millesime": "page consultée le 05/11/2026 (aucune date de mise à jour affichée)",
         "licence": "page publique de l'AGEMOB, citée ; conditions de réutilisation non relues",
         "granularite": "page de présentation du service", "geographie": "Métropole du Grand Paris",
         "traitements": "aucun chiffre repris ; passages cités : « Le service public Velib' Métropole a pour aire "
                        "géographique d'implantation le territoire de la Métropole du Grand Paris » et « exploité "
                        "dans le cadre d'un marché public » (prestataire : Smovengo)",
         "controles": "phrases retrouvées dans le texte de l'instantané",
         "limites": "la page présente Vélib' comme un service public exploité dans le cadre d'un marché public ; "
                    "elle ne cite pas l'article R3261-2 du Code du travail : le rapprochement avec « service public "
                    "de location de vélos » vient du BOFiP (SUB05, doctrine fiscale), pas de cette page"},
    ),
    # --- SUB05 : prise en charge par l'employeur -----------------------------------------------------------------
    *(Source(
        "SUB05", f"https://code.travail.gouv.fr/code-du-travail/{art}", f"code-travail-{art}.html",
        {"titre": f"Code du travail numérique (ministère du Travail) - article {art.upper()}",
         "millesime": "version en vigueur à la date d'extraction (texte repris de Légifrance par le site) ; "
                      f"identifiant Légifrance {legiarti}, « Mis à jour le : {since} » (mention de la page)",
         "licence": "texte de loi cité ; page publique du Code du travail numérique (ministère du Travail), conditions non relues",
         "granularite": "article de loi", "geographie": "France (salariés du secteur privé)",
         "traitements": "phrase de prise en charge par l'employeur recopiée dans subscriptions.json",
         "controles": "phrase retrouvée dans le texte de l'instantané ; relu le 05/11/2026 sur le site (texte "
                      "identique) ; l'identifiant LEGIARTI de la page est celui du lien Légifrance ci-contre : "
                      f"https://www.legifrance.gouv.fr/codes/article_lc/{legiarti}",
         "limites": "lu sur le Code du travail numérique, pas sur Légifrance : Légifrance refuse le robot (HTTP 403, "
                    "04 et 05/11/2026), la page Légifrance elle-même n'a donc pas été lue ; un humain peut la relire"},
        user_agent=_BROWSER_UA,
    ) for art, legiarti, since in (("l3261-2", "LEGIARTI000019950566", "19/12/2008"),
                                   ("r3261-1", "LEGIARTI000020080272", "01/01/2009"),
                                   ("r3261-2", "LEGIARTI000020080269", "01/01/2009"),
                                   ("r3261-3", "LEGIARTI000020080267", "01/01/2009"))),
    Source(
        "SUB05", "https://bofip.impots.gouv.fr/bofip/5601-PGP.html/identifiant=BOI-RSA-CHAMP-20-30-10-20-20260407",
        "doctrine-bofip-BOI-RSA-CHAMP-20-30-10-20-20260407.html",
        {"titre": "BOFiP-Impôts - BOI-RSA-CHAMP-20-30-10-20-20260407 : frais de transport domicile-travail, prise en "
                  "charge obligatoire des titres d'abonnement (doctrine fiscale)",
         "millesime": "version du 07/04/2026 (identifiant du document) ; consultée le 05/11/2026",
         "licence": "doctrine administrative publiée (BOFiP-Impôts, DGFiP), citée ; conditions de réutilisation non relues",
         "granularite": "doctrine fiscale (paragraphes 50 à 190 : prise en charge obligatoire par l'employeur)",
         "geographie": "France (employeurs de droit privé et leurs salariés)",
         "traitements": "aucun chiffre repris ; deux passages cités : définition des « abonnements à un service public "
                        "de location de vélos » (§ 110, qui donne Vélib' en exemple) et prorata sous un mi-temps (§ 170)",
         "controles": "phrases retrouvées dans le texte de l'instantané ; le BOFiP renvoie lui-même à L3261-2 "
                      "(LEGIARTI000019950566, version du 19/12/2008) et R3261-1 (LEGIARTI000020080272, version du "
                      "01/01/2009)",
         "limites": "doctrine fiscale : elle commente l'exonération d'impôt sur le revenu et reprend les règles du "
                    "Code du travail ; ce n'est ni la loi ni un avis juridique ; elle ne dit pas quelles offres Vélib' "
                    "sont des « abonnements »"},
    ),
    Source(
        "SUB05", "https://www.service-public.gouv.fr/particuliers/vosdroits/F19846", "service-public-F19846.html",
        {"titre": "Service Public - Remboursement des frais de transport domicile-travail d'un salarié du secteur "
                  "privé (fiche F19846)",
         "millesime": "« Vérifié le 28 octobre 2026 » (mention de la page)",
         "licence": "page publique Service Public (DILA), citée ; conditions de réutilisation à vérifier",
         "granularite": "fiche pratique", "geographie": "France",
         "traitements": "« Les titres de transport achetés à l'unité ne sont pas remboursables. » recopiée",
         "controles": "phrase retrouvée dans le texte de l'instantané",
         "limites": "secteur privé seulement ; agents publics : autre texte, non lu"},
        user_agent=_BROWSER_UA,
    ),
)
