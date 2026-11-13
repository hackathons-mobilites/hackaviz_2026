-- MOBPRO : 1 ligne = 1 actif occupé pondéré (IPONDI).
-- Variables utiles uniquement, codes normalisés en texte.
-- Le lieu de travail est ramené à la commune (arrondissements -> 75056, 69123, 13055).
-- Les communes fusionnées depuis le millésime du RP sont ramenées au code COG 2025 (seed fusions_communes).

WITH m AS (
    SELECT * FROM {{ source('open_data', 'mobpro_' ~ var('annee_mobpro')) }}
),

arm AS (
    SELECT code_arrondissement, codgeo FROM {{ ref('stg_cog_arrondissements') }}
),

fus AS (
    SELECT CAST(ancien_code AS varchar) AS ancien_code, CAST(nouveau_code AS varchar) AS nouveau_code
    FROM {{ ref('fusions_communes') }}
)

SELECT
    COALESCE(fr.nouveau_code, CAST(m.COMMUNE AS varchar))   AS commune_residence,
    NULLIF(CAST(m.ARM AS varchar), 'ZZZZZ')                 AS arrondissement_residence,
    CAST(m.REGION AS varchar)                               AS region_residence,
    COALESCE(ft.nouveau_code, arm.codgeo, CAST(m.DCLT AS varchar)) AS commune_travail,
    CAST(m.DCLT AS varchar)                                 AS commune_travail_detail,
    CAST(m.REGLT AS varchar)                                AS region_travail,
    CAST(CAST(m.ILT AS integer) AS varchar)                 AS indicateur_lieu_travail,   -- 1 = commune de résidence ... 7 = étranger
    CAST(CAST(m.TRANS AS integer) AS varchar)               AS code_trans,
    CAST(CAST(m.GS AS integer) AS varchar)                  AS groupe_social,
    CAST(m.VOIT AS varchar)                                 AS nb_voitures_menage,        -- 0, 1, 2, 3, Z = hors logement ordinaire
    CAST(CAST(m.SEXE AS integer) AS varchar)                AS sexe,
    CAST(m.AGEREVQ AS integer)                              AS age_quinquennal,
    CAST(CAST(m.TP AS integer) AS varchar)                  AS temps_travail,             -- 1 complet, 2 partiel
    CAST(m.IPONDI AS double precision)                      AS poids,
    {{ var('annee_mobpro') }}                               AS annee
FROM m
LEFT JOIN arm ON arm.code_arrondissement = CAST(m.DCLT AS varchar)
LEFT JOIN fus fr ON fr.ancien_code = CAST(m.COMMUNE AS varchar)
LEFT JOIN fus ft ON ft.ancien_code = COALESCE(arm.codgeo, CAST(m.DCLT AS varchar))
