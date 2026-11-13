-- Dictionnaire des indicateurs (alimenté par seeds/indicateurs.csv).
-- Le modèle existe pour que le dashboard et les tests pointent sur une table du schéma final.

SELECT
    CAST(code_indicateur AS varchar)     AS code_indicateur,
    CAST(nom_indicateur AS varchar)      AS nom_indicateur,
    CAST(description AS varchar)         AS description,
    CAST(famille_indicateur AS varchar)  AS famille_indicateur,
    CAST(type_mesure AS varchar)         AS type_mesure,
    CAST(unite AS varchar)               AS unite,
    CAST(defi AS varchar)                AS defi,
    CAST(source AS varchar)              AS source,
    CAST(producteur AS varchar)          AS producteur,
    CAST(ordre AS integer)               AS ordre
FROM {{ ref('indicateurs') }}
