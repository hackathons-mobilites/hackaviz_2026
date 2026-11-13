-- Dimension géographique de la région étudiée, toutes mailles confondues.
-- Clé : (maille, codegeo). Les codes se recoupent entre mailles (ex. '75' = département Paris,
-- '11' = région), d'où la clé composite.
-- lon/lat : point représentatif (pour placer une étiquette ou tracer un flux).
-- geojson : contour simplifié, renseigné pour les communes et les départements seulement.

WITH com AS (
    SELECT c.*, b.code_be AS bassin_emploi,
           p.nom_polarite, p.importance AS importance_polarite
    FROM {{ ref('stg_cog_communes') }} c
    LEFT JOIN {{ ref('stg_communes_bassins') }} b ON b.codgeo = c.codgeo
    LEFT JOIN (
        SELECT codgeo, MIN(nom_polarite) AS nom_polarite, MIN(importance) AS importance
        FROM {{ ref('stg_polarites') }} WHERE codgeo IS NOT NULL GROUP BY codgeo
    ) p ON p.codgeo = c.codgeo
    WHERE c.region = {{ lit(var('region')) }}
),

be AS (
    SELECT * FROM {{ ref('stg_bassins_emploi') }}
),

lib AS (
    SELECT * FROM {{ ref('stg_cog_libelles_supra') }}
),

ctr AS (
    SELECT * FROM {{ ref('stg_contours') }}
),

communes AS (
    SELECT
        'Commune'                 AS maille,
        c.codgeo                  AS codegeo,
        c.libgeo,
        c.epci,
        c.zone_emploi,
        c.bassin_emploi,
        c.departement,
        c.region,
        1                         AS nb_communes,
        k.lon,
        k.lat,
        k.geojson,
        c.nom_polarite,
        c.importance_polarite
    FROM com c
    LEFT JOIN ctr k ON k.maille = 'Commune' AND k.codegeo = c.codgeo
),

epci AS (
    SELECT
        'EPCI'                    AS maille,
        c.epci                    AS codegeo,
        l.libgeo,
        c.epci,
        NULL                      AS zone_emploi,
        NULL                      AS bassin_emploi,
        -- un EPCI peut être à cheval sur plusieurs départements : on garde le plus fréquent
        MIN(c.departement)        AS departement,
        c.region,
        COUNT(*)                  AS nb_communes,
        AVG(k.lon)                AS lon,
        AVG(k.lat)                AS lat,
        NULL                      AS geojson,
        NULL                      AS nom_polarite,
        NULL                      AS importance_polarite
    FROM com c
    LEFT JOIN lib l ON l.nivgeo = 'EPCI' AND l.codgeo = c.epci
    LEFT JOIN ctr k ON k.maille = 'Commune' AND k.codegeo = c.codgeo
    WHERE c.epci IS NOT NULL
    GROUP BY c.epci, l.libgeo, c.region
),

ze AS (
    SELECT
        'Zone d''emploi'          AS maille,
        c.zone_emploi             AS codegeo,
        l.libgeo,
        NULL                      AS epci,
        c.zone_emploi,
        NULL                      AS bassin_emploi,
        MIN(c.departement)        AS departement,
        c.region,
        COUNT(*)                  AS nb_communes,
        AVG(k.lon)                AS lon,
        AVG(k.lat)                AS lat,
        NULL                      AS geojson,
        NULL                      AS nom_polarite,
        NULL                      AS importance_polarite
    FROM com c
    LEFT JOIN lib l ON l.nivgeo = 'ZE2020' AND l.codgeo = c.zone_emploi
    LEFT JOIN ctr k ON k.maille = 'Commune' AND k.codegeo = c.codgeo
    WHERE c.zone_emploi IS NOT NULL
    GROUP BY c.zone_emploi, l.libgeo, c.region
),

bassins AS (
    SELECT
        'Bassin d''emploi'        AS maille,
        b.code_be                 AS codegeo,
        b.libelle                 AS libgeo,
        NULL                      AS epci,
        NULL                      AS zone_emploi,
        b.code_be                 AS bassin_emploi,
        MIN(c.departement)        AS departement,
        MIN(c.region)             AS region,
        COUNT(c.codgeo)           AS nb_communes,
        b.lon,
        b.lat,
        b.geojson,
        NULL                      AS nom_polarite,
        NULL                      AS importance_polarite
    FROM be b
    LEFT JOIN com c ON c.bassin_emploi = b.code_be
    GROUP BY b.code_be, b.libelle, b.lon, b.lat, b.geojson
),

dep AS (
    SELECT
        'Département'             AS maille,
        c.departement             AS codegeo,
        l.libgeo,
        NULL                      AS epci,
        NULL                      AS zone_emploi,
        NULL                      AS bassin_emploi,
        c.departement,
        c.region,
        COUNT(*)                  AS nb_communes,
        MIN(k.lon)                AS lon,
        MIN(k.lat)                AS lat,
        MIN(k.geojson)            AS geojson,
        NULL                      AS nom_polarite,
        NULL                      AS importance_polarite
    FROM com c
    LEFT JOIN lib l ON l.nivgeo = 'DEP' AND l.codgeo = c.departement
    LEFT JOIN ctr k ON k.maille = 'Département' AND k.codegeo = c.departement
    GROUP BY c.departement, l.libgeo, c.region
),

reg AS (
    SELECT
        'Région'                  AS maille,
        c.region                  AS codegeo,
        l.libgeo,
        NULL                      AS epci,
        NULL                      AS zone_emploi,
        NULL                      AS bassin_emploi,
        NULL                      AS departement,
        c.region,
        COUNT(*)                  AS nb_communes,
        AVG(k.lon)                AS lon,
        AVG(k.lat)                AS lat,
        NULL                      AS geojson,
        NULL                      AS nom_polarite,
        NULL                      AS importance_polarite
    FROM com c
    LEFT JOIN lib l ON l.nivgeo = 'REG' AND l.codgeo = c.region
    LEFT JOIN ctr k ON k.maille = 'Commune' AND k.codegeo = c.codgeo
    GROUP BY c.region, l.libgeo
),

u AS (
    SELECT * FROM communes
    UNION ALL SELECT * FROM epci
    UNION ALL SELECT * FROM ze
    UNION ALL SELECT * FROM bassins
    UNION ALL SELECT * FROM dep
    UNION ALL SELECT * FROM reg
)

SELECT
    CAST(maille AS varchar)               AS maille,
    CAST(codegeo AS varchar)              AS codegeo,
    CAST(libgeo AS varchar)               AS libgeo,
    CAST(epci AS varchar)                 AS epci,
    CAST(zone_emploi AS varchar)          AS zone_emploi,
    CAST(bassin_emploi AS varchar)        AS bassin_emploi,
    CAST(departement AS varchar)          AS departement,
    CAST(region AS varchar)               AS region,
    CAST(nb_communes AS integer)          AS nb_communes,
    CAST(lon AS double precision)         AS lon,
    CAST(lat AS double precision)         AS lat,
    CAST(geojson AS varchar)              AS geojson,
    CAST(nom_polarite AS varchar)         AS nom_polarite,         -- SDRIF-E : commune structurante (NULL sinon)
    CAST(importance_polarite AS integer)  AS importance_polarite
FROM u
