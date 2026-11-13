-- Pôles ferrés (zones de correspondance IDFM) : 1 ligne = 1 pôle, avec la commune
-- de rattachement (calculée à l'ingestion par intersection point / contour) et les
-- validations des 4 derniers trimestres publiés.

WITH g AS (
    SELECT * FROM {{ ref('stg_idfm_gares') }}
),

poles AS (
    SELECT
        id_zdc,
        MIN(nom_zdc)                                             AS nom_pole,
        MIN(codegeo_commune)                                     AS codegeo_commune,
        AVG(lon)                                                 AS lon,
        AVG(lat)                                                 AS lat,
        COUNT(DISTINCT ligne)                                    AS nb_lignes,
        STRING_AGG(DISTINCT mode, ', ' ORDER BY mode)            AS modes,
        STRING_AGG(DISTINCT ligne, ', ' ORDER BY ligne)          AS lignes,
        BOOL_OR(mode = 'METRO')                                  AS a_metro,
        BOOL_OR(mode = 'RER')                                    AS a_rer,
        BOOL_OR(mode = 'TRAIN')                                  AS a_train,
        BOOL_OR(mode = 'TRAMWAY')                                AS a_tram
    FROM g
    WHERE id_zdc IS NOT NULL
    GROUP BY id_zdc
),

val AS (
    SELECT
        id_zdc,
        SUM(nb_validations)                                      AS nb_validations_12m,
        COUNT(DISTINCT trimestre)                                AS nb_trimestres,
        MIN(trimestre)                                           AS premier_trimestre,
        MAX(trimestre)                                           AS dernier_trimestre
    FROM {{ ref('stg_idfm_validations') }}
    WHERE id_zdc IS NOT NULL
    GROUP BY id_zdc
)

SELECT
    CAST(p.id_zdc AS bigint)                     AS id_zdc,
    CAST(p.nom_pole AS varchar)                  AS nom_pole,
    CAST(p.codegeo_commune AS varchar)           AS codegeo_commune,
    c.libgeo                                     AS commune,
    c.departement,
    c.epci,
    CAST(p.lon AS double precision)              AS lon,
    CAST(p.lat AS double precision)              AS lat,
    CAST(p.nb_lignes AS integer)                 AS nb_lignes,
    CAST(p.modes AS varchar)                     AS modes,
    CAST(p.lignes AS varchar)                    AS lignes,
    p.a_metro, p.a_rer, p.a_train, p.a_tram,
    CAST(v.nb_validations_12m AS bigint)         AS nb_validations_12m,
    CAST(v.nb_trimestres AS integer)             AS nb_trimestres,
    CAST(v.premier_trimestre AS varchar)         AS premier_trimestre,
    CAST(v.dernier_trimestre AS varchar)         AS dernier_trimestre
FROM poles p
LEFT JOIN val v ON v.id_zdc = p.id_zdc
LEFT JOIN {{ ref('dim_geo') }} c ON c.maille = 'Commune' AND c.codegeo = p.codegeo_commune
