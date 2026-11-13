-- Validations ferrées, total régional par jour (saisonnalité, jours fériés, grèves...).

SELECT
    CAST(jour AS date)                      AS jour,
    CAST(trimestre AS varchar)              AS trimestre,
    CAST(nb_validations AS bigint)          AS nb_validations
FROM {{ source('open_data', 'idfm_validations_jour') }}
