-- Libellés officiels des modalités MOBPRO (dictionnaire INSEE), pour les variables affichées.

SELECT
    CAST(COD_VAR AS varchar) AS variable,
    CAST(LIB_VAR AS varchar) AS libelle_variable,
    CAST(COD_MOD AS varchar) AS modalite,
    CAST(LIB_MOD AS varchar) AS libelle_modalite
FROM {{ source('open_data', 'mobpro_' ~ var('annee_mobpro') ~ '_varmod') }}
WHERE COD_VAR IN ('TRANS', 'GS', 'ILT', 'VOIT', 'SEXE', 'TP')
