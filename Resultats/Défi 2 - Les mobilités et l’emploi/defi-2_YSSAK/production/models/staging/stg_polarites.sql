-- Polarités du SDRIF-E rapprochées des communes par libellé (COG 2025).
-- importance : 1 = polarité majeure ... (voir documentation Région).

WITH com AS (
    SELECT codgeo, libgeo FROM {{ ref('stg_cog_communes') }} WHERE region = {{ lit(var('region')) }}
)

SELECT
    CAST(p.objectid AS integer)        AS id_polarite,
    CAST(p.nom_polarite AS varchar)    AS nom_polarite,
    CAST(p.importance AS integer)      AS importance,
    CAST(p.nom_commune AS varchar)     AS nom_commune,
    c.codgeo
FROM {{ source('open_data', 'polarites_communes') }} p
LEFT JOIN com c ON lower(c.libgeo) = lower(CAST(p.nom_commune AS varchar))
