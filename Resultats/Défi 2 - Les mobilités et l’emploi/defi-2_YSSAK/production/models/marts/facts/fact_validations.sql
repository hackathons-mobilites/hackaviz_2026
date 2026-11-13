-- Validations ferrées par pôle et par trimestre (4 derniers trimestres publiés par IDFM).

SELECT
    CAST(v.id_zdc AS bigint)                AS id_zdc,
    CAST(v.trimestre AS varchar)            AS trimestre,
    v.date_debut,
    v.date_fin,
    CAST(SUM(v.nb_validations) AS bigint)   AS nb_validations
FROM {{ ref('stg_idfm_validations') }} v
INNER JOIN {{ ref('dim_gares') }} g ON g.id_zdc = v.id_zdc
GROUP BY v.id_zdc, v.trimestre, v.date_debut, v.date_fin
