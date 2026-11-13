-- Taux de chômage localisés par zone d'emploi (2020), une ligne par ZE x trimestre.

SELECT
    CAST(ZE2020 AS varchar)                                   AS zone_emploi,
    CAST(LIBZE2020 AS varchar)                                AS libelle_zone_emploi,
    CAST(REG AS varchar)                                      AS region,
    CAST(periode AS varchar)                                  AS periode,              -- ex. 2026-T2
    CAST(substr(CAST(periode AS varchar), 1, 4) AS integer)   AS annee,
    CAST(substr(CAST(periode AS varchar), 7, 1) AS integer)   AS trimestre,
    CAST(taux_chomage AS double precision)                    AS taux_chomage
FROM {{ source('open_data', 'chomage_ze') }}
WHERE taux_chomage IS NOT NULL
