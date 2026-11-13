-- Arrondissements municipaux (Paris, Lyon, Marseille) -> commune de rattachement.
-- Indispensable : dans MOBPRO, le lieu de travail (DCLT) est codé à l'arrondissement
-- (75101...75120) alors que le lieu de résidence (COMMUNE) est codé 75056.

SELECT
    CAST(CODGEO AS varchar) AS code_arrondissement,
    CAST(LIBGEO AS varchar) AS libelle_arrondissement,
    CAST(COM AS varchar)    AS codgeo
FROM {{ source('open_data', 'cog_arrondissements') }}
WHERE CODGEO IS NOT NULL
