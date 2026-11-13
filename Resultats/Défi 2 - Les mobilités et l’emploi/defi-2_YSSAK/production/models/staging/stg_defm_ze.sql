-- Demandeurs d'emploi en fin de mois (DEFM) par zone d'emploi, données brutes DARES.
-- On ne garde que les totaux (sexe, âge, ancienneté) par catégorie.

SELECT
    CAST(date AS varchar)                              AS mois,          -- ex. 2026-09
    CAST(substr(CAST(date AS varchar), 1, 4) AS integer) AS annee,
    CAST(code_zone_d_emploi AS varchar)                AS zone_emploi,
    CAST(zone_d_emploi AS varchar)                     AS libelle_zone_emploi,
    CAST(categorie AS varchar)                         AS categorie,     -- A, ABC, ABCDE...
    CAST(nombre_de_demandeurs_d_emploi AS double precision) AS nb_demandeurs
FROM {{ source('open_data', 'defm_ze') }}
WHERE sexe = 'Total' AND tranche_d_age = 'Total' AND anciennete = 'Total'
  AND type_de_donnees = 'Brutes'
