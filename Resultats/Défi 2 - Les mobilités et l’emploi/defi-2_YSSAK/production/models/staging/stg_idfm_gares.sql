-- Gares et stations du réseau ferré francilien : 1 ligne = 1 gare x 1 ligne desservie.
-- id_zdc = zone de correspondance (regroupe les lignes d'un même pôle), clé de jointure avec les validations.

SELECT
    CAST(id_gares AS integer)            AS id_gare,
    CAST(nom_gares AS varchar)           AS nom_gare,
    CAST(id_ref_zdc AS bigint)           AS id_zdc,
    CAST(nom_zdc AS varchar)             AS nom_zdc,
    CAST(mode AS varchar)                AS mode,          -- METRO, RER, TRAIN, TRAMWAY, VAL, ...
    CAST(res_com AS varchar)             AS ligne,
    CAST(indice_lig AS varchar)          AS indice_ligne,
    CAST(exploitant AS varchar)          AS exploitant,
    CAST(principal AS integer) = 1       AS est_principale,
    CAST(x AS double precision)          AS x_lambert93,
    CAST(y AS double precision)          AS y_lambert93,
    CAST(lon AS double precision)        AS lon,
    CAST(lat AS double precision)        AS lat,
    CAST(codegeo_commune AS varchar)     AS codegeo_commune   -- calculé à l'ingestion (point dans contour)
FROM {{ source('open_data', 'idfm_gares') }}
