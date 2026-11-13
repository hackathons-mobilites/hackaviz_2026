-- Enquête BMO : 1 ligne = 1 bassin d'emploi x 1 métier. nb_projets NULL = secret statistique.
-- Le bassin BMO est rapproché du référentiel régional par son libellé ("T8 Est Ensemble" <-> "T8").

WITH b AS (
    SELECT code_be, nom_court FROM {{ ref('stg_bassins_emploi') }}
)

SELECT
    CAST(m.annee AS integer)                      AS annee,
    CAST(m.code_metier AS varchar)                AS code_metier,
    CAST(m.metier AS varchar)                     AS metier,
    CAST(m.code_famille AS varchar)               AS code_famille,
    CAST(m.famille AS varchar)                    AS famille,
    CAST(m.departement AS varchar)                AS departement,
    CAST(m.region AS varchar)                     AS region,
    CAST(m.code_be_bmo AS varchar)                AS code_be_bmo,
    CAST(m.nom_bassin AS varchar)                 AS nom_bassin,
    b.code_be,
    CAST(m.nb_projets AS double precision)             AS nb_projets,
    CAST(m.nb_projets_difficiles AS double precision)  AS nb_projets_difficiles,
    CAST(m.nb_projets_saisonniers AS double precision) AS nb_projets_saisonniers
FROM {{ source('open_data', 'bmo_2026') }} m
LEFT JOIN b ON m.nom_bassin = b.nom_court OR m.nom_bassin LIKE b.nom_court || ' %'
