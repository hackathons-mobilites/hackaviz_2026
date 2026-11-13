-- Projets de recrutement BMO par bassin d'emploi et métier (détail pour le dashboard).

SELECT
    annee,
    code_be,
    departement,
    code_famille,
    famille,
    code_metier,
    metier,
    nb_projets,
    nb_projets_difficiles,
    nb_projets_saisonniers
FROM {{ ref('stg_bmo') }}
WHERE code_be IS NOT NULL AND nb_projets IS NOT NULL
