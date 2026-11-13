-- Bassins d'emploi franciliens (25). code_be = clé ; libellé long = nom_suppl quand il existe (EPT).

SELECT
    CAST(code_be AS varchar)                       AS code_be,
    CAST(nom AS varchar)                           AS nom_court,
    COALESCE(CAST(nom_suppl AS varchar), CAST(nom AS varchar)) AS libelle,
    CAST(statut AS varchar)                        AS statut_gouvernance,
    CAST(lon AS double precision)                  AS lon,
    CAST(lat AS double precision)                  AS lat,
    CAST(geojson AS varchar)                       AS geojson
FROM {{ source('open_data', 'bassins_emploi') }}
