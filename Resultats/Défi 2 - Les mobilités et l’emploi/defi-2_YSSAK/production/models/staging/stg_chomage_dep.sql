SELECT
    CAST(departement AS varchar)                 AS departement,
    CAST(libelle AS varchar)                     AS libelle,
    CAST(periode AS varchar)                     AS periode,            -- ex. 2026-T2
    CAST(substr(CAST(periode AS varchar), 1, 4) AS integer) AS annee,
    CAST(taux_chomage AS double precision)       AS taux_chomage
FROM {{ source('open_data', 'chomage_dep') }}
WHERE taux_chomage IS NOT NULL
